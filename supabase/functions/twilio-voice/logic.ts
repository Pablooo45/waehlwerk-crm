// TwiML-Logik: Was passiert, wenn jemand anruft oder aus dem CRM gewählt wird.
//
// Ausgehend (Standard): <Dial> mit answerOnBridge – kürzester Weg, keine Verzögerung.
// Ausgehend im Konferenzmodus: wir und der Kunde in einer Konferenz in Frankfurt – dann gehen
//   Mithören/Einflüstern/Aufschalten und die Übergabe mit Rücksprache.
// Eingehend: Rufzeiten → Weiterleitung → Telefonmenü → Zuständiger → Gruppe/Team → Mailbox.

import type { Monitor, OrgSettings, PhoneMatch, PhoneNumberRow, Profile } from '../_shared/db.ts';
import { isUuid } from '../_shared/http.ts';
import { isAllowedNumber, normalizePhone } from '../_shared/phone.ts';
import { type Decision, firstDecision, ivrChoice, nextAfter, pickCallerId, type RouteInput, type Stage } from '../_shared/routing.ts';
import {
  callerLabel,
  clientNode,
  CONF_REGION,
  confName,
  dialRecordingAttrs,
  inboundRecordMode,
  int,
  isAutoRecording,
  isFinal,
  markMissed,
  mobileNode,
  type RecMode,
  type TelCtx,
  voicemailTwiml,
} from '../_shared/telephony.ts';
import { el, EMPTY_ATTR, say, twiml, type XmlNode } from '../_shared/twilio.ts';

const ANSWERED = new Set(['completed', 'answered']);

export async function handleVoice(ctx: TelCtx, step: string, q: URLSearchParams, p: Record<string, string>): Promise<string> {
  switch (step) {
    case 'dial-done':
      return dialDone(ctx, q, p);
    case 'conf-done':
      return confDone(ctx, q);
    case 'route':
      return routeNext(ctx, q, p);
    case 'ivr':
      return ivrStep(ctx, q, p);
    case 'screen':
      return screen(ctx, q);
    case 'screen-done':
      return p.Digits === '1' ? twiml() : twiml(el('Hangup'));
    case 'announce':
      return twiml(say((await ctx.repo.org()).recording_announcement_text));
    case 'transfer-done':
      return transferDone(ctx, q, p);
    case 'monitor-done':
      return monitorDone(ctx, q);
    case 'vm-done': {
      const callId = q.get('callId');
      if (isUuid(callId)) ctx.bg(noteRecording(ctx, callId, p, true));
      return twiml(el('Hangup'));
    }
    default:
      return (p.From ?? '').startsWith('client:') ? outbound(ctx, p) : inbound(ctx, p);
  }
}

function sayAndHangup(text: string): string {
  return twiml(say(text), el('Hangup'));
}

// Rückmeldung von <Dial>/<Record> nach dem Auflegen: Aufnahme-SID merken. Geht die Meldung
// „Aufnahme fertig“ verloren, holt die Hintergrundaufgabe die Aufnahme damit nach.
async function noteRecording(ctx: TelCtx, callId: string, p: Record<string, string>, voicemail = false) {
  if (!p.RecordingSid || int(p.RecordingDuration) === 0) return;
  const call = await ctx.repo.call(callId);
  if (!call || call.recording_path || call.recording_status !== 'none') return;
  await ctx.repo.updateCall(callId, { recording_status: 'recording', recording_sid: p.RecordingSid, ...(voicemail ? { is_voicemail: true } : {}) });
}

function now(ctx: TelCtx): Date {
  return ctx.now?.() ?? new Date();
}

