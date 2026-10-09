// Google-Kalender-Abgleich (alle 5 Minuten per Zeitplan + auf Knopfdruck)
// und Termine aus dem CRM in den Kalender eintragen.

import { requireUser, SupabaseRepo } from '../_shared/db.ts';
import { parseServiceAccount } from '../_shared/google.ts';
import { errorResponse, HttpError, json, preflight, readJson } from '../_shared/http.ts';
import { createCalendarEvent, type CreateEventInput, syncCalendars } from './logic.ts';

interface Body {
  action?: 'sync' | 'create';
  force?: boolean;
  appUrl?: string;
  event?: CreateEventInput;
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  const repo = new SupabaseRepo();
  try {
    const body = await readJson<Body>(req);
    const raw = await repo.secret('GOOGLE_SERVICE_ACCOUNT');
    if (!raw) throw new HttpError(409, 'Google Kalender ist noch nicht verbunden (Einstellungen → Kalender).');
    const sa = parseServiceAccount(raw);

    if (body.action === 'create') {
      const user = await requireUser(req, repo);
      if (!body.event) throw new HttpError(400, 'Termindaten fehlen.');
      const appUrl = body.appUrl && /^https:\/\//.test(body.appUrl) ? body.appUrl : null;
      const result = await createCalendarEvent(repo, sa, user, body.event, appUrl);
      return json({ ok: true, ...result });
    }

    // Abgleich – ohne Anmeldung erlaubt (Zeitplan), aber höchstens einmal pro Minute
    const org = await repo.org();
    const last = org.gcal_last_sync ? new Date(org.gcal_last_sync).getTime() : 0;
    if (Date.now() - last < 60_000 && !body.force) {
      return json({ ok: true, skipped: 'Gerade erst abgeglichen.' });
    }
    await repo.updateOrg({ gcal_last_sync: new Date().toISOString() });
    const result = await syncCalendars(repo, sa, org.gcal_calendars ?? []);
    await repo.updateOrg({
      gcal_last_sync: new Date().toISOString(),
      gcal_last_error: result.errors.length ? result.errors.join(' | ').slice(0, 1000) : null,
    });
    if (result.errors.length) await repo.log('gcal-sync', 'error', 'Kalender-Abgleich mit Fehlern', result);
    return json({ ok: true, ...result });
  } catch (e) {
    if (!(e instanceof HttpError)) await repo.log('gcal-sync', 'error', String(e));
    return errorResponse(e);
  }
});
