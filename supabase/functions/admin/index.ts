// Verwaltung: Team, Twilio, Calendly, Google, KI, Umzug aus Close, Systemstatus.
// Alle Zugangsdaten landen in private.kv (nur Server-Zugriff), nie im Browser.

import { CalendlyError } from '../_shared/calendly.ts';
import { type Caller, functionRegion, functionUrl, hookUrl, requirePerm, requireUser, type SupabaseRepo, SupabaseRepo as Repo } from '../_shared/db.ts';
import { GoogleError, parseServiceAccount } from '../_shared/google.ts';
import { errorResponse, HttpError, json, preflight, readJson } from '../_shared/http.ts';
import { TwilioClient, TwilioError } from '../_shared/twilio.ts';
import { CloseError, closeConnect, closeImport } from './close.ts';
import {
  aiConnect,
  calendlyConnect,
  calendlyDisconnect,
  calendlyRefresh,
  googleAddCalendar,
  googleConnect,
  googleRemoveCalendar,
} from './integrations.ts';
import { createUser, deleteUser, resetPassword, updateUser } from './team.ts';
import { twilioConnect, twilioSetup, twilioSyncNumbers, voiceAppParams } from './twilio.ts';

type Body = Record<string, unknown> & { action?: string };

// Welches Recht braucht welche Aktion?
const PERM: Record<string, string> = {
  twilio_connect: 'manage_organization',
  twilio_setup: 'manage_organization',
  twilio_sync_numbers: 'manage_phone_numbers',
  create_user: 'manage_organization',
  update_user: 'manage_organization',
  delete_user: 'manage_organization',
  reset_password: 'manage_organization',
  calendly_connect: 'manage_organization',
  calendly_refresh: 'manage_organization',
  calendly_disconnect: 'manage_organization',
  google_connect: 'manage_organization',
  google_add_calendar: 'manage_organization',
  google_remove_calendar: 'manage_organization',
  ai_connect: 'manage_organization',
  close_connect: 'manage_organization',
  close_import: 'manage_organization',
};

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  const repo = new Repo();
  let action = '';
  try {
    const body = await readJson<Body>(req);
    action = String(body.action ?? '');
    if (action === 'status') {
      const user = await requireUser(req, repo);
      return json(await status(repo, user));
    }
    const perm = PERM[action];
    if (!perm) throw new HttpError(400, `Unbekannte Aktion: ${action}`);
    const user = await requirePerm(req, repo, perm, 'Dafür fehlt dir die Berechtigung.');
    switch (action) {
      case 'twilio_connect':
        return json(await twilioConnect(repo, String(body.accountSid ?? ''), String(body.authToken ?? '')));
      case 'twilio_setup':
        return json(await twilioSetup(repo));
      case 'twilio_sync_numbers':
        return json(await twilioSyncNumbers(repo));
      case 'create_user':
        return json(await createUser(repo, body));
      case 'update_user':
        return json(await updateUser(repo, body));
      case 'delete_user':
        return json(await deleteUser(repo, body, user.id));
      case 'reset_password':
        return json(await resetPassword(repo, body));
      case 'calendly_connect':
        return json(await calendlyConnect(repo, String(body.token ?? '')));
      case 'calendly_refresh':
        return json(await calendlyRefresh(repo));
      case 'calendly_disconnect':
        return json(await calendlyDisconnect(repo));
      case 'google_connect':
        return json(await googleConnect(repo, String(body.serviceAccountJson ?? '')));
      case 'google_add_calendar':
        return json(await googleAddCalendar(repo, String(body.calendarId ?? ''), String(body.label ?? '')));
      case 'google_remove_calendar':
        return json(await googleRemoveCalendar(repo, String(body.calendarId ?? '')));
      case 'ai_connect':
        return json(await aiConnect(repo, body));
      case 'close_connect':
        return json(await closeConnect(repo, String(body.apiKey ?? '')));
      case 'close_import':
        return json(await closeImport(repo, String(body.stage ?? ''), typeof body.cursor === 'string' ? body.cursor : null));
    }
    throw new HttpError(400, `Unbekannte Aktion: ${action}`);
  } catch (e) {
    let err = e;
    if (e instanceof TwilioError) {
      err = new HttpError(
        e.status === 401 ? 400 : 502,
        e.status === 401 ? 'Twilio lehnt die Zugangsdaten ab. Bitte Account SID und Auth Token prüfen.' : e.message,
      );
    } else if (e instanceof CalendlyError) {
      err = new HttpError(e.status === 401 ? 400 : 502, e.status === 401 ? 'Calendly lehnt den Token ab.' : e.message);
    } else if (e instanceof GoogleError) {
      err = new HttpError(502, e.message);
    } else if (e instanceof CloseError) {
      err = new HttpError(e.status === 401 || e.status === 403 ? 400 : 502, e.message);
    }
    if (!(e instanceof HttpError)) await repo.log('admin', 'error', `${action}: ${e instanceof Error ? e.message : String(e)}`);
    return errorResponse(err);
  }
});

