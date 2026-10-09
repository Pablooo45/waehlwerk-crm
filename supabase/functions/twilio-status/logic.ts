// Rückmeldungen von Twilio: Klingeln, Abheben, Auflegen, Konferenz-Ereignisse, Aufnahmen.

import type { CallRow } from '../_shared/db.ts';
import { isUuid } from '../_shared/http.ts';
import { startTranscription } from '../_shared/insights.ts';
import { storeRecording } from '../_shared/recording.ts';
import { agentChannelFor, callerLabel, int, isFinal, markMissed, type TelCtx } from '../_shared/telephony.ts';
import { participantPath, type TwilioClient, TwilioError } from '../_shared/twilio.ts';

export async function handleStatus(ctx: TelCtx, type: string, q: URLSearchParams, p: Record<string, string>): Promise<void> {
  const callId = q.get('callId');
  switch (type) {
    case 'child': {
      // Leitung zum Kunden (ausgehend, ohne Konferenz)
      if (!isUuid(callId)) return;
      const st = p.CallStatus;
      await ctx.repo.advanceCall(callId, st, p.CallSid || null, isFinal(st) ? int(p.CallDuration) : null);
      return;
    }
    case 'parent':
      return parentDone(ctx, p);
    case 'inbound-leg': {
      // Browser oder Handy eines Kollegen bei eingehenden Anrufen / Weiterleitungen
      if (!isUuid(callId)) return;
      const uid = q.get('uid');
      if (p.CallStatus === 'in-progress') {
        await ctx.repo.advanceCall(callId, 'in-progress', p.CallSid || null, null, isUuid(uid) ? uid : null);
      } else if (p.CallStatus === 'completed') {
        const call = await ctx.repo.call(callId);
        if (call && call.status === 'in-progress' && (!isUuid(uid) || call.user_id === uid)) {
          await ctx.repo.advanceCall(callId, 'completed', null, int(p.CallDuration));
        }
      }
      return;
    }
    case 'participant':
      if (isUuid(callId)) await participant(ctx, callId, p);
      return;
    case 'conference':
      if (isUuid(callId)) await conference(ctx, callId, p);
      return;
    case 'transfer-leg':
      if (isUuid(callId)) await transferLeg(ctx, callId, q, p);
      return;
    case 'recording':
    case 'voicemail':
      if (isUuid(callId)) ctx.bg(handleRecording(ctx, type, callId, q, p));
      return;
  }
}

// Hauptanruf beendet (Browser-Leitung ausgehend bzw. Anrufer eingehend)
async function parentDone(ctx: TelCtx, p: Record<string, string>) {
  if (!isFinal(p.CallStatus) || !p.CallSid) return;
  const call = await ctx.repo.callBySid(p.CallSid);
  if (!call || call.twilio_call_sid !== p.CallSid) return;
  if (call.status === 'initiated' || call.status === 'ringing') {
    if (call.direction === 'inbound') await markMissed(ctx, call.id, 'Anrufer hat aufgelegt');
    else await ctx.repo.advanceCall(call.id, 'canceled');
  } else if (call.status === 'in-progress') {
    // Dauer kommt von der Kundenleitung (ohne Klingel- und Menüzeit)
    await ctx.repo.advanceCall(call.id, 'completed');
  }
}

