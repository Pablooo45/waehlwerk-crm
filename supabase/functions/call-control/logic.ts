// Steuerung laufender Anrufe aus dem Browser: Aufnahme, Mailbox-Nachricht, Weiterleiten (direkt oder
// mit Rücksprache), Mithören umschalten, Abschrift anfordern, Aufnahme erneut holen.

import type { CallRow, Caller } from '../_shared/db.ts';
import { HttpError, isUuid } from '../_shared/http.ts';
import { startTranscription, summarizeCall } from '../_shared/insights.ts';
import {
  agentChannelFor,
  clientNode,
  clientTo,
  conferenceSid,
  customerLegSid,
  dialRecordingAttrs,
  isFinal,
  recordingCallSid,
  type TelCtx,
} from '../_shared/telephony.ts';
import { el, participantPath, twiml, type TwilioClient } from '../_shared/twilio.ts';
import { retryRecording } from '../twilio-status/logic.ts';

export interface ControlBody {
  action:
    | 'record_start'
    | 'record_pause'
    | 'record_resume'
    | 'voicemail_drop'
    | 'transfer'
    | 'transfer_complete'
    | 'transfer_cancel'
    | 'monitor_mode'
    | 'transcribe'
    | 'recording_retry';
  callId: string;
  dropId?: string;
  targetUserId?: string;
  mode?: string;
}

export type ControlUser = Pick<Caller, 'id' | 'full_name' | 'email' | 'can' | 'isAdmin'>;

export async function handleControl(ctx: TelCtx, user: ControlUser, body: ControlBody): Promise<Record<string, unknown>> {
  if (!isUuid(body.callId)) throw new HttpError(400, 'Anruf unbekannt.');
  const call = await ctx.repo.call(body.callId);
  if (!call) throw new HttpError(404, 'Anruf nicht gefunden – ist er schon beendet?');

  // Diese betreffen fremde Anrufe (Coaching) bzw. auch beendete Anrufe (Abschrift, Aufnahme nachholen)
  if (body.action === 'monitor_mode') return monitorMode(ctx, user, call, body.mode);
  if (body.action === 'transcribe') return transcribe(ctx, user, call);
  if (body.action === 'recording_retry') return recordingRetry(ctx, user, call);

  if (call.user_id !== user.id && !user.isAdmin) throw new HttpError(403, 'Das ist nicht dein Anruf.');
  if (!call.twilio_call_sid) throw new HttpError(409, 'Der Anruf ist noch nicht verbunden.');
  const twilio = await ctx.twilio();

  switch (body.action) {
    case 'record_start':
      return recordStart(ctx, twilio, call);
    case 'record_pause':
    case 'record_resume':
      return recordToggle(ctx, twilio, call, body.action === 'record_pause');
    case 'voicemail_drop':
      return voicemailDrop(ctx, twilio, user, call, body.dropId);
    case 'transfer':
      return transfer(ctx, twilio, user, call, body.targetUserId, body.mode === 'warm' ? 'warm' : 'cold');
    case 'transfer_complete':
      return transferComplete(ctx, twilio, call);
    case 'transfer_cancel':
      return transferCancel(ctx, twilio, call);
    default:
      throw new HttpError(400, 'Unbekannte Aktion.');
  }
}

