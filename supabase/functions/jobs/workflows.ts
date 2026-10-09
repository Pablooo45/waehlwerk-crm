// Workflows ausführen (wie Close-Workflows/Sequenzen): fällige Schritte abarbeiten, Wartezeiten,
// Versandfenster, Ziele. Wird jede Minute vom Zeitplan aufgerufen.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.117.2';
import { inWindow, nextWindowStart, type SendWindow } from '../_shared/berlin.ts';
import { check, type Repo } from '../_shared/db.ts';
import { type FilterSetLike, type LeadLike, matchesFilter } from '../_shared/filtering.ts';
import { accountOf } from '../_shared/mailer.ts';
import { pickSmsFrom } from '../_shared/sms.ts';
import { fillTemplate, templateVars } from '../_shared/template.ts';

export interface WfStep {
  id: string;
  type: 'email' | 'sms' | 'call' | 'task' | 'update_lead' | 'assign' | 'opportunity' | 'notify' | 'filter';
  wait: { amount: number; unit: 'minutes' | 'hours' | 'days' };
  config: Record<string, unknown>;
}

export interface Workflow {
  id: string;
  name: string;
  status: 'draft' | 'active' | 'paused';
  steps: WfStep[];
  send_window: SendWindow;
  sender_mode: 'owner' | 'enroller' | 'fixed';
  sender_user: string | null;
}

export interface Run {
  id: string;
  workflow_id: string;
  lead_id: string;
  contact_id: string | null;
  status: string;
  step_index: number;
  started_by: string | null;
  log: { at: string; step: number; result: string }[];
}

interface Contact {
  id: string;
  name: string;
  phones: { number: string; type?: string }[];
  emails: { email: string }[];
  sort: number;
}

type Lead = LeadLike & { id: string; name: string; contacts: Contact[] };

export interface WfEnv {
  db: SupabaseClient;
  repo: Repo;
  now: () => Date;
  sendEmail: (emailId: string) => Promise<{ ok: boolean; error?: string }>;
  sendSms: (smsId: string) => Promise<{ ok: boolean; error?: string }>;
}

export function waitMs(w: WfStep['wait'] | undefined): number {
  const n = Math.max(0, Number(w?.amount ?? 0));
  return n * (w?.unit === 'minutes' ? 60_000 : w?.unit === 'hours' ? 3_600_000 : 86_400_000);
}

// Deutsche Handynummer (015x/016x/017x) bevorzugt
export function mobileOf(c: Contact | null | undefined): string | null {
  const list = c?.phones ?? [];
  return (list.find((p) => p.type === 'mobile') ?? list.find((p) => /^\+491[567]/.test(p.number)))?.number ?? null;
}

interface Ctx {
  orgName: string;
  statuses: { id: string; label: string }[];
  customFields: { key: string; type: string }[];
  templates: Map<string, { id: string; kind: string; subject: string; body: string; is_html: boolean }>;
  profiles: Map<string, { id: string; full_name: string; email: string; phone_number: string | null; active: boolean }>;
}

async function loadCtx(env: WfEnv): Promise<Ctx> {
  const [org, statuses, fields, templates, profiles] = await Promise.all([
    env.repo.org(),
    env.db.from('lead_statuses').select('id, label'),
    env.db.from('custom_fields').select('key, type').eq('entity', 'lead'),
    env.db.from('email_templates').select('id, kind, subject, body, is_html'),
    env.db.from('profiles').select('id, full_name, email, phone_number, active'),
  ]);
  return {
    orgName: org.name,
    statuses: check(statuses, 'Status') as Ctx['statuses'],
    customFields: check(fields, 'Felder') as Ctx['customFields'],
    templates: new Map((check(templates, 'Vorlagen') as { id: string }[]).map((t) => [t.id, t as never])),
    profiles: new Map((check(profiles, 'Team') as { id: string }[]).map((p) => [p.id, p as never])),
  };
}