// Konferenzmodus: Leitung zum Kunden
async function participant(ctx: TelCtx, callId: string, p: Record<string, string>) {
  const st = p.CallStatus;
  if (st === 'queued' || st === 'initiated' || st === 'ringing') {
    await ctx.repo.advanceCall(callId, st === 'queued' ? 'initiated' : st, p.CallSid || null);
    return;
  }
  if (st === 'in-progress') {
    await ctx.repo.advanceCall(callId, 'in-progress', p.CallSid || null);
    const org = await ctx.repo.org();
    const call = await ctx.repo.call(callId);
    // Hinweis auf die Aufnahme nur dem Kunden vorspielen
    if (org.recording_announcement && (org.recording_mode === 'auto' || org.recording_mode === 'auto_agent') && p.ConferenceSid) {
      ctx.bg(
        ctx.twilio().then((tw) =>
          tw.request('POST', participantPath(p.ConferenceSid, p.CallSid), {
            AnnounceUrl: ctx.fn('twilio-voice', { step: 'announce' }),
            AnnounceMethod: 'POST',
          })
        ).catch((e) => ctx.repo.log('twilio-status', 'warn', `Aufnahme-Hinweis nicht abgespielt: ${e}`, { callId })),
      );
    }
    if (call && p.ConferenceSid && !call.conference_sid) await ctx.repo.updateCall(callId, { conference_sid: p.ConferenceSid });
    return;
  }
  if (!isFinal(st)) return;
  const call = await ctx.repo.call(callId);
  if (!call) return;
  if (call.status === 'in-progress' || call.answered_at) {
    // nach einer Weiterleitung zählt die Zeit beim Kollegen nicht mehr zu unserem Gespräch
    await ctx.repo.advanceCall(callId, 'completed', null, call.transferred_to ? null : int(p.CallDuration));
    return;
  }
  // Nicht erreicht → uns aus der leeren Konferenz holen
  await ctx.repo.advanceCall(callId, st);
  if (call.twilio_call_sid) {
    const tw = await ctx.twilio();
    await tw.request('POST', `/Calls/${call.twilio_call_sid}.json`, { Status: 'completed' }).catch(() => undefined);
  }
}

// Konferenz-Ereignisse: SID merken, Mithörende abmelden
async function conference(ctx: TelCtx, callId: string, p: Record<string, string>) {
  const ev = p.StatusCallbackEvent;
  if (ev === 'conference-start' && p.ConferenceSid) {
    await ctx.repo.updateCall(callId, { conference_sid: p.ConferenceSid });
    return;
  }
  if (ev === 'participant-leave' && (p.ParticipantLabel ?? '').startsWith('monitor-')) {
    const uid = p.ParticipantLabel.slice('monitor-'.length);
    const call = await ctx.repo.call(callId);
    if (!call) return;
    const at = (ctx.now?.() ?? new Date()).toISOString();
    await ctx.repo.updateCall(callId, {
      monitors: (call.monitors ?? []).map((m) => (m.user_id === uid && !m.ended_at ? { ...m, ended_at: at } : m)),
    });
  }
}

// Übergabe mit Rücksprache: Leitung zum Kollegen
async function transferLeg(ctx: TelCtx, newId: string, q: URLSearchParams, p: Record<string, string>) {
  const parentId = q.get('parent');
  const uid = q.get('uid');
  const st = p.CallStatus;
  if (st === 'ringing' || st === 'initiated') {
    await ctx.repo.advanceCall(newId, 'ringing', p.CallSid || null);
    return;
  }
  if (st === 'in-progress') {
    await ctx.repo.advanceCall(newId, 'in-progress', p.CallSid || null, null, isUuid(uid) ? uid : null);
    return;
  }
  if (!isFinal(st)) return;
  const call = await ctx.repo.call(newId);
  if (call?.status === 'in-progress' || call?.answered_at) {
    await ctx.repo.advanceCall(newId, 'completed', null, int(p.CallDuration));
    return;
  }
  // Kollege hat nicht abgenommen → Kunde wieder zu uns holen, uns Bescheid geben
  await ctx.repo.advanceCall(newId, st);
  if (!isUuid(parentId)) return;
  const parent = await ctx.repo.call(parentId);
  if (!parent?.conference_sid) return;
  const tw = await ctx.twilio();
  await tw.request('POST', participantPath(parent.conference_sid, 'customer'), { Hold: false }).catch(() => undefined);
  await ctx.repo.updateCall(parentId, { transferred_to: null });
  if (parent.user_id) {
    const who = call?.user_id ? (await ctx.repo.profile(call.user_id))?.full_name ?? 'Der Kollege' : 'Der Kollege';
    await ctx.repo.notify(parent.user_id, 'system', parent.lead_id, 'call', parent.id, `${who} hat nicht abgenommen`, 'Der Kunde ist wieder bei dir in der Leitung.');
  }
}

