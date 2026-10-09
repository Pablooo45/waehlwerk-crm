// Gemeinsame Telefonie-Bausteine für twilio-voice, twilio-status und call-control.

import type { CallRow, OrgSettings, PhoneNumberRow, Repo } from './db.ts';
import { HttpError } from './http.ts';
import type { MediaSink } from './recording.ts';
import { el, say, twiml, TwilioClient, validateTwilioSignature, type XmlNode } from './twilio.ts';

export type FnUrl = (name: string, query?: Record<string, string | null | undefined>) => string;

export interface TelCtx {
  repo: Repo;
  fn: FnUrl; // Adressen, die Twilio aufruft (mit fester Region)
  twilio: () => Promise<TwilioClient>;
  bg: (task: Promise<unknown>) => void; // nach der Antwort an Twilio weiterarbeiten
  media?: MediaSink; // Speicher für Aufnahmen (Standard: repo.upload)
  now?: () => Date;
}

export const CONF_REGION = 'de1'; // Konferenzen in Frankfurt mischen (kurze Wege)

export function confName(callId: string): string {
  return `call-${callId}`;
}

export async function twilioFromRepo(repo: Repo): Promise<TwilioClient> {
  const sid = await repo.secret('TWILIO_ACCOUNT_SID');
  const token = await repo.secret('TWILIO_AUTH_TOKEN');
  if (!sid || !token) {
    throw new HttpError(409, 'Telefonie ist noch nicht eingerichtet (Einstellungen → Telefonie).');
  }
  return new TwilioClient(sid, token);
}

// Kommt die Anfrage wirklich von Twilio? (Signatur über die öffentliche Adresse)
export async function verifyTwilioRequest(
  req: Request,
  repo: Repo,
  baseUrl: (name: string) => string,
  fnName: string,
  params: Record<string, string>,
  region: string | null,
): Promise<boolean> {
  const token = await repo.secret('TWILIO_AUTH_TOKEN');
  if (!token) return false;
  const url = new URL(req.url);
  const base = baseUrl(fnName);
  const candidates = [base + url.search];
  // Falls das Gateway den Regions-Parameter vor der Funktion entfernt: wieder anhängen (steht bei uns immer am Ende)
  if (region && !url.searchParams.has('forceFunctionRegion')) {
    candidates.push(`${base}${url.search ? `${url.search}&` : '?'}forceFunctionRegion=${encodeURIComponent(region)}`);
  }
  candidates.push(req.url);
  const ok = await validateTwilioSignature(token, req.headers.get('X-Twilio-Signature'), candidates, params);
  if (!ok) {
    await repo.log(fnName, 'error', 'Twilio-Signatur ungültig – Anfrage abgelehnt', {
      tried: candidates,
      hint: 'Stimmt CRM_FUNCTIONS_URL / SUPABASE_URL? Wurde der Auth Token geändert?',
    });
  }
  return ok;
}

// ---------------------------------------------------------------------------
// Aufnahmen
// ---------------------------------------------------------------------------
export type RecMode = OrgSettings['recording_mode'];

// Aufnahme-Einstellungen für <Dial>. Zwei Spuren: Spur 1 = Hauptanruf, Spur 2 = angerufene Seite.
// ausgehend: Hauptanruf = wir (Browser) → unsere Stimme auf Spur 1
// eingehend: Hauptanruf = Kunde → unsere Stimme auf Spur 2
export function dialRecordingAttrs(mode: RecMode, direction: 'outbound' | 'inbound', callbackUrl: string): Record<string, string> | null {
  const cb = {
    recordingStatusCallback: callbackUrl,
    recordingStatusCallbackEvent: 'in-progress completed absent',
    recordingStatusCallbackMethod: 'POST',
  };
  if (mode === 'auto') return { record: 'record-from-answer-dual', recordingTrack: 'both', ...cb };
  if (mode === 'auto_agent') {
    return { record: 'record-from-answer', recordingTrack: direction === 'outbound' ? 'inbound' : 'outbound', ...cb };
  }
  return null;
}