export async function runDueWorkflows(env: WfEnv, deadline: number): Promise<{ processed: number; failed: number }> {
  const claimed = check(await env.db.rpc('workflow_claim_due', { p_limit: 25 }), 'Workflows') as Run[];
  if (!claimed.length) return { processed: 0, failed: 0 };
  const ids = [...new Set(claimed.map((r) => r.workflow_id))];
  const wfs = new Map((check(await env.db.from('workflows').select('*').in('id', ids), 'Workflows') as Workflow[]).map((w) => [w.id, w]));
  const ctx = await loadCtx(env);
  let processed = 0;
  let failed = 0;
  for (const run of claimed) {
    if (Date.now() > deadline) {
      // Zeit um – Rest beim nächsten Durchlauf
      await env.db.from('workflow_runs').update({ locked_at: null }).eq('id', run.id);
      continue;
    }
    try {
      await processRun(env, ctx, run, wfs.get(run.workflow_id) ?? null);
      processed++;
    } catch (e) {
      failed++;
      const msg = e instanceof Error ? e.message : String(e);
      await finish(env, run, 'failed', `Fehler: ${msg}`.slice(0, 300), [{ at: env.now().toISOString(), step: run.step_index, result: `Fehler: ${msg}` }]);
      await env.repo.log('jobs', 'error', `Workflow-Schritt fehlgeschlagen: ${msg}`, { run: run.id });
    }
  }
  return { processed, failed };
}

async function finish(env: WfEnv, run: Run, status: string, reason: string, add: Run['log'] = []) {
  await env.db.from('workflow_runs').update({
    status,
    ended_at: env.now().toISOString(),
    end_reason: reason,
    locked_at: null,
    log: [...(run.log ?? []), ...add].slice(-100),
  }).eq('id', run.id);
}

async function processRun(env: WfEnv, ctx: Ctx, run: Run, wf: Workflow | null) {
  const now = env.now();
  if (!wf || wf.status === 'draft') return finish(env, run, 'canceled', 'Workflow wurde deaktiviert');
  if (wf.status === 'paused') {
    await env.db.from('workflow_runs').update({ next_at: new Date(now.getTime() + 15 * 60_000).toISOString(), locked_at: null }).eq('id', run.id);
    return;
  }
  const steps = wf.steps ?? [];
  const i = run.step_index;
  if (i >= steps.length) return finish(env, run, 'finished', 'Alle Schritte erledigt');
  const step = steps[i];

  // E-Mails und SMS nur im Versandfenster (Berliner Zeit)
  if ((step.type === 'email' || step.type === 'sms') && !inWindow(wf.send_window, now)) {
    await env.db.from('workflow_runs').update({ next_at: nextWindowStart(wf.send_window, now).toISOString(), locked_at: null }).eq('id', run.id);
    return;
  }

  const lead = check(
    await env.db.from('leads').select('*, contacts(id, name, phones, emails, sort)').eq('id', run.lead_id).maybeSingle(),
    'Lead',
  ) as Lead | null;
  if (!lead) return finish(env, run, 'canceled', 'Lead wurde gelöscht');
  lead.contacts = [...(lead.contacts ?? [])].sort((a, b) => a.sort - b.sort);

  const out = await execStep(env, ctx, wf, run, lead, step);
  const entry = { at: now.toISOString(), step: i, result: out.result };
  if (out.retryAt) {
    await env.db.from('workflow_runs').update({ next_at: out.retryAt.toISOString(), locked_at: null, log: [...(run.log ?? []), entry].slice(-100) }).eq('id', run.id);
    return;
  }
  if (out.stop) return finish(env, run, out.stop.status, out.stop.reason, [entry]);
  if (i + 1 < steps.length) {
    await env.db.from('workflow_runs').update({
      step_index: i + 1,
      next_at: new Date(now.getTime() + waitMs(steps[i + 1].wait)).toISOString(),
      locked_at: null,
      log: [...(run.log ?? []), entry].slice(-100),
    }).eq('id', run.id);
  } else {
    await finish(env, run, 'finished', 'Alle Schritte erledigt', [entry]);
  }
}

interface StepResult {
  result: string;
  stop?: { status: 'finished' | 'failed'; reason: string };
  retryAt?: Date;
}

function senderOf(wf: Workflow, run: Run, lead: Lead): string | null {
  if (wf.sender_mode === 'fixed' && wf.sender_user) return wf.sender_user;
  if (wf.sender_mode === 'enroller') return run.started_by ?? lead.owner_id;
  return lead.owner_id ?? run.started_by ?? wf.sender_user;
}

