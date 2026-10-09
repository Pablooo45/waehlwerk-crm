// Calendly, Google Kalender und KI-Dienste verbinden. Zugangsdaten landen nur in private.kv.

import { checkAnthropicKey, checkAssemblyKey, DEFAULT_SUMMARY_MODEL } from '../_shared/ai.ts';
import { calendly, CalendlyError } from '../_shared/calendly.ts';
import { randomToken } from '../_shared/crypto.ts';
import { hookUrl, type SupabaseRepo } from '../_shared/db.ts';
import { gcal, GoogleError, googleAccessToken, parseServiceAccount } from '../_shared/google.ts';
import { HttpError } from '../_shared/http.ts';

// ---------------------------------------------------------------------------
// Calendly
// ---------------------------------------------------------------------------
interface CalUser {
  uri: string;
  name: string;
  email: string;
  current_organization: string;
}

export async function calendlyConnect(repo: SupabaseRepo, token: string) {
  token = token.trim();
  if (token.length < 20) throw new HttpError(400, 'Bitte den kompletten Calendly-Token einfügen.');
  const me = await calendly<{ resource: CalUser }>(token, 'GET', '/users/me');
  const user = me.resource;
  await repo.setSecret('CALENDLY_TOKEN', token);

  let key = await repo.secret('CALENDLY_SIGNING_KEY');
  let newKey = false;
  if (!key) {
    key = randomToken(24);
    await repo.setSecret('CALENDLY_SIGNING_KEY', key);
    newKey = true;
  }

  const url = hookUrl('calendly-webhook');
  const existing = await findSubscription(token, user, url);
  let sub = existing;
  if (sub && newKey) {
    await calendly(token, 'DELETE', sub.uri);
    sub = null;
  }
  if (!sub) {
    const events = ['invitee.created', 'invitee.canceled'];
    try {
      sub = (await calendly<{ resource: Sub }>(token, 'POST', '/webhook_subscriptions', {
        url,
        events,
        organization: user.current_organization,
        scope: 'organization',
        signing_key: key,
      })).resource;
    } catch (e) {
      if (!(e instanceof CalendlyError) || (e.status !== 403 && e.status !== 400)) throw e;
      try {
        sub = (await calendly<{ resource: Sub }>(token, 'POST', '/webhook_subscriptions', {
          url,
          events,
          organization: user.current_organization,
          user: user.uri,
          scope: 'user',
          signing_key: key,
        })).resource;
      } catch (e2) {
        if (e2 instanceof CalendlyError && e2.status === 403) {
          throw new HttpError(
            400,
            'Calendly erlaubt Webhooks erst ab dem Standard-Tarif. Bitte den Calendly-Tarif prüfen.',
          );
        }
        throw e2;
      }
    }
  }
  await repo.setSecret('CALENDLY_WEBHOOK_URI', sub!.uri);
  const links = await loadEventTypes(token, user);
  await repo.updateOrg({ calendly_links: links, calendly_connected_at: new Date().toISOString() });
  await repo.log('admin', 'info', 'Calendly verbunden', { user: user.email, scope: sub!.scope });
  return { ok: true, user: { name: user.name, email: user.email }, scope: sub!.scope, links };
}

interface Sub {
  uri: string;
  callback_url: string;
  scope: string;
}

async function findSubscription(token: string, user: CalUser, url: string): Promise<Sub | null> {
  for (const scope of ['organization', 'user']) {
    try {
      const qs = new URLSearchParams({ organization: user.current_organization, scope, count: '100' });
      if (scope === 'user') qs.set('user', user.uri);
      const list = await calendly<{ collection: Sub[] }>(token, 'GET', `/webhook_subscriptions?${qs}`);
      const hit = (list.collection ?? []).find((s) => s.callback_url === url);
      if (hit) return hit;
    } catch {
      /* fehlende Rechte für diesen Bereich ignorieren */
    }
  }
  return null;
}

async function loadEventTypes(token: string, user: CalUser) {
  type ET = { name: string; scheduling_url: string; duration: number; active: boolean; profile?: { name?: string } };
  let items: ET[] = [];
  try {
    const qs = new URLSearchParams({ organization: user.current_organization, active: 'true', count: '100' });
    items = (await calendly<{ collection: ET[] }>(token, 'GET', `/event_types?${qs}`)).collection ?? [];
  } catch {
    const qs = new URLSearchParams({ user: user.uri, active: 'true', count: '100' });
    items = (await calendly<{ collection: ET[] }>(token, 'GET', `/event_types?${qs}`)).collection ?? [];
  }
  return items.map((et) => ({
    name: et.name,
    url: et.scheduling_url,
    duration: et.duration,
    owner: et.profile?.name ?? null,
    source: 'calendly',
  }));
}