// ---------------------------------------------------------------------------
// Aufnahmen: von Twilio holen, auswerten, in den eigenen Speicher, bei Twilio löschen.
// Gelöscht wird bei Twilio erst, wenn die Aufnahme sicher bei uns liegt. Bricht etwas ab, holt
// retryRecording sie später neu (Hintergrundaufgabe „jobs“ oder Knopf „Erneut holen“).
// ---------------------------------------------------------------------------
export const MAX_RECORDING_ATTEMPTS = 4;

interface RecordingRef {
  sid: string;
  url: string;
  channels: number | null;
  duration: number | null;
  ac: number | null; // Spur mit unserer Stimme (aus der Rückmeldung)
}

async function handleRecording(ctx: TelCtx, kind: 'recording' | 'voicemail', callId: string, q: URLSearchParams, p: Record<string, string>) {
  const status = p.RecordingStatus || 'completed';
  const call = await ctx.repo.call(callId);
  if (!call) return;
  const ac = int(q.get('ac'));

  if (status === 'in-progress') {
    if (!call.recording_path) {
      await ctx.repo.updateCall(callId, { recording_status: 'recording', recording_sid: p.RecordingSid ?? null, ...(ac ? { agent_channel: ac } : {}) });
    }
    return;
  }
  if (status === 'absent') {
    if (!call.recording_path) await ctx.repo.updateCall(callId, { recording_status: 'none' });
    return;
  }
  if (status === 'failed') {
    // Twilio konnte nicht aufnehmen – da gibt es nichts nachzuholen
    if (!call.recording_path) {
      await ctx.repo.updateCall(callId, {
        recording_status: 'failed',
        recording_attempts: MAX_RECORDING_ATTEMPTS,
        recording_error: 'Twilio konnte das Gespräch nicht aufnehmen.',
      });
    }
    await ctx.repo.log('twilio-status', 'error', 'Aufnahme bei Twilio fehlgeschlagen', { callId, params: p });
    return;
  }
  if (status !== 'completed' || !p.RecordingUrl || !p.RecordingSid) return;
  await processRecording(ctx, kind, call, {
    sid: p.RecordingSid,
    url: p.RecordingUrl,
    channels: int(p.RecordingChannels),
    duration: int(p.RecordingDuration),
    ac,
  });
}

