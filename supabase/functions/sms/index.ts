// SMS aus dem CRM senden (sofort oder geplant).

import { check, requireUser, SupabaseRepo } from '../_shared/db.ts';
import { errorResponse, HttpError, isUuid, json, preflight, readJson } from '../_shared/http.ts';
import { normalizePhone } from '../_shared/phone.ts';
import { pickSmsFrom, sendSmsRow } from '../_shared/sms.ts';

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  const repo = new SupabaseRepo();
  try {
    const user = await requireUser(req, repo);
    const b = await readJson<Record<string, unknown>>(req);
    if (b.action !== 'send') throw new HttpError(400, 'Unbekannte Aktion.');
    if (!user.can('calling')) throw new HttpError(403, 'Deine Rolle darf keine SMS senden.');
    const leadId = isUuid(b.lead_id) ? String(b.lead_id) : null;
    if (leadId) {
      const ok = check(await repo.db.rpc('user_can_see_lead', { p_user: user.id, p_lead: leadId }), 'Lead');
      if (!ok) throw new HttpError(404, 'Lead nicht gefunden.');
    }
    const to = normalizePhone(String(b.to ?? ''));
    if (!to) throw new HttpError(400, 'Die Handynummer ist ungültig.');
    const body = String(b.body ?? '').trim();
    if (!body) throw new HttpError(400, 'Bitte einen Text eingeben.');
    if (body.length > 1600) throw new HttpError(400, 'Höchstens 1.600 Zeichen.');
    const from = pickSmsFrom({
      requested: normalizePhone(String(b.from ?? '')),
      profileNumber: user.phone_number,
      userId: user.id,
      numbers: await repo.phoneNumbers(),
    });
    if (!from) throw new HttpError(409, 'Keine SMS-fähige Nummer vorhanden (Einstellungen → Telefonnummern).');
    const sendAt = typeof b.send_at === 'string' && Date.parse(b.send_at) > Date.now() + 30_000 ? new Date(b.send_at).toISOString() : null;
    const ins = check(
      await repo.db.from('sms_messages').insert({
        lead_id: leadId,
        contact_id: isUuid(b.contact_id) ? b.contact_id : null,
        user_id: user.id,
        direction: 'outbound',
        from_number: from,
        to_number: to,
        body,
        status: sendAt ? 'scheduled' : 'queued',
        send_at: sendAt,
      }).select('id').single(),
      'SMS',
    ) as { id: string };
    if (!sendAt) await sendSmsRow({ db: repo.db, repo }, ins.id);
    const sms = check(await repo.db.from('sms_messages').select('*').eq('id', ins.id).single(), 'SMS');
    return json({ sms });
  } catch (e) {
    if (!(e instanceof HttpError)) await repo.log('sms', 'error', String(e));
    return errorResponse(e);
  }
});