export async function calendlyRefresh(repo: SupabaseRepo) {
  const token = await repo.secret('CALENDLY_TOKEN');
  if (!token) throw new HttpError(409, 'Calendly ist nicht verbunden.');
  const me = await calendly<{ resource: CalUser }>(token, 'GET', '/users/me');
  const links = await loadEventTypes(token, me.resource);
  const org = await repo.org();
  const manual = (org.calendly_links as { source?: string }[]).filter((l) => l.source !== 'calendly');
  await repo.updateOrg({ calendly_links: [...links, ...manual] });
  return { ok: true, links };
}

export async function calendlyDisconnect(repo: SupabaseRepo) {
  const token = await repo.secret('CALENDLY_TOKEN');
  const hook = await repo.secret('CALENDLY_WEBHOOK_URI');
  if (token && hook) await calendly(token, 'DELETE', hook).catch(() => null);
  await repo.setSecret('CALENDLY_TOKEN', '');
  await repo.setSecret('CALENDLY_WEBHOOK_URI', '');
  await repo.updateOrg({ calendly_connected_at: null });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Google Kalender
// ---------------------------------------------------------------------------
export async function googleConnect(repo: SupabaseRepo, raw: string) {
  const sa = parseServiceAccount(raw.trim());
  await googleAccessToken(sa); // prüft den Schlüssel
  await repo.setSecret('GOOGLE_SERVICE_ACCOUNT', JSON.stringify(sa));
  return { ok: true, email: sa.client_email };
}

export async function googleAddCalendar(repo: SupabaseRepo, calendarId: string, label: string) {
  calendarId = calendarId.trim();
  if (!calendarId) throw new HttpError(400, 'Bitte die Kalender-ID eingeben.');
  const raw = await repo.secret('GOOGLE_SERVICE_ACCOUNT');
  if (!raw) throw new HttpError(409, 'Zuerst den Google-Schlüssel hochladen.');
  const sa = parseServiceAccount(raw);
  const token = await googleAccessToken(sa);
  try {
    await gcal(token, 'POST', '/users/me/calendarList', { id: calendarId });
  } catch (e) {
    if (!(e instanceof GoogleError) || e.status !== 409) {
      throw new HttpError(
        400,
        `Kein Zugriff auf diesen Kalender. Bitte den Kalender in Google mit ${sa.client_email} teilen (Berechtigung „Änderungen an Terminen vornehmen“) und die Kalender-ID prüfen.`,
      );
    }
  }
  const info = await gcal<{ summary?: string }>(token, 'GET', `/calendars/${encodeURIComponent(calendarId)}`);
  await gcal(token, 'GET', `/calendars/${encodeURIComponent(calendarId)}/events?maxResults=1`);
  const org = await repo.org();
  const list = (org.gcal_calendars ?? []).filter((c) => c.id !== calendarId);
  list.push({ id: calendarId, label: label.trim() || info.summary || calendarId });
  await repo.updateOrg({ gcal_calendars: list, gcal_last_error: null });
  return { ok: true, calendars: list };
}

export async function googleRemoveCalendar(repo: SupabaseRepo, calendarId: string) {
  const org = await repo.org();
  const list = (org.gcal_calendars ?? []).filter((c) => c.id !== calendarId);
  await repo.updateOrg({ gcal_calendars: list });
  return { ok: true, calendars: list };
}

// ---------------------------------------------------------------------------
// KI: Abschriften (AssemblyAI, EU) und Zusammenfassungen (Anthropic)
// ---------------------------------------------------------------------------
export async function aiConnect(repo: SupabaseRepo, b: Record<string, unknown>) {
  const aai = typeof b.assemblyai_key === 'string' ? b.assemblyai_key.trim() : '';
  const ant = typeof b.anthropic_key === 'string' ? b.anthropic_key.trim() : '';
  const model = typeof b.anthropic_model === 'string' && /^claude-[a-z0-9.-]+$/.test(b.anthropic_model) ? b.anthropic_model : null;
  if (!aai && !ant && !model) throw new HttpError(400, 'Bitte einen Schlüssel eintragen.');
  if (aai) {
    try {
      await checkAssemblyKey(aai);
    } catch (e) {
      throw new HttpError(400, e instanceof Error ? e.message : String(e));
    }
    await repo.setSecret('ASSEMBLYAI_API_KEY', aai);
  }
  if (ant || model) {
    const key = ant || (await repo.secret('ANTHROPIC_API_KEY'));
    if (!key) throw new HttpError(400, 'Bitte zuerst den Anthropic-Schlüssel eintragen.');
    const m = model || (await repo.secret('ANTHROPIC_MODEL')) || DEFAULT_SUMMARY_MODEL;
    try {
      await checkAnthropicKey(key, m);
    } catch (e) {
      throw new HttpError(400, e instanceof Error ? e.message : String(e));
    }
    if (ant) await repo.setSecret('ANTHROPIC_API_KEY', ant);
    if (model) await repo.setSecret('ANTHROPIC_MODEL', model);
  }
  await repo.log('admin', 'info', 'KI-Zugang gespeichert', { assemblyai: !!aai, anthropic: !!ant, model });
  return { ok: true };
}
