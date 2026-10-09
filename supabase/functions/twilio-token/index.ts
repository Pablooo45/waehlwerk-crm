// Gibt dem Browser einen Zugangsschlüssel fürs Telefonieren (gilt 1 Stunde, wird automatisch erneuert).

import { requireUser, SupabaseRepo } from '../_shared/db.ts';
import { errorResponse, HttpError, json, preflight } from '../_shared/http.ts';
import { createVoiceAccessToken } from '../_shared/twilio.ts';

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  const repo = new SupabaseRepo();
  try {
    const user = await requireUser(req, repo);
    if (!user.can('calling')) throw new HttpError(403, 'Deine Rolle darf nicht telefonieren. Ein Admin kann das unter Einstellungen → Rollen ändern.');
    const [accountSid, apiKeySid, apiKeySecret, appSid, org] = await Promise.all([
      repo.secret('TWILIO_ACCOUNT_SID'),
      repo.secret('TWILIO_API_KEY_SID'),
      repo.secret('TWILIO_API_KEY_SECRET'),
      repo.secret('TWILIO_TWIML_APP_SID'),
      repo.org(),
    ]);
    if (!accountSid || !apiKeySid || !apiKeySecret || !appSid) {
      throw new HttpError(409, 'Telefonie ist noch nicht eingerichtet. Ein Admin muss unter Einstellungen → Telefonie Twilio verbinden.');
    }
    const ttl = 3600;
    const token = await createVoiceAccessToken({ accountSid, apiKeySid, apiKeySecret, appSid, identity: user.id, ttlSeconds: ttl });
    return json({
      token,
      identity: user.id,
      ttl,
      edge: (Deno.env.get('TWILIO_EDGE') || 'frankfurt,dublin').split(',').map((s) => s.trim()).filter(Boolean),
      callerId: user.phone_number || org.default_caller_id || (await repo.anyPhoneNumber()),
      recordingMode: org.recording_mode,
    });
  } catch (e) {
    if (!(e instanceof HttpError)) await repo.log('twilio-token', 'error', String(e));
    return errorResponse(e);
  }
});