// Auf welcher Spur liegt unsere Stimme? (Konferenz: aufgenommen wird die Leitung des Kunden → wir auf Spur 2)
export function agentChannelFor(call: Pick<CallRow, 'direction' | 'conference_name'>): number {
  if (call.conference_name) return 2;
  return call.direction === 'outbound' ? 1 : 2;
}

// Welche Leitung trägt die Aufnahme? Konferenz: Kunde; sonst der Hauptanruf
export function recordingCallSid(call: CallRow): string | null {
  if (call.conference_name) return call.twilio_child_sid ?? null;
  return call.twilio_call_sid;
}

// Eingehende Anrufe: Einstellung der Nummer schlägt die der Organisation
export function inboundRecordMode(org: OrgSettings, n: PhoneNumberRow | null): RecMode {
  if (org.recording_mode === 'off' || n?.record_inbound === false) return 'off';
  if (n?.record_inbound === true) return org.recording_mode === 'auto_agent' ? 'auto_agent' : 'auto';
  return org.recording_mode;
}

export function isAutoRecording(mode: RecMode): boolean {
  return mode === 'auto' || mode === 'auto_agent';
}

// ---------------------------------------------------------------------------
// Bausteine für TwiML
// ---------------------------------------------------------------------------
export async function greetingNode(repo: Repo, org: OrgSettings): Promise<XmlNode> {
  if (org.voicemail_greeting_path) {
    try {
      const url = await repo.signedUrl('voicemails', org.voicemail_greeting_path, 900);
      return el('Play', {}, url);
    } catch (e) {
      await repo.log('twilio-voice', 'warn', 'Mailbox-Ansage nicht gefunden, nutze Text', { error: String(e) });
    }
  }
  return say(org.voicemail_greeting_text || 'Bitte hinterlassen Sie eine Nachricht nach dem Signalton.');
}

export async function voicemailTwiml(ctx: TelCtx, org: OrgSettings, callId: string, pre: XmlNode[] = []): Promise<string> {
  return twiml(
    ...pre,
    await greetingNode(ctx.repo, org),
    el('Record', {
      maxLength: 180,
      playBeep: 'true',
      timeout: 5,
      trim: 'trim-silence',
      recordingStatusCallback: ctx.fn('twilio-status', { type: 'voicemail', callId }),
      recordingStatusCallbackEvent: 'completed',
      recordingStatusCallbackMethod: 'POST',
      action: ctx.fn('twilio-voice', { step: 'vm-done', callId }),
      method: 'POST',
    }),
    el('Hangup'),
  );
}

export function clientNode(
  ctx: TelCtx,
  identity: string,
  callId: string,
  params: Record<string, string | null | undefined>,
): XmlNode {
  const children: XmlNode[] = [el('Identity', {}, identity)];
  for (const [name, value] of Object.entries({ callId, ...params })) {
    if (value) children.push(el('Parameter', { name, value: String(value).slice(0, 200) }));
  }
  return el(
    'Client',
    {
      statusCallback: ctx.fn('twilio-status', { type: 'inbound-leg', callId, uid: identity }),
      statusCallbackEvent: 'answered completed',
      statusCallbackMethod: 'POST',
    },
    ...children,
  );
}

// Handy eines Kollegen: Annahme per Taste bestätigen, damit keine Handy-Mailbox den Anruf „annimmt“
export function mobileNode(ctx: TelCtx, number: string, callId: string, uid: string | null, screen = true): XmlNode {
  return el(
    'Number',
    {
      statusCallback: ctx.fn('twilio-status', { type: 'inbound-leg', callId, uid }),
      statusCallbackEvent: 'answered completed',
      statusCallbackMethod: 'POST',
      url: screen ? ctx.fn('twilio-voice', { step: 'screen', callId }) : undefined,
      method: screen ? 'POST' : undefined,
    },
    number,
  );
}

// Parameter für das Browser-Telefon eines Kollegen bei Konferenz-Teilnehmern (stehen im „To“)
export function clientTo(identity: string, params: Record<string, string | null | undefined>): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) qs.set(k, String(v).slice(0, 120));
  const s = qs.toString();
  return `client:${identity}${s ? `?${s}` : ''}`;
}