// ---------------------------------------------------------------------------
// Aufnahme
// ---------------------------------------------------------------------------
async function recordStart(ctx: TelCtx, twilio: TwilioClient, call: CallRow) {
  const org = await ctx.repo.org();
  if (org.recording_mode === 'off') throw new HttpError(403, 'Aufnahmen sind in den Einstellungen ausgeschaltet.');
  if (call.recording_status === 'recording' || call.recording_status === 'paused') {
    return { ok: true, recording: call.recording_status };
  }
  const sid = recordingCallSid(call);
  if (!sid) throw new HttpError(409, 'Aufnahme geht erst, wenn der Kunde abgenommen hat.');
  const ac = agentChannelFor(call);
  const rec = await twilio.request<{ sid: string }>('POST', `/Calls/${sid}/Recordings.json`, {
    RecordingStatusCallback: ctx.fn('twilio-status', { type: 'recording', callId: call.id, ac: String(ac) }),
    RecordingStatusCallbackMethod: 'POST',
    RecordingStatusCallbackEvent: ['in-progress', 'completed', 'absent'],
    // zwei getrennte Spuren: wir und der Kunde – beste Qualität für Abschrift und Coaching
    RecordingChannels: 'dual',
    RecordingTrack: 'both',
  });
  await ctx.repo.updateCall(call.id, { recording_status: 'recording', recording_sid: rec?.sid ?? null, agent_channel: ac });
  // Im Konferenzmodus kann das CRM den Hinweis selbst abspielen (nur der Kunde hört ihn)
  if (org.recording_announcement && call.conference_name) {
    try {
      const conf = await conferenceSid(ctx, twilio, call);
      await twilio.request('POST', participantPath(conf, 'customer'), {
        AnnounceUrl: ctx.fn('twilio-voice', { step: 'announce' }),
        AnnounceMethod: 'POST',
      });
    } catch (e) {
      await ctx.repo.log('call-control', 'warn', `Aufnahme-Hinweis nicht abgespielt: ${e}`, { callId: call.id });
    }
  }
  return { ok: true, recording: 'recording', sid: rec?.sid, announced: !!(org.recording_announcement && call.conference_name) };
}

async function recordToggle(ctx: TelCtx, twilio: TwilioClient, call: CallRow, pause: boolean) {
  const sid = recordingCallSid(call);
  if (!sid) throw new HttpError(409, 'Es läuft keine Aufnahme.');
  await twilio.request('POST', `/Calls/${sid}/Recordings/Twilio.CURRENT.json`, {
    Status: pause ? 'paused' : 'in-progress',
    ...(pause ? { PauseBehavior: 'skip' } : {}),
  });
  const state = pause ? 'paused' : 'recording';
  await ctx.repo.updateCall(call.id, { recording_status: state });
  return { ok: true, recording: state };
}