// ---------------------------------------------------------------------------
// Ausgehend: Browser-Telefon → Kunde
// ---------------------------------------------------------------------------
async function outbound(ctx: TelCtx, p: Record<string, string>): Promise<string> {
  const userId = p.From.slice('client:'.length);
  if (!isUuid(userId)) return sayAndHangup('Unbekannter Absender.');
  const [profile, perms, org] = await Promise.all([ctx.repo.profile(userId), ctx.repo.permissions(userId), ctx.repo.org()]);
  if (!profile || !profile.active) return sayAndHangup('Dein Zugang ist nicht freigeschaltet.');
  if (isUuid(p.monitorCallId)) return monitorJoin(ctx, profile, perms, p);
  if (!perms.has('calling')) return sayAndHangup('Deine Rolle darf nicht telefonieren. Bitte wende dich an einen Admin.');

  const to = normalizePhone(p.To);
  if (!to) return sayAndHangup('Die gewählte Nummer ist ungültig.');
  if (!isAllowedNumber(to, org.allowed_prefixes)) {
    await ctx.repo.log('twilio-voice', 'warn', `Gesperrte Nummer gewählt: ${to}`, { user: userId });
    return sayAndHangup('Diese Nummer ist für Anrufe aus dem CRM gesperrt.');
  }
  const leadId = isUuid(p.leadId) ? p.leadId : null;
  const [numbers, lead, match] = await Promise.all([
    ctx.repo.phoneNumbers(),
    leadId ? ctx.repo.lead(leadId) : Promise.resolve(null),
    leadId ? Promise.resolve(null) : ctx.repo.findByPhone(to),
  ]);
  if (lead?.do_not_call || match?.do_not_call) {
    return sayAndHangup('Dieser Kontakt ist als nicht anrufen markiert.');
  }
  const callerId = pickCallerId({
    requested: normalizePhone(p.callerId),
    profileNumber: profile.phone_number,
    orgDefault: org.default_caller_id,
    numbers,
    userId,
    to,
    localPresence: org.local_presence,
  });
  if (!callerId) return sayAndHangup('Es ist noch keine Absendernummer eingerichtet. Bitte in den Einstellungen hinterlegen.');

  const callId = isUuid(p.callId) ? p.callId : crypto.randomUUID();
  const conference = org.conference_mode;
  await ctx.repo.upsertCall({
    id: callId,
    lead_id: leadId ?? match?.lead_id ?? null,
    contact_id: isUuid(p.contactId) ? p.contactId : match?.contact_id ?? null,
    user_id: userId,
    direction: 'outbound',
    from_number: callerId,
    to_number: to,
    status: 'initiated',
    twilio_call_sid: p.CallSid ?? null,
    dialer_session: isUuid(p.dialerSession) ? p.dialerSession : null,
    conference_name: conference ? confName(callId) : null,
  });

  const ringTimeout = isUuid(p.dialerSession) ? org.dialer_ring_timeout || 30 : 45;
  const mode = org.recording_mode;
  const announce = isAutoRecording(mode) && org.recording_announcement;

  if (conference) {
    ctx.bg(addCustomer(ctx, { callId, from: callerId, to, timeout: ringTimeout, mode }));
    return twiml(
      el(
        'Dial',
        { action: ctx.fn('twilio-voice', { step: 'conf-done', callId }), method: 'POST' },
        el(
          'Conference',
          {
            startConferenceOnEnter: 'true',
            endConferenceOnExit: 'true',
            beep: 'false',
            waitUrl: EMPTY_ATTR,
            participantLabel: 'agent',
            region: CONF_REGION,
            statusCallback: ctx.fn('twilio-status', { type: 'conference', callId }),
            statusCallbackEvent: 'start end join leave',
            statusCallbackMethod: 'POST',
          },
          confName(callId),
        ),
      ),
    );
  }

  const rec = dialRecordingAttrs(mode, 'outbound', ctx.fn('twilio-status', { type: 'recording', callId, ac: '1' }));
  return twiml(
    el(
      'Dial',
      {
        callerId,
        answerOnBridge: 'true',
        timeout: ringTimeout,
        ringTone: 'de',
        action: ctx.fn('twilio-voice', { step: 'dial-done', callId }),
        method: 'POST',
        ...(rec ?? {}),
      },
      el(
        'Number',
        {
          statusCallback: ctx.fn('twilio-status', { type: 'child', callId }),
          statusCallbackEvent: 'initiated ringing answered completed',
          statusCallbackMethod: 'POST',
          // Hinweis auf die Aufnahme hört der Kunde direkt nach dem Abheben
          url: announce ? ctx.fn('twilio-voice', { step: 'announce' }) : undefined,
          method: announce ? 'POST' : undefined,
        },
        to,
      ),
    ),
  );
}

