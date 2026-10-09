// Twilio meldet hier eingehende SMS und den Zustellstatus gesendeter SMS.

import { check, SupabaseRepo } from '../_shared/db.ts';
import { readForm, xml } from '../_shared/http.ts';
import { normalizePhone } from '../_shared/phone.ts';
import { verifyTwilio } from '../_shared/server.ts';
import { smsStatus } from '../_shared/sms.ts';
import { twiml } from '../_shared/twilio.ts';

Deno.serve(async (req) => {
  const repo = new SupabaseRepo();
  const url = new URL(req.url);
  const { params: p } = await readForm(req);
  try {
    if (!(await verifyTwilio(req, repo, 'twilio-sms', p))) return new Response('Ungültige Signatur', { status: 403 });
    if (url.searchParams.get('type') === 'status') {
      if (p.MessageSid && p.MessageStatus) {
        await repo.db.from('sms_messages').update({
          status: smsStatus(p.MessageStatus),
          ...(p.ErrorCode ? { error: `Twilio-Fehler ${p.ErrorCode}` } : {}),
        }).eq('twilio_sid', p.MessageSid);
      }
      return new Response(null, { status: 204 });
    }
    // Eingehende SMS → beim passenden Lead ablegen, Zuständigen benachrichtigen
    const from = normalizePhone(p.From) ?? p.From ?? null;
    const to = normalizePhone(p.To) ?? p.To ?? null;
    const match = from ? await repo.findByPhone(from) : null;
    const number = to ? await repo.phoneNumber(to) : null;
    const ins = await repo.db.from('sms_messages').insert({
      lead_id: match?.lead_id ?? null,
      contact_id: match?.contact_id ?? null,
      user_id: null,
      direction: 'inbound',
      from_number: from,
      to_number: to,
      body: String(p.Body ?? '').slice(0, 5000),
      status: 'received',
      twilio_sid: p.MessageSid ?? null,
    }).select('id').single();
    if (ins.error && ins.error.code !== '23505') throw new Error(ins.error.message);
    const smsId = (ins.data as { id: string } | null)?.id ?? null;
    const preview = String(p.Body ?? '').slice(0, 200);
    const who = match ? match.lead_name : from ?? 'unbekannt';
    // Empfänger: Zuständiger des Leads, sonst alle, die bei dieser Nummer klingeln
    let recipients: string[] = match?.owner_id ? [match.owner_id] : [];
    if (!recipients.length) {
      recipients = number?.members?.length ? number.members : (check(await repo.db.from('profiles').select('id').eq('active', true), 'Team') as { id: string }[]).map((r) => r.id);
    }
    for (const uid of recipients.slice(0, 20)) await repo.notify(uid, 'sms', match?.lead_id ?? null, 'sms', smsId, `SMS von ${who}`, preview);
    return xml(twiml());
  } catch (e) {
    await repo.log('twilio-sms', 'error', String(e), { params: p });
    return xml(twiml());
  }
});
