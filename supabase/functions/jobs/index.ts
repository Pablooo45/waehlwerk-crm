// Hintergrundaufgaben, jede Minute vom Zeitplan (pg_cron) aufgerufen:
// Workflows, geplante E-Mails/SMS, Postfach-Abruf, Abschriften nachfassen, Löschfristen, Aufräumen,
// Aufnahmen nachholen.

import { getTranscript } from '../_shared/ai.ts';
import { check, hookUrl, isCronRequest, requireAdmin, SupabaseRepo } from '../_shared/db.ts';
import { background, errorResponse, HttpError, isUuid, json } from '../_shared/http.ts';
import { finishTranscription } from '../_shared/insights.ts';
import { type MailAccount, sendEmailRow, syncAccount } from '../_shared/mailer.ts';
import { telCtx } from '../_shared/server.ts';
import { sendSmsRow } from '../_shared/sms.ts';
import { retryRecording } from '../twilio-status/logic.ts';
import { runDueWorkflows } from './workflows.ts';

const BUDGET_MS = 45_000;

Deno.serve(async (req) => {
  const repo = new SupabaseRepo();
  try {
    if (!(await isCronRequest(req, repo))) await requireAdmin(req, repo);
  } catch (e) {
    return errorResponse(e instanceof HttpError ? e : new HttpError(401, 'Nicht erlaubt.'));
  }

  // Eine Aufnahme nachholen – eigener Aufruf, damit sie die volle Rechen- und Laufzeit hat.
  // Antwortet sofort und arbeitet danach weiter (wie bei der Rückmeldung von Twilio).
  const url = new URL(req.url);
  if (url.searchParams.get('task') === 'recording') {
    const callId = url.searchParams.get('callId');
    if (!isUuid(callId)) return errorResponse(new HttpError(400, 'Anruf unbekannt.'));
    background(
      retryRecording(telCtx(repo), callId).catch((e) =>
        repo.log('jobs', 'error', `Aufnahme nachholen: ${e instanceof Error ? e.message : e}`, { callId })
      ),
    );
    return json({ callId, started: true }, 202);
  }

  const started = Date.now();
  const deadline = started + BUDGET_MS;
  const db = repo.db;
  const env = { db, repo };
  const report: Record<string, unknown> = {};

  const step = async (name: string, fn: () => Promise<unknown>) => {
    if (Date.now() > deadline) {
      report[name] = 'übersprungen (Zeit)';
      return;
    }
    try {
      report[name] = await fn();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      report[name] = { error: msg };
      await repo.log('jobs', 'error', `${name}: ${msg}`);
    }
  };

  // 1) Workflows
  await step('workflows', () =>
    runDueWorkflows(
      { db, repo, now: () => new Date(), sendEmail: (id) => sendEmailRow(env, id), sendSms: (id) => sendSmsRow(env, id) },
      started + 30_000,
    )
  );

  // 2) Geplante E-Mails (auch Sammel-E-Mails) – gestaffelt
  await step('emails', async () => {
    const ids = check(await db.rpc('claim_scheduled_emails', { p_limit: 15 }), 'E-Mails') as string[];
    let sent = 0;
    for (const id of ids) {
      if (Date.now() > deadline) {
        await db.from('emails').update({ status: 'scheduled' }).eq('id', id).eq('status', 'sending');
        continue;
      }
      if ((await sendEmailRow(env, id)).ok) sent++;
    }
    return { claimed: ids.length, sent };
  });

  // 3) Geplante SMS
  await step('sms', async () => {
    const ids = check(await db.rpc('claim_scheduled_sms', { p_limit: 20 }), 'SMS') as string[];
    let sent = 0;
    for (const id of ids) if ((await sendSmsRow(env, id)).ok) sent++;
    return { claimed: ids.length, sent };
  });

  // 4) Postfächer abrufen (je Postfach alle 5 Minuten)
  await step('mailboxes', async () => {
    const accounts = check(await db.rpc('claim_mail_sync', { p_limit: 5, p_minutes: 5 }), 'Postfächer') as MailAccount[];
    const out: Record<string, unknown> = {};
    for (const a of accounts) {
      if (Date.now() > deadline - 8_000) break;
      try {
        out[a.email] = await syncAccount(env, a);
      } catch (e) {
        out[a.email] = { error: e instanceof Error ? e.message : String(e) };
      }
    }
    return out;
  });

  // 5) Abschriften, deren Rückmeldung ausblieb, selbst abholen
  await step('transcripts', async () => {
    const key = await repo.secret('ASSEMBLYAI_API_KEY');
    if (!key) return 'nicht eingerichtet';
    const rows = check(await db.rpc('stale_transcripts', { p_minutes: 10, p_limit: 5 }), 'Abschriften') as { call_id: string; transcript_job: string | null }[];
    let done = 0;
    for (const r of rows) {
      if (!r.transcript_job) {
        await db.from('calls').update({ transcript_status: 'failed' }).eq('id', r.call_id);
        continue;
      }
      const t = await getTranscript(key, r.transcript_job);
      const state = await finishTranscription({ repo, fn: hookUrl }, r.call_id, t);
      if (state !== 'pending') done++;
    }
    return { checked: rows.length, done };
  });

  // 6) Löschfrist für Aufnahmen
  await step('retention', async () => {
    const org = await repo.org();
    if (!org.recording_retention_days) return 'aus';
    const n = check(await db.rpc('expire_recordings', { p_days: org.recording_retention_days, p_limit: 200 }), 'Löschfrist') as number;
    return { expired: n };
  });

  // 7) Dateien gelöschter Aufnahmen/Anrufe aus dem Speicher entfernen
  await step('storage', async () => {
    const rows = check(await db.from('storage_trash').select('id, bucket, path').order('id').limit(200), 'Papierkorb') as { id: number; bucket: string; path: string }[];
    const byBucket = new Map<string, typeof rows>();
    rows.forEach((r) => byBucket.set(r.bucket, [...(byBucket.get(r.bucket) ?? []), r]));
    for (const [bucket, list] of byBucket) {
      await repo.removeFiles(bucket, list.map((r) => r.path));
      check(await db.from('storage_trash').delete().in('id', list.map((r) => r.id)), 'Papierkorb');
    }
    return { removed: rows.length };
  });

  // 8) Hängengebliebene Anrufe (Rückmeldung von Twilio verloren) abschließen
  await step('stale_calls', async () => ({ closed: check(await db.rpc('close_stale_calls'), 'Anrufe') }));

  // 9) Aufnahmen nachholen: Verarbeitung abgebrochen, fehlgeschlagen oder Meldung von Twilio verloren.
  //    Jede läuft in einem eigenen Aufruf dieser Funktion (volle Rechenzeit, blockiert nichts).
  await step('recordings', async () => {
    const ids = check(await db.rpc('claim_recording_retries', { p_limit: 3 }), 'Aufnahmen') as string[];
    if (!ids.length) return { started: 0 };
    const token = await repo.secret('CRON_TOKEN');
    if (!token) {
      // ohne Zeitplan (von Hand gestartet): eine direkt hier, die übrigen in 10 Minuten
      return { started: 1, result: await retryRecording(telCtx(repo), ids[0]) };
    }
    let started = 0;
    for (const id of ids) {
      try {
        const r = await fetch(hookUrl('jobs', { task: 'recording', callId: id }), { method: 'POST', headers: { 'x-crm-cron': token } });
        await r.body?.cancel();
        if (r.ok) started++;
        else await repo.log('jobs', 'warn', `Aufnahme nachholen nicht gestartet (HTTP ${r.status}) – neuer Versuch in 10 Minuten`, { callId: id });
      } catch (e) {
        await repo.log('jobs', 'warn', `Aufnahme nachholen nicht gestartet: ${e instanceof Error ? e.message : e}`, { callId: id });
      }
    }
    return { claimed: ids.length, started };
  });

  await repo.setSecret('JOBS_LAST_RUN', new Date().toISOString()).catch(() => undefined);
  report.ms = Date.now() - started;
  return json(report);
});