// Konferenzmodus: Kunde als Teilnehmer dazuholen (läuft parallel zur Antwort an Twilio)
async function addCustomer(ctx: TelCtx, o: { callId: string; from: string; to: string; timeout: number; mode: RecMode }) {
  const name = confName(o.callId);
  const params: Record<string, string | number | boolean | string[] | undefined> = {
    From: o.from,
    To: o.to,
    Label: 'customer',
    EarlyMedia: true, // wir hören Freizeichen und Ansagen
    Beep: 'false',
    StartConferenceOnEnter: true,
    EndConferenceOnExit: true,
    Timeout: o.timeout,
    WaitUrl: '',
    Region: CONF_REGION,
    StatusCallback: ctx.fn('twilio-status', { type: 'participant', callId: o.callId }),
    StatusCallbackMethod: 'POST',
    StatusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
    ConferenceStatusCallback: ctx.fn('twilio-status', { type: 'conference', callId: o.callId }),
    ConferenceStatusCallbackMethod: 'POST',
    ConferenceStatusCallbackEvent: ['start', 'end', 'join', 'leave'],
  };
  if (isAutoRecording(o.mode)) {
    // Aufgenommen wird die Leitung des Kunden: Spur 1 = Kunde, Spur 2 = was er hört (wir)
    const dual = o.mode === 'auto';
    Object.assign(params, {
      Record: true,
      RecordingChannels: dual ? 'dual' : 'mono',
      RecordingTrack: dual ? 'both' : 'outbound',
      RecordingStatusCallback: ctx.fn('twilio-status', { type: 'recording', callId: o.callId, ac: dual ? '2' : '1' }),
      RecordingStatusCallbackMethod: 'POST',
      RecordingStatusCallbackEvent: ['in-progress', 'completed', 'absent'],
    });
  }
  try {
    const tw = await ctx.twilio();
    const r = await tw.request<{ call_sid?: string }>('POST', `/Conferences/${encodeURIComponent(name)}/Participants.json`, params);
    if (r?.call_sid) await ctx.repo.advanceCall(o.callId, 'initiated', r.call_sid);
  } catch (e) {
    await ctx.repo.log('twilio-voice', 'error', `Kunde konnte nicht angerufen werden: ${e instanceof Error ? e.message : e}`, { callId: o.callId });
    await ctx.repo.advanceCall(o.callId, 'failed');
    // Uns aus der leeren Konferenz holen
    const call = await ctx.repo.call(o.callId);
    if (call?.twilio_call_sid) {
      const tw = await ctx.twilio();
      await tw.request('POST', `/Calls/${call.twilio_call_sid}.json`, { Status: 'completed' }).catch(() => undefined);
    }
  }
}

async function dialDone(ctx: TelCtx, q: URLSearchParams, p: Record<string, string>): Promise<string> {
  const callId = q.get('callId');
  if (isUuid(callId)) {
    const st = ANSWERED.has(p.DialCallStatus) ? 'completed' : (p.DialCallStatus || 'completed');
    await ctx.repo.advanceCall(callId, st, p.DialCallSid || null, int(p.DialCallDuration));
    ctx.bg(noteRecording(ctx, callId, p));
  }
  return twiml(el('Hangup'));
}

// Wir haben die Konferenz verlassen (aufgelegt, Kunde weg, Übergabe abgeschlossen)
async function confDone(ctx: TelCtx, q: URLSearchParams): Promise<string> {
  const callId = q.get('callId');
  if (!isUuid(callId)) return twiml(el('Hangup'));
  const call = await ctx.repo.call(callId);
  if (!call) return twiml(el('Hangup'));
  if (call.status === 'in-progress') {
    const secs = call.answered_at ? Math.round((now(ctx).getTime() - Date.parse(call.answered_at)) / 1000) : null;
    // Bei abgeschlossener Übergabe läuft das Gespräch beim Kollegen weiter – unser Teil ist trotzdem fertig
    await ctx.repo.advanceCall(callId, 'completed', null, secs);
  } else if (!isFinal(call.status)) {
    // Aufgelegt, bevor der Kunde abgenommen hat → Klingeln beim Kunden beenden
    await ctx.repo.advanceCall(callId, 'canceled');
    if (call.twilio_child_sid) {
      ctx.bg(
        ctx.twilio().then((tw) => tw.request('POST', `/Calls/${call.twilio_child_sid}.json`, { Status: 'canceled' })).catch(() => undefined),
      );
    }
  }
  return twiml(el('Hangup'));
}

