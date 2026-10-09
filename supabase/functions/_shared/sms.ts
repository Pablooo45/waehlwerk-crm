// SMS über Twilio senden (sofort oder vom Zeitplan) und Rückmeldungen übernehmen.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.117.2';
import { check, hookUrl, type PhoneNumberRow, type Repo } from './db.ts';
import { twilioFromRepo } from './telephony.ts';
import { TwilioError } from './twilio.ts';

export interface SmsRow {
  id: string;
  lead_id: string | null;
  contact_id: string | null;
  user_id: string | null;
  direction: 'outbound' | 'inbound';
  from_number: string | null;
  to_number: string | null;
  body: string;
  status: string;
  twilio_sid: string | null;
}

// Absender: gewünschte Nummer (wenn SMS-fähig und erlaubt) → eigene Nummer → erste SMS-fähige Nummer
export function pickSmsFrom(o: {
  requested: string | null;
  profileNumber: string | null;
  userId: string;
  numbers: Pick<PhoneNumberRow, 'number' | 'sms_capable' | 'available_to_all' | 'members'>[];
}): string | null {
  const usable = o.numbers.filter((n) => n.sms_capable && (n.available_to_all || n.members.includes(o.userId)));
  if (o.requested && usable.some((n) => n.number === o.requested)) return o.requested;
  if (o.profileNumber && usable.some((n) => n.number === o.profileNumber)) return o.profileNumber;
  return usable[0]?.number ?? null;
}

// Twilio-Status → unser Status
export function smsStatus(tw: string): string {
  switch (tw) {
    case 'accepted':
    case 'queued':
    case 'scheduled':
      return 'queued';
    case 'sending':
      return 'sending';
    case 'sent':
      return 'sent';
    case 'delivered':
    case 'read':
      return 'delivered';
    case 'undelivered':
      return 'undelivered';
    case 'failed':
    case 'canceled':
      return 'failed';
    case 'received':
    case 'receiving':
      return 'received';
    default:
      return 'sent';
  }
}

function twilioMessage(e: unknown): string {
  if (e instanceof TwilioError) {
    if (e.code === 21408 || e.code === 21612) return 'SMS in dieses Land ist bei Twilio nicht freigeschaltet (Messaging → Settings → Geo Permissions).';
    if (e.code === 21610) return 'Der Empfänger hat SMS von dieser Nummer abbestellt.';
    if (e.code === 21211 || e.code === 21614) return 'Die Empfängernummer ist ungültig oder kann keine SMS empfangen.';
    if (e.code === 21606 || e.code === 21659) return 'Diese Absendernummer kann keine SMS senden.';
    return e.message;
  }
  return e instanceof Error ? e.message : String(e);
}

export async function sendSmsRow(env: { db: SupabaseClient; repo: Repo }, smsId: string): Promise<{ ok: boolean; error?: string }> {
  const { db, repo } = env;
  const sms = check(await db.from('sms_messages').select('*').eq('id', smsId).maybeSingle(), 'SMS') as SmsRow | null;
  if (!sms) return { ok: false, error: 'SMS nicht gefunden.' };
  if (!sms.from_number || !sms.to_number) {
    await db.from('sms_messages').update({ status: 'failed', error: 'Absender oder Empfänger fehlt.' }).eq('id', smsId);
    return { ok: false, error: 'Absender oder Empfänger fehlt.' };
  }
  try {
    await db.from('sms_messages').update({ status: 'sending' }).eq('id', smsId);
    const tw = await twilioFromRepo(repo);
    const r = await tw.request<{ sid: string; status: string }>('POST', '/Messages.json', {
      From: sms.from_number,
      To: sms.to_number,
      Body: sms.body,
      StatusCallback: hookUrl('twilio-sms', { type: 'status' }),
    });
    await db.from('sms_messages').update({ twilio_sid: r.sid, status: smsStatus(r.status), error: null }).eq('id', smsId);
    return { ok: true };
  } catch (e) {
    const msg = twilioMessage(e);
    await db.from('sms_messages').update({ status: 'failed', error: msg.slice(0, 500) }).eq('id', smsId);
    if (sms.user_id) await repo.notify(sms.user_id, 'sms', sms.lead_id, 'sms', sms.id, 'SMS nicht gesendet', msg);
    return { ok: false, error: msg };
  }
}