function retries(run: Run, step: number): number {
  return (run.log ?? []).filter((l) => l.step === step && l.result.startsWith('Fehler')).length;
}

async function execStep(env: WfEnv, ctx: Ctx, wf: Workflow, run: Run, lead: Lead, step: WfStep): Promise<StepResult> {
  const c = step.config ?? {};
  const sender = senderOf(wf, run, lead);
  const senderProfile = sender ? ctx.profiles.get(sender) ?? null : null;
  const contact = (run.contact_id ? lead.contacts.find((x) => x.id === run.contact_id) : null) ?? lead.contacts[0] ?? null;
  const vars = templateVars(lead, contact, senderProfile ?? { full_name: '', email: '' }, ctx.orgName);
  const assignee = lead.owner_id ?? sender;
  const now = env.now();

  switch (step.type) {
    case 'email': {
      const tpl = ctx.templates.get(String(c.template_id ?? ''));
      if (!tpl || tpl.kind !== 'email') return { result: 'Übersprungen: E-Mail-Vorlage fehlt' };
      const to = (run.contact_id ? contact : lead.contacts.find((x) => x.emails?.[0]?.email)) ?? null;
      const address = to?.emails?.[0]?.email;
      if (!address) return { result: 'Übersprungen: keine E-Mail-Adresse' };
      if (!sender || !senderProfile?.active) return { result: 'Fehler: kein Absender', stop: { status: 'failed', reason: 'Kein aktiver Absender für E-Mails' } };
      const account = await accountOf(env.db, sender);
      if (!account) {
        return { result: 'Fehler: Absender hat kein Postfach', stop: { status: 'failed', reason: `${senderProfile.full_name} hat kein E-Mail-Postfach verbunden` } };
      }
      const v = templateVars(lead, to, senderProfile, ctx.orgName);
      const ins = check(
        await env.db.from('emails').insert({
          lead_id: lead.id,
          contact_id: to!.id,
          user_id: sender,
          account_id: account.id,
          direction: 'outbound',
          status: 'sending',
          to_address: address,
          subject: fillTemplate(tpl.subject, v),
          body: fillTemplate(tpl.body, v),
          is_html: tpl.is_html,
          template_id: tpl.id,
          workflow_run_id: run.id,
        }).select('id').single(),
        'E-Mail',
      ) as { id: string };
      const r = await env.sendEmail(ins.id);
      if (r.ok) return { result: `E-Mail an ${address} gesendet` };
      if (retries(run, run.step_index) < 2) return { result: `Fehler: ${r.error} – neuer Versuch in 30 Min.`, retryAt: new Date(now.getTime() + 30 * 60_000) };
      return { result: `Fehler: ${r.error}`, stop: { status: 'failed', reason: `E-Mail nicht gesendet: ${r.error}` } };
    }
    case 'sms': {
      if (lead.do_not_call) return { result: 'Übersprungen: Lead möchte nicht kontaktiert werden' };
      const to = (run.contact_id ? contact : lead.contacts.find((x) => mobileOf(x))) ?? null;
      const number = mobileOf(to);
      if (!number) return { result: 'Übersprungen: keine Handynummer' };
      const tpl = c.template_id ? ctx.templates.get(String(c.template_id)) : null;
      const text = fillTemplate(tpl?.kind === 'sms' ? tpl.body : String(c.body ?? ''), templateVars(lead, to, senderProfile ?? { full_name: '', email: '' }, ctx.orgName)).trim();
      if (!text) return { result: 'Übersprungen: SMS-Text fehlt' };
      const from = pickSmsFrom({ requested: null, profileNumber: senderProfile?.phone_number ?? null, userId: sender ?? '', numbers: await env.repo.phoneNumbers() });
      if (!from) return { result: 'Fehler: keine SMS-fähige Nummer', stop: { status: 'failed', reason: 'Keine SMS-fähige Nummer eingerichtet' } };
      const ins = check(
        await env.db.from('sms_messages').insert({
          lead_id: lead.id,
          contact_id: to!.id,
          user_id: sender,
          direction: 'outbound',
          from_number: from,
          to_number: number,
          body: text,
          status: 'queued',
          workflow_run_id: run.id,
        }).select('id').single(),
        'SMS',
      ) as { id: string };
      const r = await env.sendSms(ins.id);
      if (r.ok) return { result: `SMS an ${number} gesendet` };
      return { result: `Fehler: ${r.error}`, stop: { status: 'failed', reason: `SMS nicht gesendet: ${r.error}` } };
    }
    case 'call':
    case 'task': {
      if (step.type === 'call' && lead.do_not_call) return { result: 'Übersprungen: Lead möchte nicht angerufen werden' };
      const title = fillTemplate(String(c.title || (step.type === 'call' ? 'Anrufen' : 'Aufgabe')), vars);
      await env.repo.insertTask({
        lead_id: lead.id,
        contact_id: contact?.id ?? null,
        assigned_to: assignee,
        type: step.type === 'call' ? 'call' : 'workflow',
        title,
        note: `Aus Workflow „${wf.name}“`,
        due_at: now.toISOString(),
        created_by: null,
      });
      return { result: `Aufgabe „${title}“ angelegt` };
    }
    case 'update_lead': {
      const patch: Record<string, unknown> = {};
      if (typeof c.status_id === 'string' && c.status_id) patch.status_id = c.status_id;
      if (c.custom && typeof c.custom === 'object') patch.custom = { ...(lead.custom ?? {}), ...(c.custom as Record<string, unknown>) };
      if (!Object.keys(patch).length) return { result: 'Nichts zu ändern' };
      check(await env.db.from('leads').update(patch).eq('id', lead.id), 'Lead');
      return { result: 'Lead geändert' };
    }
    case 'assign': {
      const users = ((c.user_ids as string[] | undefined) ?? []).filter((u) => ctx.profiles.get(u)?.active);
      if (!users.length) return { result: 'Übersprungen: niemand zum Zuweisen' };
      const key = `wfrr:${wf.id}:${step.id}`;
      const pointer = Number((await env.repo.secret(key)) ?? 0) || 0;
      const pick = users[pointer % users.length];
      await env.repo.setSecret(key, String(pointer + 1));
      check(await env.db.from('leads').update({ owner_id: pick }).eq('id', lead.id), 'Lead');
      return { result: `Zugewiesen an ${ctx.profiles.get(pick)?.full_name ?? 'Kollege'}` };
    }
    case 'opportunity': {
      if (!c.status_id) return { result: 'Übersprungen: Status fehlt' };
      check(
        await env.db.from('opportunities').insert({
          lead_id: lead.id,
          contact_id: contact?.id ?? null,
          user_id: assignee,
          status_id: c.status_id,
          value: Number(c.value ?? 0) || 0,
          value_period: ['one_time', 'monthly', 'annual'].includes(String(c.value_period)) ? c.value_period : 'one_time',
          confidence: 50,
          note: `Aus Workflow „${wf.name}“`,
        }),
        'Opportunity',
      );
      return { result: 'Opportunity angelegt' };
    }
    case 'notify': {
      const users = ((c.user_ids as string[] | undefined) ?? []).length ? (c.user_ids as string[]) : assignee ? [assignee] : [];
      const title = fillTemplate(String(c.title || wf.name), vars);
      for (const u of users) await env.repo.notify(u, 'workflow', lead.id, 'lead', lead.id, title, `${lead.name} (Workflow „${wf.name}“)`);
      return { result: `${users.length} benachrichtigt` };
    }
    case 'filter': {
      const filter = (c.filter as FilterSetLike | undefined) ?? { conditions: [] };
      const ok = matchesFilter(lead, filter, { statuses: ctx.statuses, me: { id: assignee ?? '' }, customFields: ctx.customFields }, now);
      if (ok) return { result: 'Bedingung erfüllt' };
      return { result: 'Bedingung nicht erfüllt', stop: { status: 'finished', reason: 'Bedingung nicht erfüllt' } };
    }
    default:
      return { result: `Unbekannter Schritt „${(step as WfStep).type}“ übersprungen` };
  }
}