// ---------------------------------------------------------------------------
// Mithören, Einflüstern, Aufschalten (nur bei Gesprächen im Konferenzmodus)
// ---------------------------------------------------------------------------
async function monitorJoin(ctx: TelCtx, profile: Profile, perms: Set<string>, p: Record<string, string>): Promise<string> {
  const mode: Monitor['mode'] = p.mode === 'whisper' || p.mode === 'barge' ? p.mode : 'listen';
  const needed = mode === 'barge' ? 'call_coach_barge' : 'call_coach_listen';
  if (!perms.has(needed) && !perms.has('call_coach_barge')) return sayAndHangup('Dafür fehlt dir die Berechtigung.');
  const target = await ctx.repo.call(p.monitorCallId);
  if (!target || target.status !== 'in-progress' || !target.conference_name) {
    return sayAndHangup(target?.conference_name ? 'Das Gespräch ist schon beendet.' : 'Mithören geht nur im Konferenzmodus.');
  }
  if (target.user_id === profile.id) return sayAndHangup('Das ist dein eigenes Gespräch.');
  const monitors = [...(target.monitors ?? []), { user_id: profile.id, mode, at: now(ctx).toISOString(), call_sid: p.CallSid ?? null }];
  await ctx.repo.updateCall(target.id, { monitors });
  return twiml(
    el(
      'Dial',
      { action: ctx.fn('twilio-voice', { step: 'monitor-done', callId: target.id, uid: profile.id }), method: 'POST' },
      el(
        'Conference',
        {
          startConferenceOnEnter: 'false',
          endConferenceOnExit: 'false',
          beep: 'false',
          muted: mode === 'listen' ? 'true' : 'false',
          coach: mode === 'whisper' ? target.twilio_call_sid ?? undefined : undefined,
          participantLabel: `monitor-${profile.id}`,
        },
        target.conference_name,
      ),
    ),
  );
}

async function monitorDone(ctx: TelCtx, q: URLSearchParams): Promise<string> {
  const callId = q.get('callId');
  const uid = q.get('uid');
  if (isUuid(callId) && isUuid(uid)) {
    const call = await ctx.repo.call(callId);
    if (call) {
      const at = now(ctx).toISOString();
      const monitors = (call.monitors ?? []).map((m) => (m.user_id === uid && !m.ended_at ? { ...m, ended_at: at } : m));
      await ctx.repo.updateCall(callId, { monitors });
    }
  }
  return twiml(el('Hangup'));
}

// ---------------------------------------------------------------------------
// Eingehend: Kunde ruft unsere Nummer an
// ---------------------------------------------------------------------------
interface InboundState {
  callId: string;
  org: OrgSettings;
  number: PhoneNumberRow | null;
  input: RouteInput;
  leadId: string | null;
  leadName: string | null;
  contactName: string | null;
  from: string;
  to: string | null;
  recMode: RecMode;
}

async function loadRouting(ctx: TelCtx, numberE164: string | null) {
  const [org, number, members, busy, groups] = await Promise.all([
    ctx.repo.org(),
    numberE164 ? ctx.repo.phoneNumber(numberE164) : Promise.resolve(null),
    ctx.repo.activeMembers(),
    ctx.repo.busyUserIds(),
    ctx.repo.groupMembership(),
  ]);
  return { org, number, members, busy, groups };
}

