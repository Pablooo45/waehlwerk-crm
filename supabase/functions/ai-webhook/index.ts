// AssemblyAI meldet sich hier, sobald eine Abschrift fertig ist. Danach schreibt Claude die Zusammenfassung.

import { getTranscript } from '../_shared/ai.ts';
import { hookUrl, SupabaseRepo } from '../_shared/db.ts';
import { safeEqual } from '../_shared/crypto.ts';
import { background, isUuid, readJson } from '../_shared/http.ts';
import { finishTranscription } from '../_shared/insights.ts';

Deno.serve(async (req) => {
  const repo = new SupabaseRepo();
  const url = new URL(req.url);
  const callId = url.searchParams.get('callId');
  try {
    const expected = await repo.secret('AI_WEBHOOK_TOKEN');
    const got = req.headers.get('x-crm-webhook') ?? '';
    if (!expected || !safeEqual(got, expected)) return new Response('Nicht erlaubt', { status: 403 });
    const body = await readJson<{ transcript_id?: string; status?: string }>(req);
    if (!isUuid(callId) || !body.transcript_id) return new Response(null, { status: 204 });
    const key = await repo.secret('ASSEMBLYAI_API_KEY');
    if (!key) return new Response(null, { status: 204 });
    // Antwort sofort, Verarbeitung (inkl. Zusammenfassung) im Hintergrund
    background(
      (async () => {
        const ins = await repo.insights(callId);
        if (ins?.transcript_job && ins.transcript_job !== body.transcript_id) return; // veralteter Auftrag
        const t = await getTranscript(key, body.transcript_id!);
        await finishTranscription({ repo, fn: hookUrl }, callId, t);
      })().catch((e) => repo.log('ai-webhook', 'error', `Abschrift nicht übernommen: ${e instanceof Error ? e.message : e}`, { callId })),
    );
  } catch (e) {
    await repo.log('ai-webhook', 'error', String(e), { callId });
  }
  return new Response(null, { status: 204 });
});