// Holen, auswerten, ablegen. counted = Versuch wurde schon gezählt (beim Nachholen)
async function processRecording(
  ctx: TelCtx,
  kind: 'recording' | 'voicemail',
  call: CallRow,
  ref: RecordingRef,
  counted = false,
): Promise<'ready' | 'failed'> {
  const callId = call.id;
  const channels = ref.channels ?? (kind === 'voicemail' ? 1 : 2);
  const agentChannel = channels >= 2 ? ref.ac ?? call.agent_channel ?? agentChannelFor(call) : null;
  const primary = !call.recording_path || call.recording_sid === ref.sid;
  if (primary) {
    await ctx.repo.updateCall(callId, {
      recording_status: 'processing',
      recording_sid: ref.sid,
      recording_tried_at: (ctx.now?.() ?? new Date()).toISOString(),
      recording_error: null,
      ...(counted ? {} : { recording_attempts: (call.recording_attempts ?? 0) + 1 }),
      // Spur merken, damit ein späterer neuer Versuch sie kennt
      ...(agentChannel && ref.ac ? { agent_channel: agentChannel } : {}),
    });
  }
  try {
    const twilio = await ctx.twilio();
    const org = await ctx.repo.org();
    const sink = ctx.media ?? { upload: (b: string, path: string, bytes: Uint8Array, ct: string) => ctx.repo.upload(b, path, bytes, ct) };
    const stored = await storeRecording(twilio, sink, {
      recordingUrl: ref.url,
      recordingSid: ref.sid,
      callId,
      startedAt: call.started_at,
      channels,
      agentChannel,
      kind,
      preferMp3: org.recording_format === 'mp3',
    });
    const duration = ref.duration ?? Math.round(stored.durationMs / 1000);
    const fresh = await ctx.repo.call(callId);
    const extra = !!(fresh?.recording_path && fresh.recording_path !== stored.path);
    if (extra) {
      // Weitere Aufnahme zum selben Anruf (z. B. neu gestartet) → zusätzlich ablegen
      await ctx.repo.updateCall(callId, {
        recording_status: 'ready',
        extra_recordings: [...(fresh!.extra_recordings ?? []), { sid: ref.sid, path: stored.path, duration }],
      });
    } else {
      await ctx.repo.updateCall(callId, {
        recording_status: 'ready',
        recording_path: stored.path,
        recording_sid: ref.sid,
        recording_duration: duration,
        recording_format: stored.format,
        recording_channels: stored.channels,
        agent_channel: stored.channels >= 2 ? agentChannel : null,
        recording_bytes: stored.bytes,
        recording_error: null,
        talk_agent_ms: stored.talk?.agent_ms ?? null,
        talk_customer_ms: stored.talk?.customer_ms ?? null,
        ...(kind === 'voicemail' ? { is_voicemail: true } : {}),
      });
      await ctx.repo.upsertInsights({ call_id: callId, peaks: stored.peaks, talk: stored.talk, error: stored.note ?? null });
    }
    if (stored.note) await ctx.repo.log('twilio-status', 'warn', stored.note, { callId });

    if (kind === 'voicemail') await voicemailArrived(ctx, callId);

    if (org.delete_twilio_recordings) {
      await twilio.request('DELETE', `/Recordings/${ref.sid}.json`).catch((e) =>
        ctx.repo.log('twilio-status', 'warn', 'Aufnahme bei Twilio nicht gelöscht', { error: String(e) })
      );
    }
    // Abschrift automatisch (wenn eingeschaltet und eingerichtet); sehr kurze Aufnahmen lohnen nicht
    if (org.transcription_enabled && duration >= 5 && !extra) {
      await startTranscription({ repo: ctx.repo, fn: ctx.fn }, callId).catch((e) =>
        ctx.repo.log('twilio-status', 'warn', `Abschrift nicht gestartet: ${e instanceof Error ? e.message : e}`, { callId })
      );
    }
    return 'ready';
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    // Hat ein paralleler Versuch die Aufnahme inzwischen abgelegt, bleibt es dabei
    const fresh = await ctx.repo.call(callId).catch(() => null);
    if (primary && !fresh?.recording_path) {
      await ctx.repo.updateCall(callId, { recording_status: 'failed', recording_error: message.slice(0, 500) });
    }
    await ctx.repo.log('twilio-status', 'error', `Aufnahme konnte nicht gespeichert werden: ${message}`, {
      callId,
      recordingSid: ref.sid,
      attempt: counted ? fresh?.recording_attempts : (call.recording_attempts ?? 0) + 1,
    });
    return 'failed';
  }
}

// Aufnahme bei Twilio, wie sie die REST-Schnittstelle beschreibt
interface TwilioRecording {
  sid: string;
  status: string; // in-progress | paused | stopped | processing | completed | absent | failed | deleted
  channels?: number | string | null;
  duration?: number | string | null;
  source?: string; // DialVerb, Conference, OutboundAPI, RecordVerb, StartCallRecordingAPI …
  uri?: string;
  media_url?: string;
  date_created?: string;
}

// Welche Aufnahme gehört zu diesem Gespräch? Erst über die bekannte SID, sonst über die Leitungen.
async function findRecording(twilio: TwilioClient, call: CallRow): Promise<TwilioRecording | null> {
  if (call.recording_sid) {
    try {
      return await twilio.request<TwilioRecording>('GET', `/Recordings/${call.recording_sid}.json`);
    } catch (e) {
      if (!(e instanceof TwilioError && e.status === 404)) throw e;
    }
  }
  const legs = [...new Set([call.twilio_call_sid, call.twilio_child_sid].filter((s): s is string => !!s))];
  const found: TwilioRecording[] = [];
  for (const leg of legs) {
    const r = await twilio.request<{ recordings?: TwilioRecording[] }>('GET', '/Recordings.json', { CallSid: leg, PageSize: 20 });
    found.push(...(r?.recordings ?? []));
  }
  const time = (r: TwilioRecording) => Date.parse(r.date_created ?? '') || 0;
  found.sort((a, b) => time(a) - time(b));
  // die erste fertige Aufnahme (weitere entstehen nur, wenn eine Aufnahme neu gestartet wurde)
  return found.find((r) => r.status === 'completed') ??
    found.find((r) => ['in-progress', 'paused', 'stopped', 'processing'].includes(r.status)) ??
    found[0] ??
    null;
}