// ---------------------------------------------------------------------------
// Mailbox-Nachricht hinterlassen (vorher aufgenommen) – wir sind sofort frei für den nächsten Anruf
// ---------------------------------------------------------------------------
async function voicemailDrop(ctx: TelCtx, twilio: TwilioClient, user: ControlUser, call: CallRow, dropId?: string) {
  if (call.direction !== 'outbound') throw new HttpError(400, 'Mailbox-Nachrichten gehen nur bei ausgehenden Anrufen.');
  if (!dropId || !isUuid(dropId)) throw new HttpError(400, 'Bitte eine Mailbox-Nachricht auswählen.');
  const drop = await ctx.repo.voicemailDrop(dropId);
  if (!drop || (!drop.shared && drop.user_id !== user.id)) throw new HttpError(404, 'Mailbox-Nachricht nicht gefunden.');
  const [leg, org, audioUrl] = await Promise.all([
    customerLegSid(twilio, call),
    ctx.repo.org(),
    ctx.repo.signedUrl('voicemails', drop.storage_path, 900),
  ]);
  await twilio.request('POST', `/Calls/${leg}.json`, { Twiml: twiml(el('Play', {}, audioUrl), el('Hangup')) });
  await ctx.repo.updateCall(call.id, {
    voicemail_drop_id: drop.id,
    ...(org.voicemail_drop_outcome ? { outcome: org.voicemail_drop_outcome } : {}),
  });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Weiterleiten: direkt (Kunde klingelt beim Kollegen) oder mit Rücksprache (Konferenzmodus)
// ---------------------------------------------------------------------------
async function transfer(ctx: TelCtx, twilio: TwilioClient, user: ControlUser, call: CallRow, targetUserId: string | undefined, mode: 'cold' | 'warm') {
  if (!targetUserId || !isUuid(targetUserId)) throw new HttpError(400, 'Bitte einen Kollegen auswählen.');
  if (targetUserId === user.id) throw new HttpError(400, 'Du kannst nicht an dich selbst weiterleiten.');
  const target = await ctx.repo.profile(targetUserId);
  if (!target || !target.active) throw new HttpError(404, 'Kollege nicht gefunden.');
  if (mode === 'warm' && !call.conference_name) {
    throw new HttpError(409, 'Übergabe mit Rücksprache geht nur bei Gesprächen im Konferenzmodus (Einstellungen → Telefonie).');
  }
  const leadName = call.lead_id ? (await ctx.repo.lead(call.lead_id))?.name ?? null : null;
  const customerNumber = call.direction === 'inbound' ? call.from_number : call.to_number;
  const fromName = user.full_name || user.email;

  const newId = crypto.randomUUID();
  await ctx.repo.upsertCall({
    id: newId,
    direction: call.direction,
    lead_id: call.lead_id,
    contact_id: call.contact_id,
    user_id: target.id,
    from_number: call.from_number,
    to_number: call.to_number,
    status: 'ringing',
    parent_call_id: call.id,
    note: `${mode === 'warm' ? 'Übergabe' : 'Weitergeleitet'} von ${fromName}`,
  });

  if (mode === 'warm') {
    const conf = await conferenceSid(ctx, twilio, call);
    // Kunde hört Wartemusik, wir sprechen mit dem Kollegen
    await twilio.request('POST', participantPath(conf, 'customer'), { Hold: true });
    try {
      await twilio.request('POST', `/Conferences/${conf}/Participants.json`, {
        From: call.from_number ?? customerNumber ?? '',
        To: clientTo(target.id, { callId: newId, leadId: call.lead_id, leadName, fromNumber: customerNumber, transferFrom: fromName }),
        Label: 'transfer',
        EarlyMedia: false,
        Beep: 'false',
        StartConferenceOnEnter: true,
        EndConferenceOnExit: false,
        Timeout: 25,
        StatusCallback: ctx.fn('twilio-status', { type: 'transfer-leg', callId: newId, parent: call.id, uid: target.id }),
        StatusCallbackMethod: 'POST',
        StatusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
      });
    } catch (e) {
      await twilio.request('POST', participantPath(conf, 'customer'), { Hold: false }).catch(() => undefined);
      await ctx.repo.advanceCall(newId, 'failed');
      throw e;
    }
    await ctx.repo.updateCall(call.id, { transferred_to: target.id });
    return { ok: true, newCallId: newId, name: target.full_name || target.email };
  }

  // Direkt weiterleiten: Leitung des Kunden bekommt neue Anweisungen
  const leg = call.conference_name ? call.twilio_child_sid : await customerLegSid(twilio, call);
  if (!leg) throw new HttpError(409, 'Der Kunde ist nicht (mehr) in der Leitung.');
  const org = await ctx.repo.org();
  // ohne Konferenz endet die bisherige Aufnahme hier → für den Kollegen neu aufnehmen (Kunde = Spur 1)
  const rec = call.conference_name ? null : dialRecordingAttrs(org.recording_mode, 'inbound', ctx.fn('twilio-status', { type: 'recording', callId: newId, ac: '2' }));
  const client = clientNode(ctx, target.id, newId, {
    leadId: call.lead_id,
    leadName,
    fromNumber: customerNumber,
    transferFrom: fromName,
  });
  await twilio.request('POST', `/Calls/${leg}.json`, {
    Twiml: twiml(
      el(
        'Dial',
        {
          timeout: 25,
          answerOnBridge: 'true',
          action: ctx.fn('twilio-voice', { step: 'transfer-done', callId: newId }),
          method: 'POST',
          ...(rec ?? {}),
        },
        client,
      ),
    ),
  });
  await ctx.repo.updateCall(call.id, {
    transferred_to: target.id,
    note: [call.note, `Weitergeleitet an ${target.full_name || target.email}`].filter(Boolean).join('\n'),
  });
  return { ok: true, newCallId: newId, name: target.full_name || target.email };
}

async function transferComplete(ctx: TelCtx, twilio: TwilioClient, call: CallRow) {
  const conf = await conferenceSid(ctx, twilio, call);
  // Reihenfolge wichtig: erst darf die Konferenz ohne uns weiterlaufen, dann gehen wir raus
  await twilio.request('POST', participantPath(conf, 'transfer'), { EndConferenceOnExit: true });
  await twilio.request('POST', participantPath(conf, 'customer'), { Hold: false });
  await twilio.request('POST', participantPath(conf, 'agent'), { EndConferenceOnExit: false });
  await twilio.request('DELETE', participantPath(conf, 'agent')).catch(async () => {
    await twilio.request('POST', `/Calls/${call.twilio_call_sid}.json`, { Status: 'completed' });
  });
  return { ok: true };
}

async function transferCancel(ctx: TelCtx, twilio: TwilioClient, call: CallRow) {
  const conf = await conferenceSid(ctx, twilio, call);
  await twilio.request('DELETE', participantPath(conf, 'transfer')).catch(() => undefined);
  await twilio.request('POST', participantPath(conf, 'customer'), { Hold: false });
  await ctx.repo.updateCall(call.id, { transferred_to: null });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Coaching: zwischen Mithören, Einflüstern und Aufschalten wechseln
// ---------------------------------------------------------------------------
async function monitorMode(ctx: TelCtx, user: ControlUser, call: CallRow, mode?: string) {
  const m = mode === 'whisper' || mode === 'barge' ? mode : 'listen';
  if (m === 'barge' ? !user.can('call_coach_barge') : !(user.can('call_coach_listen') || user.can('call_coach_barge'))) {
    throw new HttpError(403, 'Dafür fehlt dir die Berechtigung.');
  }
  if (!call.conference_name || call.status !== 'in-progress') throw new HttpError(409, 'Das Gespräch läuft nicht (mehr).');
  const twilio = await ctx.twilio();
  const conf = await conferenceSid(ctx, twilio, call);
  const params = m === 'listen'
    ? { Muted: true, Coaching: false }
    : m === 'whisper'
    ? { Muted: false, Coaching: true, CallSidToCoach: call.twilio_call_sid ?? '' }
    : { Muted: false, Coaching: false };
  await twilio.request('POST', participantPath(conf, `monitor-${user.id}`), params);
  await ctx.repo.updateCall(call.id, {
    monitors: (call.monitors ?? []).map((x) => (x.user_id === user.id && !x.ended_at ? { ...x, mode: m } : x)),
  });
  return { ok: true, mode: m };
}

// ---------------------------------------------------------------------------
// Abschrift (und Zusammenfassung) nachträglich anfordern
// ---------------------------------------------------------------------------
async function transcribe(ctx: TelCtx, user: ControlUser, call: CallRow) {
  if (!user.can('use_ai')) throw new HttpError(403, 'Deine Rolle darf keine KI-Funktionen nutzen.');
  const mayListen = call.user_id === user.id || user.can('recordings_listen_all') || call.is_voicemail;
  if (!mayListen) throw new HttpError(403, 'Du darfst diese Aufnahme nicht anhören.');
  const env = { repo: ctx.repo, fn: ctx.fn };
  if (call.transcript_status === 'ready') {
    const summary = await summarizeCall(env, call.id);
    if (!summary) throw new HttpError(409, 'Für die Zusammenfassung fehlt der Anthropic-Schlüssel (Einstellungen → KI & Abschriften).');
    return { ok: true, status: 'ready', summary };
  }
  const r = await startTranscription(env, call.id, call.transcript_status === 'failed');
  return { ok: true, status: r === 'started' ? 'processing' : call.transcript_status };
}

// ---------------------------------------------------------------------------
// Aufnahme erneut holen (Knopf „Erneut holen“) – Twilio behält sie, bis sie bei uns liegt
// ---------------------------------------------------------------------------
async function recordingRetry(ctx: TelCtx, user: ControlUser, call: CallRow) {
  const mayListen = call.user_id === user.id || user.can('recordings_listen_all') || call.is_voicemail;
  if (!mayListen) throw new HttpError(403, 'Du darfst diese Aufnahme nicht anhören.');
  if (call.recording_path) return { ok: true, status: 'ready' };
  if (!call.ended_at && !isFinal(call.status)) {
    throw new HttpError(409, 'Das Gespräch läuft noch – die Aufnahme wird nach dem Auflegen gespeichert.');
  }
  if (!['failed', 'processing', 'recording', 'paused'].includes(call.recording_status)) {
    throw new HttpError(409, 'Zu diesem Gespräch gibt es keine Aufnahme.');
  }
  const now = ctx.now?.() ?? new Date();
  // Läuft gerade ein Versuch, nicht doppelt starten
  const tried = call.recording_tried_at ? Date.parse(call.recording_tried_at) : 0;
  if (call.recording_status === 'processing' && now.getTime() - tried < 3 * 60_000) return { ok: true, status: 'processing' };
  await ctx.repo.updateCall(call.id, { recording_status: 'processing', recording_tried_at: now.toISOString(), recording_error: null });
  ctx.bg(retryRecording(ctx, call.id, { manual: true }));
  return { ok: true, status: 'processing' };
}