// ---------------------------------------------------------------------------
// Systemstatus (Diagnose, Einstellungen)
// ---------------------------------------------------------------------------
async function status(repo: SupabaseRepo, user: Caller) {
  const keys = [
    'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_API_KEY_SID', 'TWILIO_TWIML_APP_SID', 'CALENDLY_TOKEN', 'CALENDLY_WEBHOOK_URI',
    'GOOGLE_SERVICE_ACCOUNT', 'ASSEMBLYAI_API_KEY', 'ANTHROPIC_API_KEY', 'ANTHROPIC_MODEL', 'CLOSE_API_KEY', 'JOBS_LAST_RUN', 'CRON_TOKEN',
  ] as const;
  const values = await Promise.all(keys.map((k) => repo.secret(k)));
  const s = Object.fromEntries(keys.map((k, i) => [k, values[i]])) as Record<(typeof keys)[number], string | null>;
  const org = await repo.org();
  const lastRun = s.JOBS_LAST_RUN ? Date.parse(s.JOBS_LAST_RUN) : 0;
  const out: Record<string, unknown> = {
    functionsUrl: functionUrl(''),
    region: functionRegion(),
    twilio: { connected: !!(s.TWILIO_ACCOUNT_SID && s.TWILIO_AUTH_TOKEN), ready: !!(s.TWILIO_ACCOUNT_SID && s.TWILIO_AUTH_TOKEN && s.TWILIO_API_KEY_SID && s.TWILIO_TWIML_APP_SID) },
    calendly: { connected: !!s.CALENDLY_TOKEN, webhook: !!s.CALENDLY_WEBHOOK_URI, connectedAt: org.calendly_connected_at },
    google: {
      connected: !!s.GOOGLE_SERVICE_ACCOUNT,
      email: s.GOOGLE_SERVICE_ACCOUNT ? safeEmail(s.GOOGLE_SERVICE_ACCOUNT) : null,
      calendars: org.gcal_calendars ?? [],
      lastSync: org.gcal_last_sync,
      lastError: org.gcal_last_error,
    },
    ai: { assemblyai: !!s.ASSEMBLYAI_API_KEY, anthropic: !!s.ANTHROPIC_API_KEY, model: s.ANTHROPIC_MODEL },
    close: { connected: !!s.CLOSE_API_KEY },
    jobs: { scheduled: !!s.CRON_TOKEN, lastRun: s.JOBS_LAST_RUN, healthy: !!lastRun && Date.now() - lastRun < 5 * 60_000 },
  };
  // Aufnahmen der letzten 7 Tage, die (noch) nicht gespeichert werden konnten
  const failed = await repo.db.from('calls').select('id', { count: 'exact', head: true })
    .eq('recording_status', 'failed').gte('started_at', new Date(Date.now() - 7 * 86_400_000).toISOString());
  out.recordings = { failed: failed.error ? null : failed.count ?? 0 };
  if (user.isAdmin && s.TWILIO_ACCOUNT_SID && s.TWILIO_AUTH_TOKEN) {
    const tw = out.twilio as Record<string, unknown>;
    try {
      const twilio = new TwilioClient(s.TWILIO_ACCOUNT_SID, s.TWILIO_AUTH_TOKEN);
      const account = await twilio.request<{ friendly_name: string; status: string; type: string }>('GET', '.json');
      tw.account = { name: account.friendly_name, status: account.status, type: account.type };
      if (s.TWILIO_TWIML_APP_SID) {
        const app = await twilio.request<{ voice_url: string; status_callback: string }>('GET', `/Applications/${s.TWILIO_TWIML_APP_SID}.json`);
        tw.voiceUrlOk = app.voice_url === voiceAppParams().VoiceUrl;
      }
      tw.smsUrl = hookUrl('twilio-sms');
    } catch (e) {
      tw.error = e instanceof Error ? e.message : String(e);
    }
  }
  return out;
}

function safeEmail(raw: string): string | null {
  try {
    return parseServiceAccount(raw).client_email;
  } catch {
    return null;
  }
}