async function inbound(ctx: TelCtx, p: Record<string, string>): Promise<string> {
  const to = normalizePhone(p.To) ?? p.To ?? null;
  const from = normalizePhone(p.From) ?? p.From ?? 'anonymous';
  const callId = crypto.randomUUID();
  const [{ org, number, members, busy, groups }, match] = await Promise.all([
    loadRouting(ctx, to),
    normalizePhone(p.From) ? ctx.repo.findByPhone(normalizePhone(p.From)!) : Promise.resolve(null as PhoneMatch | null),
  ]);
  const rrStart = number?.ring_mode === 'round_robin' ? await ctx.repo.bumpRoundRobin(number.number) : 0;
  await ctx.repo.upsertCall({
    id: callId,
    direction: 'inbound',
    status: 'ringing',
    from_number: from,
    to_number: to,
    lead_id: match?.lead_id ?? null,
    contact_id: match?.contact_id ?? null,
    user_id: match?.owner_id ?? null,
    twilio_call_sid: p.CallSid ?? null,
  });
  const st: InboundState = {
    callId,
    org,
    number,
    input: { number, members, groups, busy, ownerId: match?.owner_id ?? null, ownerRung: false, rrStart, defaultTimeout: org.inbound_ring_timeout, now: now(ctx) },
    leadId: match?.lead_id ?? null,
    leadName: match?.lead_name ?? null,
    contactName: match?.contact_name ?? null,
    from,
    to,
    recMode: inboundRecordMode(org, number),
  };
  const decision = firstDecision(st.input);
  const pre: XmlNode[] = [];
  if (number?.greeting_text) pre.push(say(number.greeting_text));
  if (isAutoRecording(st.recMode) && org.recording_announcement && decision.kind !== 'voicemail') {
    pre.push(say(org.recording_announcement_text));
  }
  return render(ctx, st, decision, pre);
}

// Nach einer Klingel-Stufe: angenommen? sonst nächste Stufe
async function routeNext(ctx: TelCtx, q: URLSearchParams, p: Record<string, string>): Promise<string> {
  const callId = q.get('callId');
  if (!isUuid(callId)) return twiml(el('Hangup'));
  if (ANSWERED.has(p.DialCallStatus)) {
    await ctx.repo.advanceCall(callId, 'completed', null, int(p.DialCallDuration));
    ctx.bg(noteRecording(ctx, callId, p));
    return twiml(el('Hangup'));
  }
  // Anrufer hat aufgelegt
  if (p.CallStatus === 'completed' || p.CallStatus === 'canceled') {
    await markMissed(ctx, callId, 'Anrufer hat aufgelegt');
    return twiml(el('Hangup'));
  }
  const st = await stateFor(ctx, callId, q);
  if (!st) return twiml(el('Hangup'));
  const stage = (q.get('stage') ?? 'pool') as Stage | 'forward';
  const targets = (q.get('t') ?? '').split(',').filter(isUuid);
  const decision: Decision = stage === 'forward'
    ? { kind: 'voicemail', reason: 'Weiterleitung wurde nicht angenommen' }
    : nextAfter(st.input, stage, targets);
  return render(ctx, st, decision, []);
}

async function ivrStep(ctx: TelCtx, q: URLSearchParams, p: Record<string, string>): Promise<string> {
  const callId = q.get('callId');
  if (!isUuid(callId)) return twiml(el('Hangup'));
  const st = await stateFor(ctx, callId, q);
  if (!st) return twiml(el('Hangup'));
  const digit = (p.Digits ?? '').slice(0, 1) || 'none';
  return render(ctx, st, ivrChoice(st.input, digit), []);
}

async function stateFor(ctx: TelCtx, callId: string, q: URLSearchParams): Promise<InboundState | null> {
  const call = await ctx.repo.call(callId);
  if (!call) return null;
  const [{ org, number, members, busy, groups }, lead] = await Promise.all([
    loadRouting(ctx, call.to_number),
    call.lead_id ? ctx.repo.lead(call.lead_id) : Promise.resolve(null),
  ]);
  return {
    callId,
    org,
    number,
    input: {
      number,
      members,
      groups,
      busy,
      ownerId: lead?.owner_id ?? null,
      ownerRung: q.get('o') === '1',
      rrStart: Number(q.get('rr')) || 0,
      defaultTimeout: org.inbound_ring_timeout,
      now: now(ctx),
    },
    leadId: call.lead_id,
    leadName: lead?.name ?? null,
    contactName: null,
    from: call.from_number ?? 'anonymous',
    to: call.to_number,
    recMode: inboundRecordMode(org, number),
  };
}

