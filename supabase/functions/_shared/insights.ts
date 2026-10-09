// Abschrift starten/abschließen und Zusammenfassung schreiben – für twilio-status, call-control,
// ai-webhook und den Zeitplan (jobs).

import {
  type AssemblyTranscript,
  callClaude,
  DEFAULT_SUMMARY_MODEL,
  parseSummary,
  type Segment,
  segmentsFrom,
  startTranscript,
  type Summary,
  summaryRequest,
  transcriptForPrompt,
  transcriptRequest,
} from './ai.ts';
import { randomToken } from './crypto.ts';
import type { Repo } from './db.ts';
import { HttpError } from './http.ts';

export interface AiEnv {
  repo: Repo;
  fn: (name: string, query?: Record<string, string | null | undefined>) => string;
  fetchFn?: typeof fetch;
}

export async function webhookToken(repo: Repo): Promise<string> {
  const existing = await repo.secret('AI_WEBHOOK_TOKEN');
  if (existing) return existing;
  const token = randomToken(24);
  await repo.setSecret('AI_WEBHOOK_TOKEN', token);
  return token;
}

export async function startTranscription(env: AiEnv, callId: string, force = false): Promise<'started' | 'skipped'> {
  const call = await env.repo.call(callId);
  if (!call?.recording_path) throw new HttpError(409, 'Zu diesem Anruf gibt es (noch) keine Aufnahme.');
  if (!force && ['queued', 'processing', 'ready'].includes(call.transcript_status ?? 'none')) return 'skipped';
  const key = await env.repo.secret('ASSEMBLYAI_API_KEY');
  if (!key) throw new HttpError(409, 'Abschriften sind noch nicht eingerichtet (Einstellungen → KI & Abschriften).');
  const token = await webhookToken(env.repo);
  // AssemblyAI lädt die Datei selbst (Link 6 Stunden gültig)
  const audioUrl = await env.repo.signedUrl('recordings', call.recording_path, 6 * 3600);
  await env.repo.updateCall(callId, { transcript_status: 'queued' });
  try {
    const id = await startTranscript(
      key,
      transcriptRequest({
        audioUrl,
        channels: call.recording_channels ?? 1,
        webhookUrl: env.fn('ai-webhook', { callId }),
        webhookToken: token,
      }),
      env.fetchFn,
    );
    await env.repo.upsertInsights({ call_id: callId, transcript_job: id, error: null });
    await env.repo.updateCall(callId, { transcript_status: 'processing' });
    return 'started';
  } catch (e) {
    await env.repo.updateCall(callId, { transcript_status: 'failed' });
    await env.repo.upsertInsights({ call_id: callId, error: `Abschrift konnte nicht gestartet werden: ${e instanceof Error ? e.message : e}` });
    throw e;
  }
}

export async function finishTranscription(env: AiEnv, callId: string, t: AssemblyTranscript): Promise<'ready' | 'failed' | 'pending'> {
  const call = await env.repo.call(callId);
  if (!call) return 'failed';
  if (t.status === 'error') {
    await env.repo.upsertInsights({ call_id: callId, error: `Abschrift fehlgeschlagen: ${t.error ?? 'unbekannter Fehler'}` });
    await env.repo.updateCall(callId, { transcript_status: 'failed' });
    return 'failed';
  }
  if (t.status !== 'completed') return 'pending';
  const segments = segmentsFrom(t, {
    channels: call.recording_channels ?? 1,
    agentChannel: call.agent_channel ?? null,
    voicemail: call.is_voicemail,
  });
  await env.repo.upsertInsights({
    call_id: callId,
    segments,
    transcript_text: (t.text ?? segments.map((s) => s.text).join(' ')).slice(0, 200_000),
    language: t.language_code ?? 'de',
    error: null,
  });
  await env.repo.updateCall(callId, { transcript_status: 'ready' });
  const org = await env.repo.org();
  if (org.summary_enabled && segments.length) {
    try {
      await summarizeCall(env, callId);
    } catch (e) {
      await env.repo.log('ai', 'warn', `Zusammenfassung fehlgeschlagen: ${e instanceof Error ? e.message : e}`, { callId });
    }
  }
  return 'ready';
}

export async function summarizeCall(env: AiEnv, callId: string): Promise<Summary | null> {
  const key = await env.repo.secret('ANTHROPIC_API_KEY');
  if (!key) return null;
  const [call, ins, org] = await Promise.all([env.repo.call(callId), env.repo.insights(callId), env.repo.org()]);
  const segments = (ins?.segments ?? []) as Segment[];
  if (!call || !segments.length) return null;
  const words = segments.map((s) => s.text).join(' ');
  if (words.length < 40) return null; // zu kurz für eine sinnvolle Zusammenfassung
  const [agent, lead] = await Promise.all([
    call.user_id ? env.repo.profile(call.user_id) : null,
    call.lead_id ? env.repo.lead(call.lead_id) : null,
  ]);
  const model = (await env.repo.secret('ANTHROPIC_MODEL')) || DEFAULT_SUMMARY_MODEL;
  const firstName = agent?.full_name.split(' ')[0] || 'Vertrieb';
  const resp = await callClaude(
    key,
    summaryRequest({
      model,
      transcript: transcriptForPrompt(segments, firstName),
      leadName: lead?.name ?? null,
      agentName: agent?.full_name ?? '',
      orgName: org.name,
      voicemail: call.is_voicemail,
    }),
    env.fetchFn,
  );
  const summary = parseSummary(resp as Parameters<typeof parseSummary>[0]);
  await env.repo.upsertInsights({ call_id: callId, summary });
  return summary;
}
