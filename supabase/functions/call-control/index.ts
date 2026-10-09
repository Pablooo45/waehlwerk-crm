// Aktionen während eines Anrufs (aus dem Browser): Aufnahme, Mailbox-Drop, Weiterleiten, Coaching, Abschrift.

import { requireUser, SupabaseRepo } from '../_shared/db.ts';
import { errorResponse, HttpError, json, preflight, readJson } from '../_shared/http.ts';
import { telCtx } from '../_shared/server.ts';
import { TwilioError } from '../_shared/twilio.ts';
import { type ControlBody, handleControl } from './logic.ts';

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  const repo = new SupabaseRepo();
  let body: ControlBody | null = null;
  try {
    const user = await requireUser(req, repo);
    body = await readJson<ControlBody>(req);
    return json(await handleControl(telCtx(repo), user, body));
  } catch (e) {
    if (e instanceof TwilioError) {
      await repo.log('call-control', 'error', e.message, { body });
      const friendly = e.status === 404
        ? 'Der Anruf ist bei Twilio schon beendet.'
        : `Twilio hat die Aktion abgelehnt: ${e.message}`;
      return errorResponse(new HttpError(502, friendly));
    }
    if (!(e instanceof HttpError)) await repo.log('call-control', 'error', String(e), { body });
    return errorResponse(e);
  }
});