async function render(ctx: TelCtx, st: InboundState, d: Decision, pre: XmlNode[]): Promise<string> {
  const { callId } = st;
  const rec = dialRecordingAttrs(st.recMode, 'inbound', ctx.fn('twilio-status', { type: 'recording', callId, ac: '2' }));
  const passCaller = normalizePhone(st.from) ? st.from : st.to ?? undefined;

  switch (d.kind) {
    case 'ring': {
      const ownerRung = st.input.ownerRung || d.stage === 'owner';
      const params = { leadId: st.leadId, fromNumber: st.from, leadName: st.leadName, contactName: st.contactName };
      const children = d.targets.map((t) =>
        t.via === 'number' && t.number ? mobileNode(ctx, t.number, callId, t.userId) : clientNode(ctx, t.userId, callId, params)
      );
      return twiml(
        ...pre,
        el(
          'Dial',
          {
            answerOnBridge: 'true',
            timeout: d.timeout,
            callerId: d.targets.some((t) => t.via === 'number') ? passCaller : undefined,
            action: ctx.fn('twilio-voice', {
              step: 'route',
              callId,
              stage: d.stage,
              t: d.targets.map((t) => t.userId).join(','),
              o: ownerRung ? '1' : null,
              rr: st.input.rrStart ? String(st.input.rrStart) : null,
            }),
            method: 'POST',
            ...(rec ?? {}),
          },
          ...children,
        ),
      );
    }
    case 'forward': {
      return twiml(
        ...pre,
        el(
          'Dial',
          {
            answerOnBridge: 'true',
            timeout: 30,
            callerId: passCaller,
            action: ctx.fn('twilio-voice', { step: 'route', callId, stage: 'forward' }),
            method: 'POST',
            ...(rec ?? {}),
          },
          mobileNode(ctx, d.number, callId, null, false),
        ),
      );
    }
    case 'ivr': {
      return twiml(
        ...pre,
        el(
          'Gather',
          { input: 'dtmf', numDigits: 1, timeout: 6, action: ctx.fn('twilio-voice', { step: 'ivr', callId }), method: 'POST' },
          say(d.menu.greeting),
        ),
        // keine Taste gedrückt
        el('Redirect', { method: 'POST' }, ctx.fn('twilio-voice', { step: 'ivr', callId })),
      );
    }
    case 'voicemail': {
      await markMissed(ctx, callId, d.reason);
      return voicemailTwiml(ctx, st.org, callId, pre);
    }
  }
}

// Handy-Annahme bestätigen lassen
async function screen(ctx: TelCtx, q: URLSearchParams): Promise<string> {
  const callId = q.get('callId');
  const call = isUuid(callId) ? await ctx.repo.call(callId) : null;
  const who = call ? await callerLabel(ctx.repo, call) : 'unbekannt';
  const org = await ctx.repo.org();
  return twiml(
    el(
      'Gather',
      { input: 'dtmf', numDigits: 1, timeout: 8, action: ctx.fn('twilio-voice', { step: 'screen-done', callId }), method: 'POST' },
      say(`Anruf für ${org.name} von ${who}. Zum Annehmen die 1 drücken.`),
    ),
    el('Hangup'),
  );
}

// Weiterleitung an Kollegen wurde nicht angenommen → Mailbox (Aufgabe für den Kollegen)
async function transferDone(ctx: TelCtx, q: URLSearchParams, p: Record<string, string>): Promise<string> {
  const callId = q.get('callId');
  if (!isUuid(callId)) return twiml(el('Hangup'));
  if (ANSWERED.has(p.DialCallStatus)) {
    await ctx.repo.advanceCall(callId, 'completed', null, int(p.DialCallDuration));
    ctx.bg(noteRecording(ctx, callId, p));
    return twiml(el('Hangup'));
  }
  if (p.CallStatus === 'completed' || p.CallStatus === 'canceled') {
    await markMissed(ctx, callId, 'Weitergeleiteter Anruf: Anrufer hat aufgelegt');
    return twiml(el('Hangup'));
  }
  await markMissed(ctx, callId, 'Weiterleitung wurde nicht angenommen');
  const org = await ctx.repo.org();
  return voicemailTwiml(ctx, org, callId, [say('Ihr Ansprechpartner ist gerade nicht erreichbar.')]);
}