export function displayNumber(e164: string | null | undefined): string {
  if (!e164) return 'unbekannt';
  if (e164.startsWith('+49')) return '0' + e164.slice(3);
  return e164;
}

export function int(v: string | undefined | null): number | null {
  if (v == null || v === '') return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

export const FINAL_STATUSES = new Set(['completed', 'busy', 'no-answer', 'failed', 'canceled']);

export function isFinal(status: string | null | undefined): boolean {
  return FINAL_STATUSES.has(status ?? '');
}

// ---------------------------------------------------------------------------
// Verpasste Anrufe: Aufgabe + Benachrichtigung (nur einmal je Anruf)
// ---------------------------------------------------------------------------
export async function callerLabel(repo: Repo, call: Pick<CallRow, 'lead_id' | 'from_number'>): Promise<string> {
  if (call.lead_id) {
    const lead = await repo.lead(call.lead_id);
    if (lead) return lead.name;
  }
  return displayNumber(call.from_number);
}

export async function markMissed(ctx: TelCtx, callId: string, reason: string, status: 'no-answer' | 'busy' = 'no-answer'): Promise<void> {
  const call = await ctx.repo.call(callId);
  // angenommen oder anders beendet → nicht verpasst
  if (!call || call.answered_at || call.status === 'in-progress' || call.status === 'completed') return;
  const already = call.status === 'no-answer' || call.status === 'busy';
  if (already) return;
  await ctx.repo.advanceCall(callId, status);
  const [org, who] = await Promise.all([ctx.repo.org(), callerLabel(ctx.repo, call)]);
  const title = `Verpasster Anruf von ${who}`;
  let fresh = true;
  if (org.missed_call_tasks) {
    fresh = await ctx.repo.insertTask({
      type: 'missed_call',
      title,
      lead_id: call.lead_id,
      contact_id: call.contact_id,
      assigned_to: call.user_id,
      call_id: call.id,
      due_at: (ctx.now?.() ?? new Date()).toISOString(),
      created_by: null,
    });
  }
  if (fresh && call.user_id) await ctx.repo.notify(call.user_id, 'missed_call', call.lead_id, 'call', call.id, title, reason);
}

// ---------------------------------------------------------------------------
// Laufende Anrufe steuern
// ---------------------------------------------------------------------------

// Leitung zum Kunden (ausgehend: Kind-Anruf bzw. Konferenz-Teilnehmer, eingehend: Hauptanruf)
export async function customerLegSid(twilio: TwilioClient, call: CallRow): Promise<string> {
  if (call.direction === 'inbound' && !call.conference_name) return call.twilio_call_sid!;
  if (call.twilio_child_sid) return call.twilio_child_sid;
  if (call.conference_name) throw new HttpError(409, 'Der Kunde ist noch nicht in der Leitung.');
  const list = await twilio.request<{ calls?: { sid: string; status: string }[] }>('GET', '/Calls.json', {
    ParentCallSid: call.twilio_call_sid!,
    PageSize: 5,
  });
  const active = (list.calls ?? []).find((c) => c.status === 'in-progress') ?? list.calls?.[0];
  if (!active) throw new HttpError(409, 'Der Kunde ist nicht (mehr) in der Leitung.');
  return active.sid;
}

// SID der Konferenz (aus der Statusmeldung; zur Not bei Twilio nachschlagen)
export async function conferenceSid(ctx: TelCtx, twilio: TwilioClient, call: CallRow): Promise<string> {
  if (call.conference_sid) return call.conference_sid;
  if (!call.conference_name) throw new HttpError(409, 'Dieses Gespräch läuft nicht als Konferenz.');
  const r = await twilio.request<{ conferences?: { sid: string }[] }>('GET', '/Conferences.json', {
    FriendlyName: call.conference_name,
    Status: 'in-progress',
    PageSize: 1,
  });
  const sid = r.conferences?.[0]?.sid;
  if (!sid) throw new HttpError(409, 'Das Gespräch ist schon beendet.');
  await ctx.repo.updateCall(call.id, { conference_sid: sid });
  return sid;
}