function numberOrNull(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export type RetryResult = 'ready' | 'pending' | 'failed' | 'none';

// Aufnahme erneut holen: nach Abbruch, Fehler oder verlorener Rückmeldung von Twilio.
// manual = Knopf „Erneut holen“ (zählt wieder ab dem ersten Versuch)
export async function retryRecording(ctx: TelCtx, callId: string, opts: { manual?: boolean } = {}): Promise<RetryResult> {
  const call = await ctx.repo.call(callId);
  if (!call) return 'none';
  if (call.recording_path) return 'ready';
  const attempt = opts.manual ? 1 : (call.recording_attempts ?? 0) + 1;
  const at = (ctx.now?.() ?? new Date()).toISOString();
  await ctx.repo.updateCall(callId, { recording_status: 'processing', recording_tried_at: at, recording_attempts: attempt, recording_error: null });

  const fail = async (message: string, final: boolean): Promise<RetryResult> => {
    await ctx.repo.updateCall(callId, {
      recording_status: 'failed',
      recording_error: message,
      ...(final ? { recording_attempts: MAX_RECORDING_ATTEMPTS } : {}),
    });
    await ctx.repo.log('twilio-status', final || attempt >= MAX_RECORDING_ATTEMPTS ? 'error' : 'warn', `Aufnahme nachholen: ${message}`, { callId, attempt });
    return 'failed';
  };

  let twilio: TwilioClient;
  let rec: TwilioRecording | null;
  try {
    twilio = await ctx.twilio();
    rec = await findRecording(twilio, call);
  } catch (e) {
    return fail(`Twilio nicht erreichbar (${e instanceof Error ? e.message : e})`, false);
  }

  if (!rec) {
    if (call.recording_sid) return fail('Die Aufnahme ist bei Twilio nicht mehr vorhanden.', true);
    // Aufnahme war angefordert, kam aber nie zustande (z. B. sofort aufgelegt)
    await ctx.repo.updateCall(callId, { recording_status: 'none', recording_error: null });
    return 'none';
  }
  switch (rec.status) {
    case 'completed':
      return processRecording(ctx, rec.source === 'RecordVerb' || call.is_voicemail ? 'voicemail' : 'recording', { ...call, recording_attempts: attempt }, {
        sid: rec.sid,
        url: rec.media_url || (rec.uri ? `https://api.twilio.com${rec.uri}` : `${twilio.base}/Recordings/${rec.sid}`),
        channels: numberOrNull(rec.channels) || null,
        duration: numberOrNull(rec.duration),
        ac: null,
      }, true);
    case 'absent':
      await ctx.repo.updateCall(callId, { recording_status: 'none', recording_sid: rec.sid, recording_error: null });
      return 'none';
    case 'failed':
    case 'deleted':
      return fail(rec.status === 'failed' ? 'Twilio konnte das Gespräch nicht aufnehmen.' : 'Die Aufnahme wurde bei Twilio gelöscht.', true);
    default:
      // Twilio ist noch nicht fertig → beim nächsten Durchlauf wieder
      if (attempt >= MAX_RECORDING_ATTEMPTS) return fail('Twilio hat die Aufnahme nicht fertiggestellt.', true);
      await ctx.repo.updateCall(callId, { recording_status: 'processing', recording_sid: rec.sid });
      return 'pending';
  }
}

async function voicemailArrived(ctx: TelCtx, callId: string) {
  const call = await ctx.repo.call(callId);
  if (!call) return;
  const who = await callerLabel(ctx.repo, call);
  const title = `Mailbox-Nachricht von ${who}`;
  const converted = await ctx.repo.convertCallTask(callId, 'voicemail', title);
  if (!converted) {
    await ctx.repo.insertTask({
      type: 'voicemail',
      title,
      lead_id: call.lead_id,
      contact_id: call.contact_id,
      assigned_to: call.user_id,
      call_id: callId,
      due_at: (ctx.now?.() ?? new Date()).toISOString(),
      created_by: null,
    });
  }
  if (call.user_id) await ctx.repo.notify(call.user_id, 'voicemail', call.lead_id, 'call', callId, title);
}
