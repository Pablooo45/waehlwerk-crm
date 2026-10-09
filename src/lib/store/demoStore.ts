// Demo-Modus: alles im Browser, nichts verlässt das Gerät.
// Bildet die Regeln der Datenbank nach (Rollen & Rechte, Sichtbarkeit, Verlauf,
// Benachrichtigungen, Formular-Automatik, Workflows), damit sich die Demo wie das echte CRM verhält.

import { demoDialogRecording, DEMO_SCRIPTS, buildScript, type DemoRecording } from '../audio/demoAudio.ts';
import { addDays, DAY, startOfDay } from '../dates.ts';
import { matchesFilter, searchTerms } from '../filters.ts';
import { fillTemplate, normalizePhone } from '../format.ts';
import { uuid } from '../ids.ts';
import { permsOfRole, visibilityOfRole } from '../perms.ts';
import type {
  ActivityRow,
  AppLog,
  AppNotification,
  Call,
  CallHourRow,
  CallInsights,
  CallQuality,
  Comment,
  CommentTarget,
  Contact,
  CustomActivity,
  DailyRow,
  DuplicatePair,
  Email,
  FilterSet,
  FormValueRow,
  FunnelRow,
  ID,
  Lead,
  LeadInput,
  LeadVisibility,
  LiveCall,
  Meeting,
  Note,
  NotificationKind,
  Opportunity,
  OrgSettings,
  OutcomeRow,
  Permission,
  Profile,
  RefData,
  SmartView,
  SmsMessage,
  SortSpec,
  StatusChangeRow,
  Task,
  TimelineItem,
  VoicemailDrop,
  WorkflowRun,
} from '../types.ts';
import { blobToDataUrl, demoRecording, demoRecordingSamples } from '../wav.ts';
import { analyzeMono } from '../audio/analysis.ts';
import { createDemoDb, DEMO_USERS, DEMO_VERSION, type DemoDb } from './demoData.ts';
import {
  type CallFilter,
  CONFIG_KEYS,
  type ConfigRows,
  type ConfigTable,
  type ContactFilter,
  type EmailSendInput,
  type ImportOptions,
  type ImportResult,
  type ImportRow,
  type JobsState,
  type MeetingFilter,
  type NotificationFilter,
  type OpportunityFilter,
  type Page,
  type RealtimeTable,
  type SmsSendInput,
  type Store,
  type TaskFilter,
} from './types.ts';

const KEY = 'waehlwerk-demo';
const SESSION_KEY = 'waehlwerk-demo-user';

function load(): DemoDb {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as DemoDb;
      if (parsed.version === DEMO_VERSION) return parsed;
    }
  } catch {
    /* Speicher nicht verfügbar → frische Demo */
  }
  return createDemoDb();
}

const wait = (ms = 40) => new Promise((r) => setTimeout(r, ms));
const clone = <T,>(v: T): T => (v == null ? v : (JSON.parse(JSON.stringify(v)) as T));
const nowIso = () => new Date().toISOString();

const CONFIG_COLLECTION: { [T in ConfigTable]: keyof DemoDb } = {
  roles: 'roles',
  groups: 'groups',
  lead_statuses: 'statuses',
  call_outcomes: 'outcomes',
  pipelines: 'pipelines',
  opportunity_statuses: 'oppStatuses',
  custom_fields: 'customFields',
  activity_types: 'activityTypes',
  integration_links: 'integrationLinks',
  email_templates: 'templates',
  workflows: 'workflows',
  phone_numbers: 'numbers',
  smart_views: 'smartViews',
};

const CONFIG_PERMISSION: { [T in ConfigTable]: Permission | null } = {
  roles: 'manage_organization',
  groups: 'manage_organization',
  lead_statuses: 'manage_customizations',
  call_outcomes: 'manage_customizations',
  pipelines: 'manage_customizations',
  opportunity_statuses: 'manage_customizations',
  custom_fields: 'manage_customizations',
  activity_types: 'manage_customizations',
  integration_links: 'manage_customizations',
  email_templates: null,
  workflows: 'manage_workflows',
  phone_numbers: 'manage_phone_numbers',
  smart_views: null,
};

export class DemoStore implements Store {
  readonly mode = 'demo' as const;
  db: DemoDb;
  private me: Profile | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Map<RealtimeTable, Set<(row: Record<string, unknown>) => void>>();
  private audioCache = new Map<string, string>();
  private recordingCache = new Map<string, DemoRecording>();
  private signedOut = new Set<() => void>();
  private logs: AppLog[] = [];
  private workflowTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.db = load();
    this.prepare();
    try {
      const id = localStorage.getItem(SESSION_KEY);
      this.me = this.db.profiles.find((p) => p.id === id && p.active) ?? null;
    } catch {
      this.me = null;
    }
    if (typeof window !== 'undefined') this.workflowTimer = setInterval(() => this.runDueWorkflows(), 15_000);
  }

  dispose() {
    if (this.workflowTimer) clearInterval(this.workflowTimer);
    this.workflowTimer = null;
  }

  private prepare() {
    for (const l of this.db.leads) this.recompute(l.id);
    // Redeanteile aus den Beispiel-Abschriften (die echte Auswertung macht der Server)
    for (const c of this.db.calls) {
      const s = this.db.callScripts[c.id];
      if (s && c.recording_path && c.talk_agent_ms == null) {
        const built = buildScript(s.key, this.scriptNames(c), s.seed);
        c.talk_agent_ms = built.segments.filter((x) => x.speaker === 'agent').reduce((a, x) => a + x.end - x.start, 0);
        c.talk_customer_ms = built.segments.filter((x) => x.speaker === 'customer').reduce((a, x) => a + x.end - x.start, 0);
      }
    }
  }

  // ---------- intern ----------
  private persist() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      try {
        localStorage.setItem(KEY, JSON.stringify(this.db));
      } catch {
        /* egal im Demo-Modus */
      }
    }, 300);
  }

  reset() {
    this.db = createDemoDb();
    this.prepare();
    this.persist();
  }

  emit(table: RealtimeTable, row: Record<string, unknown>) {
    this.listeners.get(table)?.forEach((cb) => cb(row));
  }

  private user(): Profile {
    if (!this.me) throw new Error('Nicht angemeldet.');
    return this.me;
  }

  private perms(): Permission[] {
    const role = this.db.roles.find((r) => r.id === this.me?.role_id);
    return permsOfRole(role);
  }

  private has(p: Permission): boolean {
    return this.perms().includes(p);
  }

  private require(p: Permission, msg = 'Keine Berechtigung.') {
    if (!this.has(p)) throw new Error(msg);
  }

  private visibility(): LeadVisibility {
    return visibilityOfRole(this.db.roles.find((r) => r.id === this.me?.role_id));
  }

  private canSee(lead: Pick<Lead, 'owner_id' | 'opener_id'> | undefined | null): boolean {
    if (!lead || !this.me) return false;
    const v = this.visibility();
    if (v === 'all') return true;
    if (lead.owner_id === this.me.id || lead.opener_id === this.me.id) return true;
    return v === 'own_and_unassigned' && !lead.owner_id;
  }

  private canSeeLeadId(id: ID | null | undefined): boolean {
    if (!id) return this.visibility() === 'all';
    return this.canSee(this.db.leads.find((l) => l.id === id));
  }

  private leadName(id: ID | null | undefined) {
    return this.db.leads.find((l) => l.id === id)?.name ?? '';
  }

  private leadRef(id: ID | null | undefined) {
    if (!id) return null;
    return { id, name: this.leadName(id), status_id: this.db.leads.find((l) => l.id === id)?.status_id ?? null };
  }

  private notify(userId: ID | null | undefined, kind: NotificationKind, leadId: ID | null, refKind: string | null, refId: ID | null, title: string, body = '') {
    if (!userId || userId === this.me?.id) return;
    if (!this.db.profiles.some((p) => p.id === userId && p.active)) return;
    const n: AppNotification = {
      id: uuid(), user_id: userId, kind, lead_id: leadId, ref_kind: refKind, ref_id: refId, actor_id: this.me?.id ?? null,
      title, body: body.slice(0, 500), created_at: nowIso(), read_at: null, done_at: null, snoozed_until: null,
    };
    this.db.notifications.push(n);
    this.emit('notifications', n as unknown as Record<string, unknown>);
  }

  private event(leadId: ID, type: string, data: Record<string, unknown>) {
    this.db.events.push({ id: uuid(), lead_id: leadId, user_id: this.me?.id ?? null, type, data, created_at: nowIso() });
  }

  recompute(leadId: ID) {
    const lead = this.db.leads.find((l) => l.id === leadId);
    if (!lead) return;
    const calls = this.db.calls.filter((c) => c.lead_id === leadId).sort((a, b) => (a.started_at < b.started_at ? 1 : -1));
    const outbound = calls.filter((c) => c.direction === 'outbound');
    lead.call_count = outbound.length;
    lead.last_call_at = outbound[0]?.started_at ?? null;
    lead.last_call_outcome = calls.find((c) => c.outcome)?.outcome ?? null;
    const connectedKeys = new Set(this.db.outcomes.filter((o) => o.counts_as_connected).map((o) => o.key));
    lead.last_connected_at = calls.find((c) => c.outcome && connectedKeys.has(c.outcome))?.started_at ?? null;
    const open = this.db.tasks.filter((t) => t.lead_id === leadId && !t.done && t.due_at).map((t) => t.due_at!).sort();
    lead.next_task_due = open[0] ?? null;
    const now = Date.now() - 2 * 3_600_000;
    const upcoming = this.db.meetings
      .filter((m) => m.lead_id === leadId && m.status === 'scheduled' && new Date(m.starts_at).getTime() >= now)
      .map((m) => m.starts_at)
      .sort();
    lead.next_meeting_at = upcoming[0] ?? null;
    const acts = [
      ...calls.map((c) => c.started_at),
      ...this.db.notes.filter((n) => n.lead_id === leadId).map((n) => n.created_at),
      ...this.db.meetings.filter((m) => m.lead_id === leadId).map((m) => m.created_at),
      ...this.db.activities.filter((a) => a.lead_id === leadId).map((a) => a.created_at),
      ...this.db.emails.filter((e) => e.lead_id === leadId).map((e) => e.created_at),
      ...this.db.sms.filter((e) => e.lead_id === leadId).map((e) => e.created_at),
    ].sort();
    lead.last_activity_at = acts[acts.length - 1] ?? lead.last_activity_at;
  }

  private withContacts(lead: Lead): Lead {
    return {
      ...clone(lead),
      contacts: clone(this.db.contacts.filter((c) => c.lead_id === lead.id).sort((a, b) => a.sort - b.sort)),
    };
  }

  private searchText(lead: Lead): string {
    const parts = [lead.name, lead.address_city, lead.address_zip, lead.address_street, lead.url];
    for (const c of this.db.contacts.filter((c) => c.lead_id === lead.id)) {
      parts.push(c.name, c.title);
      for (const p of c.phones) {
        parts.push(p.number, p.number.replace(/\D/g, ''));
        if (p.number.startsWith('+49')) parts.push('0' + p.number.slice(3));
      }
      for (const e of c.emails) parts.push(e.email);
    }
    return parts.filter(Boolean).join(' ').toLowerCase();
  }

  private visibleLeads(): Lead[] {
    if (this.visibility() === 'all') return this.db.leads;
    return this.db.leads.filter((l) => this.canSee(l));
  }

  private filterLeads(filter: FilterSet, sort: SortSpec): Lead[] {
    const ref = { statuses: this.db.statuses, me: this.user(), customFields: this.db.customFields };
    const terms = searchTerms(filter.q);
    let rows = this.visibleLeads().filter((l) => matchesFilter(l, filter, ref));
    if (terms.length) {
      rows = rows.filter((l) => {
        const text = this.searchText(l);
        return terms.every((t) => text.includes(t));
      });
    }
    const dir = sort.dir === 'asc' ? 1 : -1;
    const key = sort.field;
    rows.sort((a, b) => {
      const av = a[key as keyof Lead] as string | number | null;
      const bv = b[key as keyof Lead] as string | number | null;
      if (av == null && bv == null) return a.name.localeCompare(b.name, 'de');
      if (av == null) return 1; // leere Werte immer ans Ende
      if (bv == null) return -1;
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
      return String(av).localeCompare(String(bv), 'de') * dir;
    });
    return rows;
  }

  // ---------- Workflows (Auslöser, Ziele, Ausführung) ----------
  private workflowEvent(leadId: ID | null, kind: string, value: string | null) {
    if (!leadId) return;
    const now = nowIso();
    for (const run of this.db.runs.filter((r) => r.lead_id === leadId && (r.status === 'active' || r.status === 'paused'))) {
      const wf = this.db.workflows.find((w) => w.id === run.workflow_id);
      if (!wf) continue;
      if (wf.goal.type === kind && (!wf.goal.value || wf.goal.value === value)) {
        Object.assign(run, { status: 'goal_met', ended_at: now, end_reason: 'Ziel erreicht' });
      } else if (kind === 'replied' && wf.stop_on_reply) {
        Object.assign(run, { status: 'finished', ended_at: now, end_reason: 'Antwort erhalten' });
      }
    }
    if (kind === 'replied') return;
    const lead = this.db.leads.find((l) => l.id === leadId);
    if (!lead) return;
    for (const wf of this.db.workflows) {
      if (wf.status !== 'active' || wf.trigger.type !== kind) continue;
      if (wf.trigger.value && wf.trigger.value !== value) continue;
      const f = wf.trigger.filters ?? {};
      if (f.status_ids?.length && !f.status_ids.includes(lead.status_id ?? '')) continue;
      if (f.owner_ids?.length && !f.owner_ids.includes(lead.owner_id ?? '')) continue;
      this.startRun(wf.id, leadId, null);
    }
  }

  private waitMs(step: { wait?: { amount: number; unit: string } } | undefined): number {
    if (!step?.wait) return 0;
    const n = step.wait.amount || 0;
    return step.wait.unit === 'days' ? n * DAY : step.wait.unit === 'hours' ? n * 3_600_000 : n * 60_000;
  }

  private startRun(workflowId: ID, leadId: ID, contactId: ID | null): boolean {
    const wf = this.db.workflows.find((w) => w.id === workflowId);
    if (!wf || wf.status !== 'active') return false;
    if (this.db.runs.some((r) => r.workflow_id === workflowId && r.lead_id === leadId && (r.status === 'active' || r.status === 'paused'))) return false;
    if (!wf.allow_reenroll && this.db.runs.some((r) => r.workflow_id === workflowId && r.lead_id === leadId)) return false;
    this.db.runs.push({
      id: uuid(), workflow_id: workflowId, lead_id: leadId, contact_id: contactId, status: 'active', step_index: 0,
      next_at: new Date(Date.now() + this.waitMs(wf.steps[0])).toISOString(), started_by: this.me?.id ?? null,
      started_at: nowIso(), ended_at: null, end_reason: null, log: [],
    });
    return true;
  }

  runDueWorkflows() {
    if (!this.me) return;
    let changed = false;
    const now = Date.now();
    for (const run of this.db.runs) {
      if (run.status !== 'active' || !run.next_at || new Date(run.next_at).getTime() > now) continue;
      const wf = this.db.workflows.find((w) => w.id === run.workflow_id);
      const lead = this.db.leads.find((l) => l.id === run.lead_id);
      const step = wf?.steps[run.step_index];
      if (!wf || !lead || !step) {
        Object.assign(run, { status: 'finished', ended_at: nowIso(), end_reason: 'Alle Schritte erledigt', next_at: null });
        changed = true;
        continue;
      }
      const result = this.executeStep(wf.sender_mode === 'fixed' ? wf.sender_user : lead.owner_id ?? run.started_by, lead, run.contact_id, step);
      run.log.push({ at: nowIso(), step: run.step_index, result });
      run.step_index++;
      const next = wf.steps[run.step_index];
      if (result.startsWith('Bedingung nicht erfüllt')) {
        Object.assign(run, { status: 'finished', ended_at: nowIso(), end_reason: result, next_at: null });
      } else if (!next) {
        Object.assign(run, { status: 'finished', ended_at: nowIso(), end_reason: 'Alle Schritte erledigt', next_at: null });
      } else {
        run.next_at = new Date(now + this.waitMs(next)).toISOString();
      }
      changed = true;
    }
    if (changed) {
      this.persist();
      this.emit('tasks', {});
    }
  }

  private executeStep(senderId: ID | null, lead: Lead, contactId: ID | null, step: { type: string; config: Record<string, unknown> }): string {
    const contact = this.db.contacts.find((c) => c.id === contactId) ?? this.db.contacts.find((c) => c.lead_id === lead.id);
    const sender = this.db.profiles.find((p) => p.id === senderId) ?? this.me!;
    const vars = this.templateVars(lead, contact ?? null, sender);
    const cfg = step.config ?? {};
    switch (step.type) {
      case 'email': {
        const tpl = this.db.templates.find((t) => t.id === cfg.template_id);
        const to = contact?.emails[0]?.email;
        if (!tpl || !to) return 'Übersprungen: keine E-Mail-Adresse';
        this.db.emails.push({
          id: uuid(), lead_id: lead.id, contact_id: contact?.id ?? null, user_id: sender.id, account_id: null, direction: 'outbound', status: 'sent',
          from_address: sender.email, to_address: to, subject: fillTemplate(tpl.subject, vars), body: fillTemplate(tpl.body, vars), is_html: tpl.is_html,
          template_id: tpl.id, sent_at: nowIso(), opens: 0, created_at: nowIso(),
        });
        this.recompute(lead.id);
        return `E-Mail „${tpl.name}“ gesendet (Demo)`;
      }
      case 'sms': {
        const tpl = this.db.templates.find((t) => t.id === cfg.template_id);
        const to = contact?.phones.find((p) => p.type === 'mobile')?.number ?? contact?.phones[0]?.number;
        if (!to) return 'Übersprungen: keine Nummer';
        this.db.sms.push({
          id: uuid(), lead_id: lead.id, contact_id: contact?.id ?? null, user_id: sender.id, direction: 'outbound', from_number: this.db.org.default_caller_id,
          to_number: to, body: fillTemplate(tpl?.body ?? String(cfg.body ?? ''), vars), status: 'delivered', send_at: null, error: null, created_at: nowIso(),
        });
        return 'SMS gesendet (Demo)';
      }
      case 'call':
      case 'task': {
        this.db.tasks.push({
          id: uuid(), lead_id: lead.id, contact_id: contact?.id ?? null, assigned_to: sender.id, created_by: null, type: step.type === 'call' ? 'call' : 'workflow',
          title: String(cfg.title || (step.type === 'call' ? 'Anrufen' : 'Aufgabe')), note: null, due_at: nowIso(), done: false, done_at: null, done_by: null, call_id: null,
          created_at: nowIso(),
        });
        this.recompute(lead.id);
        return `Aufgabe „${cfg.title || 'Anrufen'}“ angelegt`;
      }
      case 'update_lead': {
        const patch: LeadInput = {};
        if (cfg.status_id) patch.status_id = String(cfg.status_id);
        if (cfg.custom && typeof cfg.custom === 'object') patch.custom = { ...lead.custom, ...(cfg.custom as Record<string, unknown>) };
        this.applyLeadPatch(lead, patch);
        return 'Lead aktualisiert';
      }
      case 'assign': {
        const users = (cfg.user_ids as string[] | undefined) ?? [];
        if (!users.length) return 'Übersprungen: niemand ausgewählt';
        const idx = Number(cfg.rr ?? 0) % users.length;
        cfg.rr = idx + 1;
        this.applyLeadPatch(lead, { owner_id: users[idx] });
        return `Zugewiesen an ${this.db.profiles.find((p) => p.id === users[idx])?.full_name ?? '?'}`;
      }
      case 'opportunity': {
        const statusId = String(cfg.status_id ?? this.db.oppStatuses[0]?.id ?? '');
        this.db.opportunities.push({
          id: uuid(), lead_id: lead.id, contact_id: contact?.id ?? null, user_id: sender.id, status_id: statusId, value: Number(cfg.value ?? 0), value_period: 'one_time',
          confidence: 30, expected_close: null, note: null, custom: {}, closed_at: null, created_at: nowIso(), updated_at: nowIso(),
        });
        return 'Opportunity angelegt';
      }
      case 'notify': {
        const users = (cfg.user_ids as string[] | undefined) ?? (lead.owner_id ? [lead.owner_id] : []);
        users.forEach((u) => this.notify(u, 'workflow', lead.id, 'lead', lead.id, String(cfg.title || `Workflow: ${lead.name}`), String(cfg.body ?? '')));
        return 'Benachrichtigung gesendet';
      }
      case 'filter': {
        const filter = (cfg.filter as FilterSet | undefined) ?? { conditions: [] };
        const ok = matchesFilter(lead, filter, { statuses: this.db.statuses, me: this.user(), customFields: this.db.customFields });
        return ok ? 'Bedingung erfüllt' : 'Bedingung nicht erfüllt – Workflow beendet';
      }
      default:
        return 'Unbekannter Schritt';
    }
  }

  private templateVars(lead: Lead | null, contact: Contact | null, user: Profile): Record<string, string> {
    const name = contact?.name ?? '';
    const parts = name.replace(/^(Dr\.|Prof\.)\s+/g, '').split(' ');
    return {
      'lead.name': lead?.name ?? '',
      'lead.address_city': lead?.address_city ?? '',
      'contact.name': name,
      'contact.first_name': parts[0] ?? '',
      'contact.last_name': parts.slice(1).join(' '),
      'user.name': user.full_name,
      'user.first_name': user.full_name.split(' ')[0] ?? '',
      'user.email': user.email,
      'organization.name': this.db.org.name,
    };
  }

  // ---------- Anmeldung ----------
  async currentUser() {
    return this.me ? clone(this.me) : null;
  }

  demoUsers(): (Profile & { roleName: string })[] {
    return clone(this.db.profiles.filter((p) => p.active)).map((p) => ({ ...p, roleName: this.db.roles.find((r) => r.id === p.role_id)?.name ?? '' }));
  }

  async signIn(email: string) {
    await wait(200);
    const p = this.db.profiles.find((x) => (x.email === email.trim().toLowerCase() || x.id === email) && x.active) ??
      this.db.profiles.find((x) => x.id === DEMO_USERS.alex)!;
    this.me = p;
    try {
      localStorage.setItem(SESSION_KEY, p.id);
    } catch {
      /* egal */
    }
    return clone(p);
  }

  async signOut() {
    this.me = null;
    try {
      localStorage.removeItem(SESSION_KEY);
    } catch {
      /* egal */
    }
    this.signedOut.forEach((cb) => cb());
  }

  async sendPasswordReset() {
    await wait();
  }

  async changePassword() {
    await wait();
  }

  onSignedOut(cb: () => void) {
    this.signedOut.add(cb);
    return () => this.signedOut.delete(cb);
  }

  // ---------- Stammdaten ----------
  async loadRef(): Promise<RefData> {
    await wait();
    const me = this.user();
    const fresh = this.db.profiles.find((p) => p.id === me.id);
    if (!fresh?.active) {
      await this.signOut();
      throw new Error('Dein Zugang wurde deaktiviert.');
    }
    this.me = fresh;
    const role = this.db.roles.find((r) => r.id === fresh.role_id);
    return clone({
      me: fresh,
      perms: permsOfRole(role),
      visibility: visibilityOfRole(role),
      profiles: this.db.profiles,
      roles: [...this.db.roles].sort((a, b) => a.sort - b.sort),
      groups: [...this.db.groups].sort((a, b) => a.name.localeCompare(b.name, 'de')),
      groupMembers: this.db.groupMembers,
      statuses: [...this.db.statuses].sort((a, b) => a.sort - b.sort),
      outcomes: [...this.db.outcomes].sort((a, b) => a.sort - b.sort),
      pipelines: [...this.db.pipelines].sort((a, b) => a.sort - b.sort),
      oppStatuses: [...this.db.oppStatuses].sort((a, b) => a.sort - b.sort),
      customFields: [...this.db.customFields].sort((a, b) => a.sort - b.sort),
      activityTypes: [...this.db.activityTypes].sort((a, b) => a.sort - b.sort),
      integrationLinks: [...this.db.integrationLinks].sort((a, b) => a.sort - b.sort),
      org: this.db.org,
      smartViews: this.db.smartViews.filter((v) => v.shared || v.created_by === me.id).sort((a, b) => a.position - b.position),
      phoneNumbers: this.db.numbers,
      templates: this.db.templates.filter((t) => t.shared || t.created_by === me.id),
      voicemailDrops: this.db.drops.filter((d) => d.shared || d.user_id === me.id),
      workflows: this.db.workflows,
      emailAccounts: this.db.emailAccounts.filter((a) => a.user_id === me.id),
    });
  }

  // ---------- Leads ----------
  async listLeads(filter: FilterSet, sort: SortSpec, page: Page) {
    await wait();
    const rows = this.filterLeads(filter, sort);
    return { rows: rows.slice(page.offset, page.offset + page.limit).map((l) => this.withContacts(l)), total: rows.length };
  }

  async listLeadIds(filter: FilterSet, sort: SortSpec, limit: number) {
    return this.filterLeads(filter, sort).slice(0, limit).map((l) => l.id);
  }

  async countLeads(filter: FilterSet) {
    return this.filterLeads(filter, { field: 'name', dir: 'asc' }).length;
  }

  async searchLeads(q: string, limit = 8) {
    const terms = searchTerms(q);
    if (!terms.length) return [];
    const rows = this.visibleLeads().filter((l) => {
      const text = this.searchText(l);
      return terms.every((t) => text.includes(t));
    });
    return rows.slice(0, limit).map((l) => this.withContacts(l));
  }

  async getLead(id: ID) {
    await wait();
    const lead = this.db.leads.find((l) => l.id === id);
    return lead && this.canSee(lead) ? this.withContacts(lead) : null;
  }

  async getLeads(ids: ID[]) {
    const set = new Set(ids);
    return this.db.leads.filter((l) => set.has(l.id) && this.canSee(l)).map((l) => this.withContacts(l));
  }

  async createLead(input: LeadInput & { name: string }, contacts: Partial<Contact>[] = []) {
    await wait();
    const now = nowIso();
    const def = this.db.statuses.find((s) => s.is_default)?.id ?? null;
    const me = this.user();
    const lead: Lead = {
      id: uuid(),
      name: input.name.trim(),
      status_id: input.status_id ?? def,
      owner_id: input.owner_id === undefined ? (this.visibility() === 'all' ? null : me.id) : input.owner_id,
      opener_id: input.opener_id ?? null,
      url: input.url ?? null,
      description: input.description ?? null,
      address_street: input.address_street ?? null,
      address_zip: input.address_zip ?? null,
      address_city: input.address_city ?? null,
      address_state: input.address_state ?? null,
      address_country: input.address_country ?? 'DE',
      source: input.source ?? null,
      custom: input.custom ?? {},
      do_not_call: input.do_not_call ?? false,
      last_call_at: null,
      last_call_outcome: null,
      last_connected_at: null,
      call_count: 0,
      last_activity_at: null,
      next_task_due: null,
      next_meeting_at: null,
      created_by: me.id,
      created_at: now,
      updated_at: now,
    };
    this.db.leads.push(lead);
    this.event(lead.id, 'created', { source: lead.source });
    if (lead.owner_id) this.notify(lead.owner_id, 'assigned', lead.id, 'lead', lead.id, `Neuer Lead für dich: ${lead.name}`);
    contacts.forEach((c, i) => this.insertContact({ ...c, lead_id: lead.id, sort: c.sort ?? i }));
    this.workflowEvent(lead.id, 'lead_created', null);
    this.persist();
    if (!this.canSee(lead)) throw new Error('Lead angelegt – du siehst ihn aber nicht, weil er jemand anderem zugeordnet ist.');
    return this.withContacts(lead);
  }

  private applyLeadPatch(lead: Lead, patch: LeadInput) {
    const now = nowIso();
    if (patch.custom !== undefined && !this.has('edit_restricted_fields')) {
      for (const f of this.db.customFields.filter((x) => x.entity === 'lead' && x.restricted)) {
        if (JSON.stringify(patch.custom?.[f.key] ?? null) !== JSON.stringify(lead.custom?.[f.key] ?? null)) {
          throw new Error(`Das Feld „${f.label}“ ist geschützt und darf nur mit dem Recht „Geschützte Felder bearbeiten“ geändert werden.`);
        }
      }
    }
    const statusChanged = patch.status_id !== undefined && patch.status_id !== lead.status_id;
    if (statusChanged) this.event(lead.id, 'status', { from: lead.status_id, to: patch.status_id });
    if (patch.owner_id !== undefined && patch.owner_id !== lead.owner_id) {
      this.event(lead.id, 'owner', { from: lead.owner_id, to: patch.owner_id });
      this.notify(patch.owner_id, 'assigned', lead.id, 'lead', lead.id, `Dir zugewiesen: ${lead.name}`);
    }
    Object.assign(lead, clone(patch), { updated_at: now });
    if (statusChanged) {
      this.workflowEvent(lead.id, 'status', lead.status_id);
      this.workflowEvent(lead.id, 'status_changed', lead.status_id);
    }
  }

  async updateLead(id: ID, patch: LeadInput) {
    await wait();
    const lead = this.db.leads.find((l) => l.id === id);
    if (!lead || !this.canSee(lead)) throw new Error('Lead nicht gefunden.');
    this.applyLeadPatch(lead, patch);
    this.persist();
  }

  async bulkUpdateLeads(ids: ID[], patch: LeadInput) {
    this.require('bulk_edit', 'Keine Berechtigung für Sammelbearbeitung.');
    let n = 0;
    for (const id of ids) {
      const lead = this.db.leads.find((l) => l.id === id);
      if (!lead || !this.canSee(lead)) continue;
      const p: LeadInput = { ...patch };
      if (patch.custom) {
        const merged = { ...lead.custom, ...patch.custom };
        for (const [k, v] of Object.entries(merged)) if (v === null) delete merged[k];
        p.custom = merged;
      }
      this.applyLeadPatch(lead, p);
      n++;
    }
    this.persist();
    return n;
  }

  async deleteLeads(ids: ID[]) {
    this.require('delete_leads', 'Keine Berechtigung zum Löschen.');
    if (ids.length > 1) this.require('bulk_delete', 'Keine Berechtigung zum gesammelten Löschen.');
    const set = new Set(ids.filter((id) => this.canSeeLeadId(id)));
    this.db.leads = this.db.leads.filter((l) => !set.has(l.id));
    this.db.contacts = this.db.contacts.filter((c) => !set.has(c.lead_id));
    this.db.notes = this.db.notes.filter((n) => !set.has(n.lead_id));
    this.db.tasks = this.db.tasks.filter((t) => !t.lead_id || !set.has(t.lead_id));
    this.db.opportunities = this.db.opportunities.filter((o) => !set.has(o.lead_id));
    this.db.activities = this.db.activities.filter((a) => !set.has(a.lead_id));
    this.db.comments = this.db.comments.filter((c) => !set.has(c.lead_id));
    this.db.runs = this.db.runs.filter((r) => !set.has(r.lead_id));
    this.db.events = this.db.events.filter((e) => !set.has(e.lead_id));
    this.db.calls.forEach((c) => {
      if (c.lead_id && set.has(c.lead_id)) c.lead_id = null;
    });
    this.persist();
    return set.size;
  }

  private insertContact(c: Partial<Contact> & { lead_id: ID }): Contact {
    const contact: Contact = {
      id: c.id ?? uuid(),
      lead_id: c.lead_id,
      name: c.name ?? '',
      title: c.title ?? null,
      phones: (c.phones ?? [])
        .filter((p) => p.number?.trim())
        .map((p) => ({ type: p.type ?? 'office', number: normalizePhone(p.number) ?? p.number })),
      emails: (c.emails ?? []).filter((e) => e.email?.trim()).map((e) => ({ type: e.type ?? 'office', email: e.email.trim().toLowerCase() })),
      custom: c.custom ?? {},
      sort: c.sort ?? 0,
      created_at: c.created_at ?? nowIso(),
    };
    const i = this.db.contacts.findIndex((x) => x.id === contact.id);
    if (i >= 0) this.db.contacts[i] = contact;
    else this.db.contacts.push(contact);
    return contact;
  }

  async saveContact(contact: Partial<Contact> & { lead_id: ID }) {
    await wait();
    if (!this.canSeeLeadId(contact.lead_id)) throw new Error('Lead nicht gefunden.');
    const c = this.insertContact(contact);
    this.persist();
    return clone(c);
  }

  async deleteContact(id: ID) {
    this.db.contacts = this.db.contacts.filter((c) => c.id !== id || !this.canSeeLeadId(c.lead_id));
    this.persist();
  }

  async findLeadByPhone(number: string) {
    const n = normalizePhone(number);
    if (!n) return null;
    const contact = this.db.contacts.find((c) => c.phones.some((p) => p.number === n) && this.canSeeLeadId(c.lead_id));
    if (!contact) return null;
    const lead = this.db.leads.find((l) => l.id === contact.lead_id);
    return lead ? { lead: this.withContacts(lead), contact: clone(contact) } : null;
  }

  async listContacts(filter: ContactFilter) {
    await wait();
    const term = (filter.q ?? '').trim().toLowerCase();
    const phone = normalizePhone(term);
    let rows = this.db.contacts.filter((c) => this.canSeeLeadId(c.lead_id));
    if (term) {
      rows = rows.filter((c) =>
        c.name.toLowerCase().includes(term) || (c.title ?? '').toLowerCase().includes(term) ||
        c.emails.some((e) => e.email.includes(term)) || (!!phone && c.phones.some((p) => p.number === phone)) ||
        this.leadName(c.lead_id).toLowerCase().includes(term)
      );
    }
    if (filter.role) rows = rows.filter((c) => ((c.custom?.contact_role as string[] | undefined) ?? []).includes(filter.role!));
    rows.sort((a, b) => a.name.localeCompare(b.name, 'de'));
    const out = rows.slice(filter.page.offset, filter.page.offset + filter.page.limit).map((c) => {
      const l = this.db.leads.find((x) => x.id === c.lead_id);
      return { ...clone(c), lead: l ? { id: l.id, name: l.name, status_id: l.status_id, owner_id: l.owner_id } : null };
    });
    return { rows: out, total: rows.length };
  }

  async findDuplicates(leadId: ID | null = null, limit = 200): Promise<DuplicatePair[]> {
    await wait(80);
    const visible = this.visibleLeads();
    const ids = new Set(visible.map((l) => l.id));
    const pairs = new Map<string, Set<string>>();
    const add = (a: ID, b: ID, reason: string) => {
      if (a === b) return;
      const [x, y] = a < b ? [a, b] : [b, a];
      if (this.db.dismissed.some(([p, q]) => p === x && q === y)) return;
      const k = `${x}|${y}`;
      if (!pairs.has(k)) pairs.set(k, new Set());
      pairs.get(k)!.add(reason);
    };
    const byPhone = new Map<string, ID[]>();
    const byMail = new Map<string, ID[]>();
    for (const c of this.db.contacts) {
      if (!ids.has(c.lead_id)) continue;
      c.phones.forEach((p) => byPhone.set(p.number, [...new Set([...(byPhone.get(p.number) ?? []), c.lead_id])]));
      c.emails.forEach((e) => byMail.set(e.email, [...new Set([...(byMail.get(e.email) ?? []), c.lead_id])]));
    }
    const groups = (m: Map<string, ID[]>, reason: string) => m.forEach((list) => list.forEach((a, i) => list.slice(i + 1).forEach((b) => add(a, b, reason))));
    groups(byPhone, 'gleiche Telefonnummer');
    groups(byMail, 'gleiche E-Mail-Adresse');
    const byName = new Map<string, ID[]>();
    for (const l of visible) {
      if (!l.address_zip) continue;
      const k = `${l.name.toLowerCase().replace(/[^a-z0-9äöüß]/g, '')}|${l.address_zip}`;
      byName.set(k, [...(byName.get(k) ?? []), l.id]);
    }
    groups(byName, 'gleicher Name und PLZ');
    return [...pairs.entries()]
      .map(([k, reasons]) => {
        const [lead_a, lead_b] = k.split('|');
        return { lead_a, lead_b, reasons: [...reasons].sort().join(', ') };
      })
      .filter((p) => !leadId || p.lead_a === leadId || p.lead_b === leadId)
      .slice(0, limit);
  }

  async dismissDuplicate(a: ID, b: ID) {
    const [x, y] = a < b ? [a, b] : [b, a];
    this.db.dismissed.push([x, y]);
    this.persist();
  }

  async mergeLeads(keepId: ID, mergeId: ID) {
    this.require('merge_leads', 'Keine Berechtigung zum Zusammenführen.');
    if (keepId === mergeId) throw new Error('Bitte zwei verschiedene Leads wählen.');
    const k = this.db.leads.find((l) => l.id === keepId);
    const m = this.db.leads.find((l) => l.id === mergeId);
    if (!k || !m || !this.canSee(k) || !this.canSee(m)) throw new Error('Lead nicht gefunden.');
    const move = <T extends { lead_id: ID | null }>(arr: T[]) => arr.forEach((x) => {
      if (x.lead_id === mergeId) x.lead_id = keepId;
    });
    for (const r of this.db.runs) {
      if (r.lead_id === mergeId && (r.status === 'active' || r.status === 'paused') &&
        this.db.runs.some((x) => x.lead_id === keepId && x.workflow_id === r.workflow_id && (x.status === 'active' || x.status === 'paused'))) {
        Object.assign(r, { status: 'canceled', ended_at: nowIso(), end_reason: 'Lead zusammengeführt' });
      }
    }
    [this.db.contacts, this.db.calls, this.db.notes, this.db.emails, this.db.sms, this.db.tasks, this.db.meetings, this.db.opportunities,
      this.db.events, this.db.activities, this.db.comments, this.db.notifications, this.db.runs].forEach((arr) => move(arr as { lead_id: ID | null }[]));
    const keepCustom = Object.fromEntries(Object.entries(k.custom).filter(([, v]) => v !== null && v !== '' && !(Array.isArray(v) && !v.length)));
    Object.assign(k, {
      url: k.url || m.url,
      description: [k.description, m.description].filter(Boolean).join('\n\n') || null,
      address_street: k.address_street || m.address_street,
      address_zip: k.address_zip || m.address_zip,
      address_city: k.address_city || m.address_city,
      address_state: k.address_state || m.address_state,
      source: k.source || m.source,
      status_id: k.status_id ?? m.status_id,
      owner_id: k.owner_id ?? m.owner_id,
      opener_id: k.opener_id ?? m.opener_id,
      do_not_call: k.do_not_call || m.do_not_call,
      custom: { ...m.custom, ...keepCustom },
      created_at: k.created_at < m.created_at ? k.created_at : m.created_at,
    });
    this.db.leads = this.db.leads.filter((l) => l.id !== mergeId);
    this.event(keepId, 'merged', { id: m.id, name: m.name });
    this.recompute(keepId);
    this.persist();
  }

  // ---------- Verlauf ----------
  async timeline(leadId: ID, limit = 200): Promise<TimelineItem[]> {
    await wait();
    if (!this.canSeeLeadId(leadId)) return [];
    const items: TimelineItem[] = [
      ...this.db.calls.filter((c) => c.lead_id === leadId).map((c) => ({ kind: 'call' as const, id: c.id, lead_id: leadId, user_id: c.user_id, at: c.started_at, data: c })),
      ...this.db.notes.filter((n) => n.lead_id === leadId).map((n) => ({ kind: 'note' as const, id: n.id, lead_id: leadId, user_id: n.user_id, at: n.created_at, data: n })),
      ...this.db.emails.filter((e) => e.lead_id === leadId).map((e) => ({ kind: 'email' as const, id: e.id, lead_id: leadId, user_id: e.user_id, at: e.sent_at ?? e.send_at ?? e.created_at, data: e })),
      ...this.db.sms.filter((e) => e.lead_id === leadId).map((e) => ({ kind: 'sms' as const, id: e.id, lead_id: leadId, user_id: e.user_id, at: e.send_at ?? e.created_at, data: e })),
      ...this.db.meetings.filter((m) => m.lead_id === leadId).map((m) => ({ kind: 'meeting' as const, id: m.id, lead_id: leadId, user_id: m.set_by ?? m.host_user_id, at: m.created_at, data: m })),
      ...this.db.events.filter((e) => e.lead_id === leadId).map((e) => ({ kind: 'event' as const, id: e.id, lead_id: leadId, user_id: e.user_id, at: e.created_at, data: e })),
      ...this.db.tasks.filter((t) => t.lead_id === leadId && t.done).map((t) => ({ kind: 'task' as const, id: t.id, lead_id: leadId, user_id: t.done_by, at: t.done_at ?? t.created_at, data: t })),
      ...this.db.activities.filter((a) => a.lead_id === leadId).map((a) => ({ kind: 'activity' as const, id: a.id, lead_id: leadId, user_id: a.user_id, at: a.created_at, data: a })),
    ];
    return clone(items.sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, limit));
  }

  private mentionsNotify(leadId: ID, refKind: string, refId: ID, body: string, mentions: ID[], before: ID[] = []) {
    for (const u of mentions) {
      if (!before.includes(u)) this.notify(u, 'mention', leadId, refKind, refId, `Erwähnt bei ${this.leadName(leadId) || 'einem Lead'}`, body);
    }
  }

  async addNote(leadId: ID, body: string, contactId: ID | null = null, mentions: ID[] = []) {
    await wait();
    if (!this.canSeeLeadId(leadId)) throw new Error('Lead nicht gefunden.');
    const now = nowIso();
    const note: Note = { id: uuid(), lead_id: leadId, contact_id: contactId, user_id: this.user().id, body, mentions, pinned: false, created_at: now, updated_at: now };
    this.db.notes.push(note);
    this.mentionsNotify(leadId, 'note', note.id, body, mentions);
    this.recompute(leadId);
    this.persist();
    return clone(note);
  }

  async updateNote(id: ID, patch: { body?: string; pinned?: boolean; mentions?: ID[] }) {
    const n = this.db.notes.find((x) => x.id === id);
    if (!n) return;
    if (n.user_id !== this.me?.id && !this.has('manage_others_activities')) throw new Error('Nur eigene Notizen können geändert werden.');
    const before = n.mentions ?? [];
    Object.assign(n, patch, { updated_at: nowIso() });
    if (patch.mentions) this.mentionsNotify(n.lead_id, 'note', n.id, n.body, patch.mentions, before);
    this.persist();
  }

  private canDelete(ownerId: ID | null) {
    return (ownerId === this.me?.id && this.has('delete_own_activities')) || this.has('manage_others_activities');
  }

  async deleteNote(id: ID) {
    const n = this.db.notes.find((x) => x.id === id);
    if (n && !this.canDelete(n.user_id)) throw new Error('Keine Berechtigung zum Löschen.');
    this.db.notes = this.db.notes.filter((x) => x.id !== id);
    this.persist();
  }

  async logEmail(input: { lead_id: ID; contact_id: ID | null; to_address: string | null; subject: string; body: string }) {
    const e: Email = { ...input, id: uuid(), user_id: this.user().id, direction: 'outbound', status: 'logged', created_at: nowIso() };
    this.db.emails.push(e);
    this.recompute(input.lead_id);
    this.persist();
    return clone(e);
  }

  async listComments(leadId: ID) {
    if (!this.canSeeLeadId(leadId)) return [];
    return clone(this.db.comments.filter((c) => c.lead_id === leadId).sort((a, b) => a.created_at.localeCompare(b.created_at)));
  }

  async listCommentsFor(kind: CommentTarget, targetId: ID) {
    return clone(this.db.comments.filter((c) => c.target_kind === kind && c.target_id === targetId && this.canSeeLeadId(c.lead_id)).sort((a, b) => a.created_at.localeCompare(b.created_at)));
  }

  async addComment(input: { lead_id: ID; target_kind: CommentTarget; target_id: ID; body: string; at_ms?: number | null; mentions?: ID[] }) {
    if (!this.canSeeLeadId(input.lead_id)) throw new Error('Lead nicht gefunden.');
    const c: Comment = { id: uuid(), ...input, at_ms: input.at_ms ?? null, mentions: input.mentions ?? [], user_id: this.user().id, created_at: nowIso(), updated_at: nowIso() };
    this.db.comments.push(c);
    this.mentionsNotify(c.lead_id, 'comment', c.id, c.body, c.mentions);
    const owner =
      c.target_kind === 'call' ? this.db.calls.find((x) => x.id === c.target_id)?.user_id
      : c.target_kind === 'note' ? this.db.notes.find((x) => x.id === c.target_id)?.user_id
      : c.target_kind === 'email' ? this.db.emails.find((x) => x.id === c.target_id)?.user_id
      : c.target_kind === 'activity' ? this.db.activities.find((x) => x.id === c.target_id)?.user_id
      : c.target_kind === 'opportunity' ? this.db.opportunities.find((x) => x.id === c.target_id)?.user_id
      : c.target_kind === 'meeting' ? this.db.meetings.find((x) => x.id === c.target_id)?.set_by
      : null;
    if (owner && !c.mentions.includes(owner)) this.notify(owner, 'comment', c.lead_id, 'comment', c.id, `Kommentar bei ${this.leadName(c.lead_id) || 'einem Lead'}`, c.body);
    this.persist();
    return clone(c);
  }

  async deleteComment(id: ID) {
    const c = this.db.comments.find((x) => x.id === id);
    if (c && c.user_id !== this.me?.id && !this.has('manage_others_activities')) throw new Error('Nur eigene Kommentare können gelöscht werden.');
    this.db.comments = this.db.comments.filter((x) => x.id !== id);
    this.persist();
  }

  async saveActivity(a: Partial<CustomActivity> & { type_id: ID; lead_id: ID; data: Record<string, unknown> }) {
    await wait();
    if (!this.canSeeLeadId(a.lead_id)) throw new Error('Lead nicht gefunden.');
    const type = this.db.activityTypes.find((t) => t.id === a.type_id);
    if (!type) throw new Error('Aktivität nicht gefunden.');
    const status = a.status ?? 'published';
    if (status === 'published') {
      for (const f of type.fields.filter((x) => x.required)) {
        const v = a.data[f.key];
        if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) throw new Error(`Bitte „${f.label}“ ausfüllen.`);
      }
    }
    let act = a.id ? this.db.activities.find((x) => x.id === a.id) : undefined;
    const wasPublished = act?.status === 'published';
    if (act) {
      if (act.user_id !== this.me?.id && !this.has('manage_others_activities')) throw new Error('Nur eigene Aktivitäten können geändert werden.');
      Object.assign(act, { data: clone(a.data), status, contact_id: a.contact_id ?? act.contact_id, updated_at: nowIso() });
    } else {
      act = { id: uuid(), type_id: a.type_id, lead_id: a.lead_id, contact_id: a.contact_id ?? null, user_id: this.user().id, call_id: a.call_id ?? null, data: clone(a.data), status, created_at: nowIso(), updated_at: nowIso() };
      this.db.activities.push(act);
    }
    if (status === 'published' && !wasPublished) {
      // Formular-Automatik wie in der Datenbank
      const lead = this.db.leads.find((l) => l.id === a.lead_id)!;
      const noteLines = type.fields
        .filter((f) => ['text', 'textarea', 'choice', 'number'].includes(f.type) && act!.data[f.key] !== undefined && act!.data[f.key] !== '')
        .map((f) => `${f.label}: ${act!.data[f.key]}`);
      for (const f of type.fields) {
        const v = act.data[f.key];
        if (v === undefined || v === null || v === '') continue;
        if (f.creates_task && (f.type === 'date' || f.type === 'datetime')) {
          const due = f.type === 'date' ? new Date(`${v}T09:00:00`).toISOString() : new Date(String(v)).toISOString();
          this.db.tasks.push({
            id: uuid(), lead_id: lead.id, contact_id: act.contact_id, assigned_to: act.user_id, created_by: act.user_id, type: 'call', title: type.name,
            note: noteLines.join('\n') || null, due_at: due, done: false, done_at: null, done_by: null, call_id: null, created_at: nowIso(),
          });
        }
        if (f.sets_lead_date?.field && f.sets_lead_date.map[String(v)]) {
          const [amount, unit] = f.sets_lead_date.map[String(v)].split(' ');
          const d = startOfDay();
          if (unit.startsWith('day')) d.setDate(d.getDate() + Number(amount));
          else d.setMonth(d.getMonth() + Number(amount));
          const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
          lead.custom = { ...lead.custom, [f.sets_lead_date.field]: iso };
        }
      }
      this.workflowEvent(lead.id, 'activity_created', type.id);
      this.recompute(lead.id);
      this.emit('tasks', {});
    }
    this.persist();
    return clone(act);
  }

  async deleteActivity(id: ID) {
    const a = this.db.activities.find((x) => x.id === id);
    if (a && !this.canDelete(a.user_id)) throw new Error('Keine Berechtigung zum Löschen.');
    this.db.activities = this.db.activities.filter((x) => x.id !== id);
    this.persist();
  }

  async listActivities(filter: { typeId?: ID | null; userId?: ID | null; from?: Date; to?: Date; limit?: number }) {
    let rows = this.db.activities.filter((a) => a.status === 'published' && this.canSeeLeadId(a.lead_id));
    if (filter.typeId) rows = rows.filter((a) => a.type_id === filter.typeId);
    if (filter.userId) rows = rows.filter((a) => a.user_id === filter.userId);
    if (filter.from) rows = rows.filter((a) => new Date(a.created_at) >= filter.from!);
    if (filter.to) rows = rows.filter((a) => new Date(a.created_at) < filter.to!);
    rows.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    return rows.slice(0, filter.limit ?? 200).map((a) => ({ ...clone(a), lead: this.leadRef(a.lead_id) }));
  }

  // ---------- Anrufe ----------
  demoUpsertCall(row: Partial<Call> & { id: ID }): Call {
    let call = this.db.calls.find((c) => c.id === row.id);
    if (!call) {
      call = {
        id: row.id,
        lead_id: null,
        contact_id: null,
        user_id: this.me?.id ?? null,
        direction: 'outbound',
        from_number: this.db.org.default_caller_id,
        to_number: null,
        status: 'initiated',
        outcome: null,
        note: null,
        started_at: nowIso(),
        answered_at: null,
        ended_at: null,
        duration: 0,
        conference_name: null,
        recording_status: 'none',
        recording_path: null,
        recording_duration: null,
        extra_recordings: [],
        talk_agent_ms: null,
        talk_customer_ms: null,
        quality: null,
        transcript_status: 'none',
        monitors: [],
        is_voicemail: false,
        voicemail_drop_id: null,
        dialer_session: null,
        created_at: nowIso(),
      };
      this.db.calls.push(call);
    }
    const prevOutcome = call.outcome;
    Object.assign(call, row);
    // Demo-Aufnahme: passendes Beispielgespräch zum Ergebnis auswählen
    if (call.recording_path?.startsWith('demo/live/') && !this.db.callScripts[call.id]) this.assignScript(call);
    if (call.lead_id) this.recompute(call.lead_id);
    if (row.outcome !== undefined && row.outcome !== prevOutcome) this.afterOutcome(call);
    this.persist();
    this.emit('calls', call as unknown as Record<string, unknown>);
    return clone(call);
  }

  private assignScript(call: Call) {
    const key = call.outcome === 'setting_gelegt' ? 'setting_kg' : call.outcome === 'entscheider_gesprochen' ? 'eg_zeit' : 'gatekeeper';
    this.db.callScripts[call.id] = { key, seed: Math.floor(Math.random() * 10000) };
    const built = buildScript(key, this.scriptNames(call), this.db.callScripts[call.id].seed);
    call.recording_duration = Math.round(built.durationMs / 1000);
    call.recording_channels = 2;
    call.agent_channel = 1;
    call.recording_format = 'wav';
    call.transcript_status = this.db.org.transcription_enabled ? 'ready' : 'none';
    call.talk_agent_ms = built.segments.filter((x) => x.speaker === 'agent').reduce((a, x) => a + x.end - x.start, 0);
    call.talk_customer_ms = built.segments.filter((x) => x.speaker === 'customer').reduce((a, x) => a + x.end - x.start, 0);
  }

  private afterOutcome(call: Call) {
    // Demo-Aufnahme passend zum Ergebnis, solange sie noch nicht abgespielt wurde
    if (call.recording_path?.startsWith('demo/live/') && !this.recordingCache.has(call.id)) {
      this.assignScript(call);
      this.audioCache.delete(`recordings/${call.recording_path}`);
    }
    const outcome = this.db.outcomes.find((o) => o.key === call.outcome);
    if (outcome?.is_meeting && call.lead_id) {
      const lead = this.db.leads.find((l) => l.id === call.lead_id);
      if (lead && !lead.opener_id) lead.opener_id = call.user_id;
    }
    if (call.lead_id && call.outcome) {
      this.workflowEvent(call.lead_id, 'outcome', call.outcome);
      this.workflowEvent(call.lead_id, 'call_outcome', call.outcome);
    }
  }

  async finalizeCall(callId: ID, patch: { outcome?: string | null; note?: string | null; lead_id?: ID | null; contact_id?: ID | null }) {
    await wait();
    const call = this.db.calls.find((c) => c.id === callId);
    if (!call) {
      this.demoUpsertCall({ id: callId, status: 'failed', ...patch });
    } else {
      this.demoUpsertCall({ id: callId, ...patch });
    }
    this.persist();
  }

  async logManualCall(input: { lead_id: ID; contact_id?: ID | null; direction: 'outbound' | 'inbound'; outcome: string | null; note: string | null; duration: number; started_at?: string }) {
    this.require('calling', 'Keine Berechtigung zum Telefonieren.');
    const call = this.demoUpsertCall({
      id: uuid(),
      lead_id: input.lead_id,
      contact_id: input.contact_id ?? null,
      direction: input.direction,
      note: input.note,
      duration: input.duration,
      status: 'completed',
      started_at: input.started_at ?? nowIso(),
      ended_at: nowIso(),
      user_id: this.user().id,
    });
    await this.finalizeCall(call.id, { outcome: input.outcome });
    return call;
  }

  private callVisible(c: Call) {
    return c.user_id === this.me?.id || this.canSeeLeadId(c.lead_id);
  }

  async getCall(id: ID) {
    const c = this.db.calls.find((x) => x.id === id);
    return c && this.callVisible(c) ? { ...clone(c), lead: this.leadRef(c.lead_id) } : null;
  }

  async listCalls(filter: CallFilter, page: Page) {
    await wait();
    let rows = this.db.calls.filter((c) => this.callVisible(c));
    if (filter.userId) rows = rows.filter((c) => c.user_id === filter.userId);
    if (filter.userIds?.length) rows = rows.filter((c) => c.user_id && filter.userIds!.includes(c.user_id));
    if (filter.direction) rows = rows.filter((c) => c.direction === filter.direction);
    if (filter.outcome) rows = rows.filter((c) => c.outcome === filter.outcome);
    if (filter.withRecording) rows = rows.filter((c) => !!c.recording_path);
    if (filter.withTranscript) rows = rows.filter((c) => c.transcript_status === 'ready');
    if (filter.minDuration) rows = rows.filter((c) => c.duration >= filter.minDuration!);
    if (filter.leadId) rows = rows.filter((c) => c.lead_id === filter.leadId);
    if (filter.from) rows = rows.filter((c) => new Date(c.started_at) >= filter.from!);
    if (filter.to) rows = rows.filter((c) => new Date(c.started_at) < filter.to!);
    const term = (filter.q ?? '').trim().toLowerCase();
    if (term) {
      rows = rows.filter((c) => {
        const s = this.db.callScripts[c.id];
        if (!s || !c.recording_path || !this.canListen(c)) return false;
        return buildScript(s.key, this.scriptNames(c), s.seed).segments.some((x) => x.text.toLowerCase().includes(term));
      });
    }
    rows.sort((a, b) => (a.started_at < b.started_at ? 1 : -1));
    const out = rows.slice(page.offset, page.offset + page.limit).map((c) => ({ ...clone(c), lead: this.leadRef(c.lead_id) }));
    return { rows: out, total: rows.length };
  }

  async recordingUrl(path: string) {
    return this.audioUrl('recordings', path);
  }

  private canListen(c: Call) {
    return c.user_id === this.me?.id || c.is_voicemail || this.has('recordings_listen_all');
  }

  private scriptNames(call: Call) {
    const agent = this.db.profiles.find((p) => p.id === call.user_id)?.full_name.split(' ')[0] ?? 'Mia';
    const contact = this.db.contacts.find((c) => c.id === call.contact_id);
    const lead = this.db.leads.find((l) => l.id === call.lead_id);
    const last = (contact?.name ?? '').replace(/^(Dr\.|Prof\.)\s+/, '').split(' ').slice(1).join(' ');
    const salutation = lead?.custom?.geschlecht === 'Mann' ? 'Herr' : 'Frau';
    return { agent, kunde: last ? `${salutation} ${last}` : 'dem Inhaber' };
  }

  private recordingFor(call: Call): DemoRecording | null {
    const s = this.db.callScripts[call.id];
    if (!s) return null;
    const hit = this.recordingCache.get(call.id);
    if (hit) return hit;
    const rec = demoDialogRecording(s.key, this.scriptNames(call), s.seed);
    this.recordingCache.set(call.id, rec);
    return rec;
  }

  async getCallInsights(callId: ID): Promise<CallInsights | null> {
    const call = this.db.calls.find((c) => c.id === callId);
    if (!call || !this.callVisible(call) || !this.canListen(call) || !call.recording_path) return null;
    const s = this.db.callScripts[callId];
    if (!s) {
      // Mailbox-Nachricht o. Ä.: Mono-Aufnahme, nur Wellenform
      const samples = demoRecordingSamples(9, this.pathSeed(call.recording_path) + 1);
      return { call_id: callId, peaks: analyzeMono(samples, 8000), talk: null, segments: null, transcript_text: null, summary: null, language: 'de', error: null, updated_at: call.started_at };
    }
    await wait(60);
    const rec = this.recordingFor(call)!;
    const script = DEMO_SCRIPTS.find((x) => x.key === s.key)!;
    const ready = call.transcript_status === 'ready';
    // „Spuren tauschen“ simulieren: in der Demo liegt unsere Stimme eigentlich auf Spur 1
    const swapped = call.agent_channel === 2;
    const peaks = swapped && rec.peaks ? { ...rec.peaks, agent: rec.peaks.customer, customer: rec.peaks.agent } : rec.peaks;
    const talk = swapped && rec.talk ? { ...rec.talk, agent_ms: rec.talk.customer_ms, customer_ms: rec.talk.agent_ms, longest_customer_ms: undefined } : rec.talk;
    const segments = swapped ? rec.built.segments.map((x) => ({ ...x, speaker: x.speaker === 'agent' ? 'customer' as const : 'agent' as const })) : rec.built.segments;
    return {
      call_id: callId,
      peaks,
      talk,
      segments: ready ? segments : null,
      transcript_text: ready ? rec.built.segments.map((x) => x.text).join('\n') : null,
      summary: ready && this.db.org.summary_enabled ? script.summary : null,
      language: 'de',
      error: null,
      updated_at: call.ended_at ?? call.started_at,
    };
  }

  async requestTranscript(callId: ID) {
    this.require('use_ai', 'Keine Berechtigung für KI-Funktionen.');
    const call = this.db.calls.find((c) => c.id === callId);
    if (!call || !this.db.callScripts[callId]) throw new Error('Zu diesem Anruf gibt es keine Aufnahme.');
    call.transcript_status = 'processing';
    this.emit('calls', call as unknown as Record<string, unknown>);
    await wait(1800);
    call.transcript_status = 'ready';
    this.persist();
    this.emit('calls', call as unknown as Record<string, unknown>);
    this.emit('call_insights', { call_id: callId });
  }

  async deleteRecording(callId: ID) {
    const c = this.db.calls.find((x) => x.id === callId);
    if (!c || !this.canListen(c)) throw new Error('Aufnahme nicht gefunden.');
    if (!(this.has('recordings_delete') || (c.user_id === this.me?.id && this.has('delete_own_activities')))) {
      throw new Error('Keine Berechtigung zum Löschen von Aufnahmen.');
    }
    Object.assign(c, { recording_status: 'deleted', recording_path: null, extra_recordings: [], transcript_status: 'none', talk_agent_ms: null, talk_customer_ms: null });
    delete this.db.callScripts[callId];
    this.recordingCache.delete(callId);
    if (c.lead_id) this.event(c.lead_id, 'recording_deleted', { call_id: c.id });
    this.persist();
    this.emit('calls', c as unknown as Record<string, unknown>);
  }

  async swapRecordingChannels(callId: ID) {
    const c = this.db.calls.find((x) => x.id === callId);
    if (!c || !this.canListen(c)) throw new Error('Aufnahme nicht gefunden.');
    if ((c.recording_channels ?? 1) < 2) throw new Error('Diese Aufnahme hat nur eine Spur.');
    if (c.user_id !== this.me?.id && !this.has('manage_others_activities')) {
      throw new Error('Nur wer telefoniert hat (oder fremde Aktivitäten bearbeiten darf), kann die Spuren tauschen.');
    }
    Object.assign(c, { agent_channel: c.agent_channel === 2 ? 1 : 2, talk_agent_ms: c.talk_customer_ms, talk_customer_ms: c.talk_agent_ms });
    this.persist();
    this.emit('calls', c as unknown as Record<string, unknown>);
    this.emit('call_insights', { call_id: callId });
  }

  // wie call-control „recording_retry“: sofort „wird gespeichert“, kurz danach fertig
  async retryRecording(callId: ID) {
    const c = this.db.calls.find((x) => x.id === callId);
    if (!c || !this.canListen(c)) throw new Error('Du darfst diese Aufnahme nicht anhören.');
    if (c.recording_path) return;
    Object.assign(c, { recording_status: 'processing', recording_error: null, recording_tried_at: new Date().toISOString() });
    this.persist();
    this.emit('calls', c as unknown as Record<string, unknown>);
    const script = this.db.callScripts[callId];
    void wait(1600).then(() => {
      if (script) {
        const built = buildScript(script.key, this.scriptNames(c), script.seed);
        const talk = (who: 'agent' | 'customer') => built.segments.filter((x) => x.speaker === who).reduce((a, x) => a + x.end - x.start, 0);
        Object.assign(c, {
          recording_status: 'ready',
          recording_path: `demo/${script.key}/${callId}.wav`,
          recording_attempts: 1,
          transcript_status: 'ready',
          talk_agent_ms: talk('agent'),
          talk_customer_ms: talk('customer'),
        });
      } else {
        Object.assign(c, { recording_status: 'failed', recording_error: 'Die Aufnahme ist bei Twilio nicht mehr vorhanden.' });
      }
      this.persist();
      this.emit('calls', c as unknown as Record<string, unknown>);
      this.emit('call_insights', { call_id: callId });
    });
  }

  async saveCallQuality(callId: ID, quality: CallQuality) {
    const c = this.db.calls.find((x) => x.id === callId);
    if (c) {
      c.quality = quality;
      this.persist();
    }
  }

  async liveCalls(): Promise<LiveCall[]> {
    const me = this.user();
    const canCoach = this.has('call_coach_listen') || this.has('call_coach_barge');
    const rows: LiveCall[] = this.db.calls
      .filter((c) => !c.ended_at && (c.status === 'ringing' || c.status === 'in-progress') && (c.user_id === me.id || canCoach))
      .map((c) => ({ call_id: c.id, user_id: c.user_id, lead_id: c.lead_id, lead_name: this.leadName(c.lead_id) || null, direction: c.direction, status: c.status, started_at: c.started_at, answered_at: c.answered_at, to_number: c.to_number, from_number: c.from_number, conference: !!c.conference_name }));
    if (canCoach) {
      // Simulierte Gespräche der Kollegen, damit Mithören/Einflüstern ausprobiert werden kann
      const t = Date.now();
      const sample = this.visibleLeads().filter((l) => l.status_id && l.owner_id && l.owner_id !== me.id).slice(0, 2);
      sample.forEach((l, i) => {
        const contact = this.db.contacts.find((c) => c.lead_id === l.id);
        rows.push({
          call_id: `live-demo-${i}`, user_id: [DEMO_USERS.mia, DEMO_USERS.jonas][i], lead_id: l.id, lead_name: l.name, direction: 'outbound', status: 'in-progress',
          started_at: new Date(t - (95 + i * 140) * 1000).toISOString(), answered_at: new Date(t - (80 + i * 140) * 1000).toISOString(),
          to_number: contact?.phones[0]?.number ?? null, from_number: this.db.org.default_caller_id, conference: true,
        });
      });
    }
    return rows;
  }

  // Ton für „Mithören“ im Demo-Modus: ein Beispielgespräch, ab der bisherigen Gesprächsdauer
  async demoLiveAudio(callId: ID): Promise<{ url: string; offset: number }> {
    const live = (await this.liveCalls()).find((c) => c.call_id === callId);
    const agent = this.db.profiles.find((p) => p.id === live?.user_id)?.full_name.split(' ')[0] ?? 'Mia';
    const key = callId.endsWith('1') ? 'eg_agentur' : 'setting_mg';
    const rec = demoDialogRecording(key, { agent, kunde: 'Frau Becker' }, callId.length * 13);
    const since = live?.answered_at ? (Date.now() - new Date(live.answered_at).getTime()) / 1000 : 0;
    return { url: await blobToDataUrl(rec.wav), offset: Math.max(0, since % 40) };
  }

  // ---------- Aufgaben ----------
  async listTasks(filter: TaskFilter) {
    await wait();
    const me = this.user();
    let rows = this.db.tasks.filter((t) => t.assigned_to === me.id || t.created_by === me.id || this.canSeeLeadId(t.lead_id));
    if (filter.assignedTo === 'team') rows = rows.filter((t) => !t.assigned_to);
    else if (filter.assignedTo && filter.assignedTo !== 'all') rows = rows.filter((t) => t.assigned_to === filter.assignedTo);
    else if (!filter.assignedTo && !filter.leadId) rows = rows.filter((t) => t.assigned_to === me.id);
    if (filter.done !== undefined) rows = rows.filter((t) => t.done === filter.done);
    if (filter.leadId) rows = rows.filter((t) => t.lead_id === filter.leadId);
    if (filter.dueBefore) rows = rows.filter((t) => !t.due_at || new Date(t.due_at) <= filter.dueBefore!);
    if (filter.dueAfter) rows = rows.filter((t) => !!t.due_at && new Date(t.due_at) > filter.dueAfter!);
    if (filter.types?.length) rows = rows.filter((t) => filter.types!.includes(t.type));
    rows.sort((a, b) => (a.due_at ?? '9999').localeCompare(b.due_at ?? '9999'));
    return rows.map((t) => ({ ...clone(t), lead: this.leadRef(t.lead_id) }));
  }

  private canEditTask(t: Task) {
    const me = this.user().id;
    return t.assigned_to === me || t.created_by === me || !t.assigned_to || this.has('manage_others_tasks');
  }

  async saveTask(task: Partial<Task> & { title: string }) {
    await wait();
    let t = task.id ? this.db.tasks.find((x) => x.id === task.id) : undefined;
    if (t) {
      if (!this.canEditTask(t)) throw new Error('Nur eigene Aufgaben können geändert werden.');
      Object.assign(t, clone(task));
    } else {
      t = {
        id: uuid(),
        lead_id: task.lead_id ?? null,
        contact_id: task.contact_id ?? null,
        assigned_to: task.assigned_to === undefined ? this.user().id : task.assigned_to,
        created_by: this.user().id,
        type: task.type ?? 'todo',
        title: task.title,
        note: task.note ?? null,
        due_at: task.due_at ?? null,
        done: false,
        done_at: null,
        done_by: null,
        call_id: task.call_id ?? null,
        created_at: nowIso(),
      };
      this.db.tasks.push(t);
      if (t.assigned_to && t.assigned_to !== this.me?.id) this.notify(t.assigned_to, 'assigned', t.lead_id, 'task', t.id, `Neue Aufgabe: ${t.title}`, t.lead_id ? this.leadName(t.lead_id) : '');
    }
    if (t.lead_id) this.recompute(t.lead_id);
    this.persist();
    this.emit('tasks', t as unknown as Record<string, unknown>);
    return clone(t);
  }

  async setTaskDone(id: ID, done: boolean) {
    const t = this.db.tasks.find((x) => x.id === id);
    if (!t) return;
    if (!this.canEditTask(t)) throw new Error('Nur eigene Aufgaben können erledigt werden.');
    t.done = done;
    t.done_at = done ? nowIso() : null;
    t.done_by = done ? this.user().id : null;
    if (t.lead_id) this.recompute(t.lead_id);
    this.persist();
    this.emit('tasks', t as unknown as Record<string, unknown>);
  }

  async deleteTask(id: ID) {
    const t = this.db.tasks.find((x) => x.id === id);
    if (t) {
      const me = this.user().id;
      const own = t.assigned_to === me || t.created_by === me;
      if (!((own && this.has('delete_own_tasks')) || this.has('manage_others_tasks'))) throw new Error('Keine Berechtigung zum Löschen.');
    }
    this.db.tasks = this.db.tasks.filter((x) => x.id !== id);
    if (t?.lead_id) this.recompute(t.lead_id);
    this.persist();
    this.emit('tasks', {});
  }

  // ---------- Inbox ----------
  async listNotifications(filter: NotificationFilter) {
    await wait();
    const me = this.user();
    const userId = filter.userId ?? me.id;
    if (userId !== me.id && !this.has('view_others_inbox')) throw new Error('Keine Berechtigung für die Inbox anderer.');
    const now = Date.now();
    let rows = this.db.notifications.filter((n) => n.user_id === userId);
    if (filter.box === 'done') rows = rows.filter((n) => n.done_at).sort((a, b) => (a.done_at! < b.done_at! ? 1 : -1));
    else if (filter.box === 'later') rows = rows.filter((n) => !n.done_at && n.snoozed_until && new Date(n.snoozed_until).getTime() > now).sort((a, b) => (a.snoozed_until! < b.snoozed_until! ? -1 : 1));
    else rows = rows.filter((n) => !n.done_at && (!n.snoozed_until || new Date(n.snoozed_until).getTime() <= now)).sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    return rows.slice(0, filter.limit ?? 200).map((n) => ({ ...clone(n), lead: this.leadRef(n.lead_id) }));
  }

  async updateNotifications(ids: ID[], patch: { read?: boolean; done?: boolean; snoozed_until?: string | null }) {
    const set = new Set(ids);
    const now = nowIso();
    for (const n of this.db.notifications) {
      if (!set.has(n.id) || n.user_id !== this.me?.id) continue;
      if (patch.read !== undefined) n.read_at = patch.read ? now : null;
      if (patch.done !== undefined) {
        n.done_at = patch.done ? now : null;
        if (patch.done) n.read_at = now;
      }
      if (patch.snoozed_until !== undefined) n.snoozed_until = patch.snoozed_until;
    }
    this.persist();
    this.emit('notifications', {});
  }

  async inboxCounts(userId?: ID) {
    const me = this.user();
    const uid = userId ?? me.id;
    const now = Date.now();
    return {
      tasks_due: this.db.tasks.filter((t) => !t.done && t.assigned_to === uid && (!t.due_at || new Date(t.due_at).getTime() <= now)).length,
      notifications_new: this.db.notifications.filter((n) => n.user_id === uid && !n.done_at && !n.read_at && (!n.snoozed_until || new Date(n.snoozed_until).getTime() <= now)).length,
    };
  }

  // ---------- Termine ----------
  async listMeetings(filter: MeetingFilter) {
    await wait();
    const me = this.user().id;
    let rows = this.db.meetings.filter((m) => {
      const t = new Date(m.starts_at);
      return t >= filter.from && t < filter.to && (m.host_user_id === me || m.set_by === me || this.canSeeLeadId(m.lead_id));
    });
    if (!filter.includeCanceled) rows = rows.filter((m) => m.status !== 'canceled' && m.status !== 'rescheduled');
    if (filter.userId) rows = rows.filter((m) => m.host_user_id === filter.userId || m.set_by === filter.userId);
    if (filter.leadId) rows = rows.filter((m) => m.lead_id === filter.leadId);
    rows.sort((a, b) => (a.starts_at < b.starts_at ? -1 : 1));
    return rows.map((m) => ({ ...clone(m), lead: this.leadRef(m.lead_id) }));
  }

  async saveMeeting(meeting: Partial<Meeting> & { starts_at: string; title: string }) {
    await wait();
    let m = meeting.id ? this.db.meetings.find((x) => x.id === meeting.id) : undefined;
    const isNew = !m;
    if (m) Object.assign(m, clone(meeting));
    else {
      m = {
        id: uuid(),
        lead_id: meeting.lead_id ?? null,
        contact_id: meeting.contact_id ?? null,
        source: meeting.source ?? 'crm',
        external_id: meeting.external_id ?? uuid(),
        calendar_id: null,
        title: meeting.title,
        description: meeting.description ?? null,
        location: meeting.location ?? null,
        join_url: meeting.join_url ?? null,
        starts_at: meeting.starts_at,
        ends_at: meeting.ends_at ?? null,
        host_user_id: meeting.host_user_id ?? null,
        host_email: null,
        host_name: null,
        set_by: meeting.set_by ?? this.user().id,
        invitee_name: meeting.invitee_name ?? null,
        invitee_email: meeting.invitee_email ?? null,
        invitee_phone: null,
        status: 'scheduled',
        outcome_note: null,
        created_at: nowIso(),
      };
      this.db.meetings.push(m);
    }
    if (m.lead_id) {
      const lead = this.db.leads.find((l) => l.id === m!.lead_id);
      if (lead && m.set_by && !lead.opener_id) lead.opener_id = m.set_by;
      if (lead && isNew && this.db.org.meeting_status_id && lead.status_id !== this.db.org.meeting_status_id) {
        const kind = this.db.statuses.find((s) => s.id === lead.status_id)?.kind;
        if (kind !== 'won') this.applyLeadPatch(lead, { status_id: this.db.org.meeting_status_id });
      }
      if (isNew) {
        this.workflowEvent(m.lead_id, 'meeting', null);
        this.workflowEvent(m.lead_id, 'meeting_booked', null);
      }
      this.recompute(m.lead_id);
    }
    this.persist();
    this.emit('meetings', m as unknown as Record<string, unknown>);
    return clone(m);
  }

  async setMeetingStatus(id: ID, status: Meeting['status'], note?: string | null) {
    const m = this.db.meetings.find((x) => x.id === id);
    if (!m) return;
    m.status = status;
    if (note !== undefined) m.outcome_note = note;
    if (m.lead_id) this.recompute(m.lead_id);
    this.persist();
    this.emit('meetings', m as unknown as Record<string, unknown>);
  }

  async createCalendarEvent(input: { leadId: ID; contactId?: ID | null; title: string; start: string; end: string; description?: string; hostUserId?: ID | null; location?: string | null }) {
    const host = this.db.profiles.find((p) => p.id === input.hostUserId);
    const m = await this.saveMeeting({
      lead_id: input.leadId,
      contact_id: input.contactId ?? null,
      source: 'google',
      title: input.title,
      description: input.description ?? null,
      starts_at: input.start,
      ends_at: input.end,
      host_user_id: host?.id ?? null,
      location: input.location ?? null,
      set_by: this.user().id,
    });
    return { meetingId: m.id, htmlLink: null };
  }

  async syncCalendars() {
    await wait(600);
    this.db.org.gcal_last_sync = nowIso();
    this.persist();
    return { ok: true, upserted: 0, unchanged: this.db.meetings.length, errors: [] };
  }

  async scheduleJobs() {
    this.require('manage_organization', 'Nur für Admins.');
    await wait(300);
  }

  async jobsState(): Promise<JobsState | null> {
    return this.has('manage_organization') ? { scheduled: true, lastRun: new Date(Date.now() - 20_000).toISOString() } : null;
  }

  // ---------- Pipeline ----------
  async listOpportunities(filter: OpportunityFilter = {}) {
    await wait();
    let rows = this.db.opportunities.filter((o) => this.canSeeLeadId(o.lead_id));
    if (filter.leadId) rows = rows.filter((o) => o.lead_id === filter.leadId);
    if (filter.userId) rows = rows.filter((o) => o.user_id === filter.userId);
    if (filter.pipelineId) {
      const ids = new Set(this.db.oppStatuses.filter((s) => s.pipeline_id === filter.pipelineId).map((s) => s.id));
      rows = rows.filter((o) => o.status_id && ids.has(o.status_id));
    }
    if (filter.statusIds?.length) rows = rows.filter((o) => o.status_id && filter.statusIds!.includes(o.status_id));
    if (filter.open) {
      const open = new Set(this.db.oppStatuses.filter((s) => s.kind === 'open').map((s) => s.id));
      rows = rows.filter((o) => o.status_id && open.has(o.status_id));
    }
    rows.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    return rows.map((o) => ({ ...clone(o), lead: this.leadRef(o.lead_id) }));
  }

  async saveOpportunity(o: Partial<Opportunity> & { lead_id: ID }) {
    await wait();
    if (!this.canSeeLeadId(o.lead_id)) throw new Error('Lead nicht gefunden.');
    const now = nowIso();
    let opp = o.id ? this.db.opportunities.find((x) => x.id === o.id) : undefined;
    const kindOf = (id: ID | null | undefined) => this.db.oppStatuses.find((s) => s.id === id)?.kind ?? 'open';
    if (opp) {
      if (opp.user_id && opp.user_id !== this.me?.id && !this.has('manage_others_opportunities')) throw new Error('Nur eigene Opportunities können geändert werden.');
      const statusChanged = o.status_id !== undefined && o.status_id !== opp.status_id;
      if (statusChanged) {
        this.db.events.push({ id: uuid(), lead_id: opp.lead_id, user_id: this.user().id, type: 'opportunity_status', data: { opportunity_id: opp.id, from: opp.status_id, to: o.status_id, value: o.value ?? opp.value, value_period: opp.value_period }, created_at: now });
      }
      Object.assign(opp, clone(o), { updated_at: now });
      if (statusChanged) {
        opp.closed_at = kindOf(opp.status_id) === 'open' ? null : now;
        this.workflowEvent(opp.lead_id, 'opportunity_status', opp.status_id);
      }
    } else {
      const owner = o.user_id ?? this.user().id;
      if (owner !== this.me?.id && !this.has('manage_others_opportunities')) throw new Error('Keine Berechtigung, Opportunities für andere anzulegen.');
      opp = {
        id: uuid(),
        lead_id: o.lead_id,
        contact_id: o.contact_id ?? null,
        user_id: owner,
        status_id: o.status_id ?? this.db.oppStatuses[0]?.id ?? null,
        value: o.value ?? 0,
        value_period: o.value_period ?? 'one_time',
        confidence: o.confidence ?? 50,
        expected_close: o.expected_close ?? null,
        note: o.note ?? null,
        custom: o.custom ?? {},
        closed_at: null,
        created_at: now,
        updated_at: now,
      };
      if (kindOf(opp.status_id) !== 'open') opp.closed_at = now;
      this.db.opportunities.push(opp);
      this.db.events.push({ id: uuid(), lead_id: opp.lead_id, user_id: this.user().id, type: 'opportunity_created', data: { opportunity_id: opp.id, status_id: opp.status_id, value: opp.value, value_period: opp.value_period }, created_at: now });
      this.workflowEvent(opp.lead_id, 'opportunity_status', opp.status_id);
    }
    this.persist();
    return clone(opp);
  }

  async deleteOpportunity(id: ID) {
    const o = this.db.opportunities.find((x) => x.id === id);
    if (o) {
      const own = o.user_id === this.me?.id;
      if (!((own && this.has('delete_own_opportunities')) || this.has('manage_others_opportunities'))) throw new Error('Keine Berechtigung zum Löschen.');
    }
    this.db.opportunities = this.db.opportunities.filter((x) => x.id !== id);
    this.persist();
  }

  // ---------- Smart Views ----------
  async saveSmartView(v: Partial<SmartView> & { name: string; filters: FilterSet; sort: SortSpec }) {
    const me = this.user().id;
    let view = v.id ? this.db.smartViews.find((x) => x.id === v.id) : undefined;
    const team = this.has('manage_team_smart_views');
    if (view && view.created_by !== me && !team) throw new Error('Keine Berechtigung für geteilte Smart Views anderer.');
    if (v.shared && !team && (!view || !view.shared)) throw new Error('Für das ganze Team freigeben darf nur, wer das Recht dazu hat.');
    if (view) Object.assign(view, clone(v));
    else {
      view = {
        id: uuid(),
        name: v.name,
        description: v.description ?? '',
        kind: 'lead',
        filters: clone(v.filters),
        sort: clone(v.sort),
        columns: v.columns ?? [],
        shared: v.shared ?? false,
        pinned: v.pinned ?? false,
        position: v.position ?? (Math.max(0, ...this.db.smartViews.map((s) => s.position)) + 10),
        created_by: me,
        created_at: nowIso(),
      };
      this.db.smartViews.push(view);
    }
    this.persist();
    return clone(view);
  }

  async deleteSmartView(id: ID) {
    const view = this.db.smartViews.find((x) => x.id === id);
    if (view && view.created_by !== this.me?.id && !this.has('manage_team_smart_views')) throw new Error('Keine Berechtigung für geteilte Smart Views anderer.');
    this.db.smartViews = this.db.smartViews.filter((v) => v.id !== id);
    this.persist();
  }

  // ---------- Berichte ----------
  private outcomeMap() {
    return new Map(this.db.outcomes.map((o) => [o.key, o]));
  }

  private scope(users?: ID[] | null): Set<ID> | null {
    if (!this.has('view_team_reports')) return new Set([this.user().id]);
    return users?.length ? new Set(users) : null;
  }

  async reportActivity(from: Date, to: Date, users: ID[] | null = null): Promise<ActivityRow[]> {
    await wait();
    const scope = this.scope(users);
    const om = this.outcomeMap();
    const inRange = (iso: string | null | undefined) => !!iso && new Date(iso) >= from && new Date(iso) < to;
    const wonIds = new Set(this.db.oppStatuses.filter((s) => s.kind === 'won').map((s) => s.id));
    const won = this.db.opportunities.filter((o) => o.status_id && wonIds.has(o.status_id) && inRange(o.closed_at));
    return this.db.profiles
      .filter((p) => !scope || scope.has(p.id))
      .map((p) => {
        const calls = this.db.calls.filter((c) => c.user_id === p.id && inRange(c.started_at));
        const mine = won.filter((o) => o.user_id === p.id);
        return {
          user_id: p.id,
          dials: calls.filter((c) => c.direction === 'outbound').length,
          reached: calls.filter((c) => c.outcome && om.get(c.outcome)?.counts_as_connected).length,
          meetings_logged: calls.filter((c) => c.outcome && om.get(c.outcome)?.is_meeting).length,
          talk_seconds: calls.reduce((s, c) => s + (c.duration || 0), 0),
          inbound: calls.filter((c) => c.direction === 'inbound').length,
          meetings_booked: this.db.meetings.filter((m) => m.set_by === p.id && inRange(m.created_at) && m.status !== 'canceled').length,
          meetings_held: this.db.meetings.filter((m) => m.set_by === p.id && inRange(m.starts_at) && m.status === 'completed').length,
          notes: this.db.notes.filter((n) => n.user_id === p.id && inRange(n.created_at)).length,
          emails: this.db.emails.filter((e) => e.user_id === p.id && e.direction === 'outbound' && (e.status === 'sent' || e.status === 'logged') && inRange(e.created_at)).length,
          sms: this.db.sms.filter((e) => e.user_id === p.id && e.direction === 'outbound' && inRange(e.created_at)).length,
          forms: this.db.activities.filter((a) => a.user_id === p.id && a.status === 'published' && inRange(a.created_at)).length,
          tasks_done: this.db.tasks.filter((t) => t.done_by === p.id && inRange(t.done_at)).length,
          opps_created: this.db.opportunities.filter((o) => o.user_id === p.id && inRange(o.created_at)).length,
          deals_won: mine.length,
          won_value: mine.reduce((s, o) => s + o.value, 0),
          opened_won: won.filter((o) => this.db.leads.find((l) => l.id === o.lead_id)?.opener_id === p.id).length,
        };
      })
      .filter((r) => this.db.profiles.find((p) => p.id === r.user_id)?.active || r.dials > 0)
      .sort((a, b) => b.dials - a.dials);
  }

  private dayKey(t: Date) {
    return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
  }

  async reportDaily(from: Date, to: Date, userId: ID | null = null, users: ID[] | null = null): Promise<DailyRow[]> {
    const scope = this.scope(userId ? [userId] : users);
    const om = this.outcomeMap();
    const map = new Map<string, DailyRow>();
    for (const c of this.db.calls) {
      const t = new Date(c.started_at);
      if (t < from || t >= to) continue;
      if (scope && (!c.user_id || !scope.has(c.user_id))) continue;
      const day = this.dayKey(t);
      const row = map.get(day) ?? { day, dials: 0, reached: 0, meetings: 0, talk_seconds: 0 };
      if (c.direction === 'outbound') row.dials++;
      if (c.outcome && om.get(c.outcome)?.counts_as_connected) row.reached++;
      if (c.outcome && om.get(c.outcome)?.is_meeting) row.meetings++;
      row.talk_seconds += c.duration || 0;
      map.set(day, row);
    }
    return [...map.values()].sort((a, b) => a.day.localeCompare(b.day));
  }

  async reportOutcomes(from: Date, to: Date, userId: ID | null = null, users: ID[] | null = null): Promise<OutcomeRow[]> {
    const scope = this.scope(userId ? [userId] : users);
    const counts = new Map<string, number>();
    for (const c of this.db.calls) {
      const t = new Date(c.started_at);
      if (t < from || t >= to || c.direction !== 'outbound') continue;
      if (scope && (!c.user_id || !scope.has(c.user_id))) continue;
      const k = c.outcome ?? '_none';
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    return [...counts.entries()].map(([outcome, cnt]) => ({ outcome, cnt })).sort((a, b) => b.cnt - a.cnt);
  }

  async reportStatusCounts() {
    const counts = new Map<string | null, number>();
    for (const l of this.visibleLeads()) counts.set(l.status_id, (counts.get(l.status_id) ?? 0) + 1);
    return [...counts.entries()].map(([status_id, cnt]) => ({ status_id, cnt }));
  }

  async reportStatusChanges(from: Date, to: Date, users: ID[] | null = null): Promise<StatusChangeRow[]> {
    const scope = this.scope(users);
    const map = new Map<string, StatusChangeRow>();
    for (const e of this.db.events) {
      if (e.type !== 'status') continue;
      const t = new Date(e.created_at);
      if (t < from || t >= to) continue;
      if (scope && (!e.user_id || !scope.has(e.user_id))) continue;
      const k = `${e.data.from ?? ''}|${e.data.to ?? ''}`;
      const row = map.get(k) ?? { from_status: (e.data.from as string) ?? null, to_status: (e.data.to as string) ?? null, cnt: 0 };
      row.cnt++;
      map.set(k, row);
    }
    // Ohne aufgezeichnete Wechsel (frische Demo): aus dem aktuellen Stand ableiten
    if (!map.size) {
      for (const l of this.visibleLeads()) {
        if (!l.last_call_at || new Date(l.last_call_at) < from || new Date(l.last_call_at) >= to) continue;
        const s = this.db.statuses.find((x) => x.id === l.status_id);
        if (!s || s.is_default) continue;
        const def = this.db.statuses.find((x) => x.is_default)?.id ?? null;
        const k = `${def}|${s.id}`;
        const row = map.get(k) ?? { from_status: def, to_status: s.id, cnt: 0 };
        row.cnt++;
        map.set(k, row);
      }
    }
    return [...map.values()].sort((a, b) => b.cnt - a.cnt);
  }

  async reportFunnel(from: Date, to: Date, pipelineId: ID, users: ID[] | null = null): Promise<FunnelRow[]> {
    const scope = this.scope(users);
    const statuses = this.db.oppStatuses.filter((s) => s.pipeline_id === pipelineId).sort((a, b) => a.sort - b.sort);
    const ids = new Set(statuses.map((s) => s.id));
    const opps = this.db.opportunities.filter((o) => o.status_id && ids.has(o.status_id) && new Date(o.created_at) >= addDays(from, -30) && new Date(o.created_at) < to && (!scope || (o.user_id && scope.has(o.user_id))));
    return statuses.map((s, idx) => {
      // erreicht = aktuelle Stufe oder eine spätere (offene Reihenfolge), Verloren zählt nur sich selbst
      const reachedOpps = opps.filter((o) => {
        const cur = statuses.findIndex((x) => x.id === o.status_id);
        if (s.kind !== 'open') return o.status_id === s.id;
        return cur >= idx && statuses[cur].kind !== 'lost';
      });
      const current = opps.filter((o) => o.status_id === s.id);
      return {
        status_id: s.id,
        reached: reachedOpps.length,
        reached_value: reachedOpps.reduce((a, o) => a + o.value, 0),
        current_cnt: current.length,
        current_value: current.reduce((a, o) => a + o.value, 0),
      };
    });
  }

  async reportCallHours(from: Date, to: Date, users: ID[] | null = null): Promise<CallHourRow[]> {
    const scope = this.scope(users);
    const om = this.outcomeMap();
    const map = new Map<string, CallHourRow>();
    for (const c of this.db.calls) {
      if (c.direction !== 'outbound') continue;
      const t = new Date(c.started_at);
      if (t < from || t >= to) continue;
      if (scope && (!c.user_id || !scope.has(c.user_id))) continue;
      const dow = ((t.getDay() + 6) % 7) + 1;
      const k = `${dow}|${t.getHours()}`;
      const row = map.get(k) ?? { dow, hour: t.getHours(), dials: 0, reached: 0 };
      row.dials++;
      if (c.outcome && om.get(c.outcome)?.counts_as_connected) row.reached++;
      map.set(k, row);
    }
    return [...map.values()].sort((a, b) => a.dow - b.dow || a.hour - b.hour);
  }

  async reportFormValues(typeId: ID, field: string, from: Date, to: Date, users: ID[] | null = null): Promise<FormValueRow[]> {
    const scope = this.scope(users);
    const counts = new Map<string, number>();
    for (const a of this.db.activities) {
      if (a.type_id !== typeId || a.status !== 'published') continue;
      const t = new Date(a.created_at);
      if (t < from || t >= to) continue;
      if (scope && (!a.user_id || !scope.has(a.user_id))) continue;
      const v = a.data[field];
      const values = Array.isArray(v) ? v.map(String) : [v === undefined || v === null || v === '' ? '–' : String(v)];
      values.forEach((x) => counts.set(x, (counts.get(x) ?? 0) + 1));
    }
    return [...counts.entries()].map(([value, cnt]) => ({ value, cnt })).sort((a, b) => b.cnt - a.cnt);
  }

  // ---------- Einstellungen ----------
  async saveConfig<T extends ConfigTable>(table: T, row: Partial<ConfigRows[T]>, isNew = false): Promise<ConfigRows[T]> {
    await wait();
    const perm = CONFIG_PERMISSION[table];
    if (perm) this.require(perm, perm === 'manage_organization' ? 'Nur Admins dürfen das ändern.' : 'Keine Berechtigung für diese Einstellung.');
    const pk = CONFIG_KEYS[table];
    const list = this.db[CONFIG_COLLECTION[table]] as unknown as Record<string, unknown>[];
    const key = (row as Record<string, unknown>)[pk] as string | undefined;
    if (table === 'roles') {
      if (key === 'admin') throw new Error('Die Admin-Rolle hat immer alle Rechte und kann nicht geändert werden.');
      const perms = (row as Partial<ConfigRows['roles']>).permissions;
      if (perms) (row as Partial<ConfigRows['roles']>).permissions = [...new Set(perms)].sort();
    }
    if (table === 'email_templates') {
      const t = row as Partial<ConfigRows['email_templates']>;
      const existing = key ? (list.find((x) => x[pk] === key) as unknown as ConfigRows['email_templates'] | undefined) : undefined;
      const team = this.has('manage_team_templates');
      if (existing && existing.created_by !== this.me?.id && !team) throw new Error('Keine Berechtigung für geteilte Vorlagen anderer.');
      if (t.shared && !team && (!existing || !existing.shared)) throw new Error('Für das ganze Team freigeben darf nur, wer das Recht dazu hat.');
    }
    if (table === 'lead_statuses' && (row as Partial<ConfigRows['lead_statuses']>).is_default) {
      this.db.statuses.forEach((s) => (s.is_default = false));
    }
    const existing = !isNew && key ? list.find((x) => x[pk] === key) : undefined;
    let saved: Record<string, unknown>;
    if (existing) {
      Object.assign(existing, clone(row), table === 'roles' || table === 'activity_types' || table === 'workflows' ? { updated_at: nowIso() } : {});
      saved = existing;
    } else {
      if (key && list.some((x) => x[pk] === key)) throw new Error('Speichern: Gibt es schon.');
      saved = { ...this.configDefaults(table), ...clone(row) };
      if (!saved[pk]) saved[pk] = uuid();
      list.push(saved);
    }
    this.persist();
    return clone(saved) as unknown as ConfigRows[T];
  }

  private configDefaults(table: ConfigTable): Record<string, unknown> {
    const now = nowIso();
    switch (table) {
      case 'roles':
        return { description: '', is_builtin: false, permissions: [], lead_visibility: 'all', sort: 100, created_at: now, updated_at: now };
      case 'groups':
        return { color: '#5b6b7f', created_at: now };
      case 'lead_statuses':
        return { color: '#64748b', sort: (this.db.statuses.length + 1) * 10, kind: 'open', is_default: false };
      case 'call_outcomes':
        return { description: '', color: '#64748b', sort: (this.db.outcomes.length + 1) * 10, counts_as_connected: false, is_meeting: false, next_status_id: null, followup_days: null, active: true };
      case 'pipelines':
        return { sort: (this.db.pipelines.length + 1) * 10 };
      case 'opportunity_statuses':
        return { kind: 'open', color: '#64748b', sort: 100 };
      case 'custom_fields':
        return { entity: 'lead', description: '', type: 'text', choices: [], sort: 100, show_in_list: false, always_show: false, restricted: false };
      case 'activity_types':
        return { description: '', color: '#2346a0', fields: [], archived: false, sort: 100, created_at: now, updated_at: now };
      case 'integration_links':
        return { scope: 'lead', sort: 100 };
      case 'email_templates':
        return { kind: 'email', subject: '', body: '', is_html: false, shared: false, created_by: this.me?.id ?? null, created_at: now };
      case 'workflows':
        return {
          description: '', status: 'draft', trigger: { type: 'manual' }, steps: [], goal: { type: 'none' }, send_window: { days: [1, 2, 3, 4, 5], from: '08:00', to: '18:00' },
          allow_reenroll: false, stop_on_reply: true, sender_mode: 'owner', sender_user: null, created_by: this.me?.id ?? null, created_at: now, updated_at: now,
        };
      case 'phone_numbers':
        return {
          label: '', twilio_sid: null, sms_capable: false, members: [], group_id: null, ring_mode: 'simultaneous', ring_timeout: 25, route_to_owner: true, available_to_all: true,
          forward_to: null, forward_mode: 'never', business_hours: null, outside_hours_action: 'voicemail', greeting_text: null, greeting_path: null, ivr: null, record_inbound: null,
        };
      case 'smart_views':
        return { description: '', kind: 'lead', columns: [], shared: false, pinned: false, position: 100, created_by: this.me?.id ?? null, created_at: now };
    }
  }

  async deleteConfig(table: ConfigTable, key: string) {
    const perm = CONFIG_PERMISSION[table];
    if (perm) this.require(perm, 'Keine Berechtigung für diese Einstellung.');
    const pk = CONFIG_KEYS[table];
    if (table === 'roles') {
      const r = this.db.roles.find((x) => x.id === key);
      if (r?.is_builtin) throw new Error('Vordefinierte Rollen können nicht gelöscht werden.');
      if (this.db.profiles.some((p) => p.role_id === key)) throw new Error(`Die Rolle „${r?.name}“ ist noch Personen zugewiesen.`);
    }
    if (table === 'email_templates') {
      const t = this.db.templates.find((x) => x.id === key);
      if (t && t.created_by !== this.me?.id && !this.has('manage_team_templates')) throw new Error('Keine Berechtigung für geteilte Vorlagen anderer.');
    }
    if (table === 'activity_types' && this.db.activities.some((a) => a.type_id === key)) {
      throw new Error('Löschen: Wird noch verwendet. Aktivitäten mit Einträgen bitte archivieren.');
    }
    const coll = CONFIG_COLLECTION[table];
    (this.db[coll] as unknown as Record<string, unknown>[]) = (this.db[coll] as unknown as Record<string, unknown>[]).filter((x) => x[pk] !== key);
    if (table === 'lead_statuses') this.db.leads.forEach((l) => l.status_id === key && (l.status_id = null));
    if (table === 'groups') this.db.groupMembers = this.db.groupMembers.filter((m) => m.group_id !== key);
    if (table === 'pipelines') this.db.oppStatuses = this.db.oppStatuses.filter((s) => s.pipeline_id !== key);
    if (table === 'workflows') this.db.runs = this.db.runs.filter((r) => r.workflow_id !== key);
    this.persist();
  }

  async setGroupMembers(groupId: ID, userIds: ID[]) {
    this.require('manage_organization', 'Nur Admins dürfen Gruppen ändern.');
    this.db.groupMembers = [...this.db.groupMembers.filter((m) => m.group_id !== groupId), ...userIds.map((user_id) => ({ group_id: groupId, user_id }))];
    this.persist();
  }

  async updateOrg(patch: Partial<OrgSettings>) {
    const onlyCustom = Object.keys(patch).every((k) => k === 'call_script' || k === 'meeting_status_id');
    if (!(this.has('manage_organization') || (onlyCustom && this.has('manage_customizations')))) {
      throw new Error('Diese Einstellung darf nur ändern, wer die Organisation verwaltet.');
    }
    Object.assign(this.db.org, clone(patch));
    this.persist();
  }

  async updateMyProfile(patch: Partial<Pick<Profile, 'full_name' | 'settings' | 'color' | 'available' | 'forward_number' | 'forward_mode'>>) {
    const me = this.db.profiles.find((p) => p.id === this.user().id)!;
    const clean = clone(patch);
    if (clean.forward_number !== undefined) clean.forward_number = clean.forward_number ? normalizePhone(clean.forward_number) : null;
    Object.assign(me, clean);
    this.me = me;
    this.persist();
  }

  async uploadAttachment(file: File) {
    if (file.size > 15 * 1024 * 1024) throw new Error(`„${file.name}“ ist größer als 15 MB.`);
    const path = `${this.user().id}/${uuid()}-${file.name}`;
    this.audioCache.set(`attachments/${path}`, await blobToDataUrl(file));
    return { name: file.name, size: file.size, path };
  }

  async attachmentUrl(path: string) {
    const hit = this.audioCache.get(`attachments/${path}`);
    if (!hit) throw new Error('Anhang nur in dieser Sitzung verfügbar (Demo).');
    return hit;
  }

  async heartbeat() {
    const me = this.db.profiles.find((p) => p.id === this.me?.id);
    if (me) me.last_seen_at = nowIso();
  }

  async teamPresence() {
    // Demo: Kollegen wirken „online“, Tom ist offline
    const t = Date.now();
    return this.db.profiles
      .filter((p) => p.active)
      .map((p) => ({
        id: p.id,
        available: p.id === DEMO_USERS.lea ? false : p.available,
        last_seen_at: p.id === this.me?.id ? nowIso() : p.id === DEMO_USERS.tom ? new Date(t - 3 * 3_600_000).toISOString() : new Date(t - 40_000).toISOString(),
      }));
  }

  async admin<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
    await wait(400);
    switch (action) {
      case 'status':
        return {
          functionsUrl: 'Demo',
          twilio: { connected: true, ready: true, account: { name: 'Demo-Konto', status: 'active', type: 'Full' }, voiceUrlOk: true, smsUrlOk: true },
          calendly: { connected: true, webhook: true, connectedAt: this.db.org.calendly_connected_at },
          google: { connected: true, email: 'crm@demo-projekt.iam.gserviceaccount.com', calendars: this.db.org.gcal_calendars, lastSync: this.db.org.gcal_last_sync, lastError: null },
          ai: { assemblyai: true, anthropic: true },
          close: { connected: false },
          jobs: { scheduled: true, lastRun: new Date(Date.now() - 35_000).toISOString(), healthy: true },
          recordings: {
            failed: this.db.calls.filter((c) => c.recording_status === 'failed' && Date.parse(c.started_at) > Date.now() - 7 * DAY).length,
          },
        } as T;
      case 'create_user': {
        this.require('manage_organization', 'Nur Admins dürfen Benutzer anlegen.');
        const email = String(payload.email ?? '').trim().toLowerCase();
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Bitte eine gültige E-Mail-Adresse eingeben.');
        if (this.db.profiles.some((p) => p.email === email)) throw new Error('Diese E-Mail-Adresse ist schon angelegt.');
        const roleId = String(payload.role_id ?? 'user');
        if (!this.db.roles.some((r) => r.id === roleId)) throw new Error('Unbekannte Rolle.');
        const p: Profile = {
          id: uuid(),
          email,
          full_name: String(payload.full_name || email.split('@')[0]),
          role_id: roleId,
          team_function: (payload.team_function as Profile['team_function']) ?? 'opener',
          phone_number: null,
          forward_number: null,
          forward_mode: 'never',
          available: true,
          active: true,
          color: String(payload.color ?? '#5b6b7f'),
          settings: {},
          last_seen_at: null,
          created_at: nowIso(),
        };
        this.db.profiles.push(p);
        for (const g of (payload.group_ids as string[] | undefined) ?? []) this.db.groupMembers.push({ group_id: g, user_id: p.id });
        this.persist();
        return { ok: true, id: p.id } as T;
      }
      case 'update_user': {
        this.require('manage_organization', 'Nur Admins dürfen Benutzer ändern.');
        const p = this.db.profiles.find((x) => x.id === payload.id);
        if (!p) throw new Error('Benutzer unbekannt.');
        const patch = { ...payload };
        delete patch.id;
        const losesAdmin = p.role_id === 'admin' && ((patch.role_id !== undefined && patch.role_id !== 'admin') || patch.active === false);
        if (losesAdmin && this.db.profiles.filter((x) => x.role_id === 'admin' && x.active && x.id !== p.id).length < 1) {
          throw new Error('Es muss mindestens ein aktiver Admin bleiben.');
        }
        if (patch.role_id !== undefined && !this.db.roles.some((r) => r.id === patch.role_id)) throw new Error('Unbekannte Rolle.');
        if (typeof patch.phone_number === 'string') patch.phone_number = normalizePhone(patch.phone_number);
        if (typeof patch.forward_number === 'string') patch.forward_number = normalizePhone(patch.forward_number);
        if (typeof patch.email === 'string') {
          const email = patch.email.trim().toLowerCase();
          if (this.db.profiles.some((x) => x.email === email && x.id !== p.id)) throw new Error('Diese E-Mail-Adresse ist schon vergeben.');
          patch.email = email;
        }
        Object.assign(p, patch);
        this.persist();
        return { ok: true } as T;
      }
      case 'delete_user': {
        this.require('manage_organization', 'Nur Admins dürfen Benutzer löschen.');
        const p = this.db.profiles.find((x) => x.id === payload.id);
        if (!p) throw new Error('Benutzer unbekannt.');
        if (p.id === this.me?.id) throw new Error('Du kannst dich nicht selbst löschen.');
        if (p.role_id === 'admin' && this.db.profiles.filter((x) => x.role_id === 'admin' && x.active && x.id !== p.id).length < 1) {
          throw new Error('Es muss mindestens ein aktiver Admin bleiben.');
        }
        const to = (payload.transfer_to as string | null) ?? null;
        this.db.leads.forEach((l) => l.owner_id === p.id && (l.owner_id = to));
        this.db.tasks.forEach((t) => !t.done && t.assigned_to === p.id && (t.assigned_to = to));
        this.db.profiles = this.db.profiles.filter((x) => x.id !== p.id);
        this.db.groupMembers = this.db.groupMembers.filter((m) => m.user_id !== p.id);
        this.persist();
        return { ok: true } as T;
      }
      case 'reset_password':
        this.require('manage_organization', 'Nur Admins dürfen Passwörter zurücksetzen.');
        return { ok: true } as T;
      case 'twilio_setup':
      case 'twilio_connect':
        return {
          ok: true,
          account: { name: 'Demo-Konto', status: 'active', type: 'Full' },
          numbers: this.db.numbers,
          callerIds: this.db.numbers.map((n) => ({ number: n.number, label: n.label, kind: 'twilio' })),
          warnings: ['Demo-Modus: Es wird nichts mit Twilio verbunden.'],
        } as T;
      case 'twilio_sync_numbers':
        return { ok: true, numbers: this.db.numbers } as T;
      case 'calendly_connect':
      case 'calendly_refresh':
        return { ok: true, links: this.db.org.calendly_links, user: { name: 'Demo', email: 'demo@calendly' } } as T;
      case 'google_connect':
        return { ok: true, email: 'crm@demo-projekt.iam.gserviceaccount.com' } as T;
      case 'google_add_calendar': {
        const id = String(payload.calendarId ?? '');
        this.db.org.gcal_calendars = [...this.db.org.gcal_calendars.filter((c) => c.id !== id), { id, label: String(payload.label || id) }];
        this.persist();
        return { ok: true, calendars: this.db.org.gcal_calendars } as T;
      }
      case 'google_remove_calendar':
        this.db.org.gcal_calendars = this.db.org.gcal_calendars.filter((c) => c.id !== payload.calendarId);
        this.persist();
        return { ok: true, calendars: this.db.org.gcal_calendars } as T;
      case 'ai_connect':
        return { ok: true } as T;
      case 'close_connect':
        return { ok: true, organization: 'Demo-Organisation', counts: { leads: 2840, contacts: 3120, opportunities: 96, activities: 18650 } } as T;
      case 'close_import':
        await wait(1200);
        return { ok: true, done: true, imported: { statuses: 6, pipelines: 2, fields: 16, activity_types: 3, templates: 2, smart_views: 24 }, warnings: ['Demo-Modus: Es werden keine Daten aus Close geladen.'] } as T;
      default:
        return { ok: true } as T;
    }
  }

  // ---------- Workflows ----------
  async listWorkflowRuns(filter: { workflowId?: ID; leadId?: ID; status?: WorkflowRun['status'][]; limit?: number }) {
    await wait();
    let rows = this.db.runs.filter((r) => this.canSeeLeadId(r.lead_id));
    if (filter.workflowId) rows = rows.filter((r) => r.workflow_id === filter.workflowId);
    if (filter.leadId) rows = rows.filter((r) => r.lead_id === filter.leadId);
    if (filter.status?.length) rows = rows.filter((r) => filter.status!.includes(r.status));
    rows.sort((a, b) => (a.started_at < b.started_at ? 1 : -1));
    return rows.slice(0, filter.limit ?? 300).map((r) => ({ ...clone(r), lead: this.leadRef(r.lead_id) }));
  }

  async enrollInWorkflow(workflowId: ID, leadIds: ID[], contactId: ID | null = null) {
    if (leadIds.length > 1 && !(this.has('bulk_workflow') || this.has('manage_workflows'))) {
      throw new Error('Keine Berechtigung, mehrere Leads gleichzeitig in einen Workflow aufzunehmen.');
    }
    const wf = this.db.workflows.find((w) => w.id === workflowId);
    if (!wf || wf.status !== 'active') throw new Error('Der Workflow ist nicht aktiv.');
    let n = 0;
    for (const id of leadIds) if (this.canSeeLeadId(id) && this.startRun(workflowId, id, contactId)) n++;
    this.persist();
    setTimeout(() => this.runDueWorkflows(), 500);
    return n;
  }

  async setWorkflowRunStatus(runId: ID, status: 'active' | 'paused' | 'canceled') {
    const r = this.db.runs.find((x) => x.id === runId);
    if (!r || !this.canSeeLeadId(r.lead_id)) throw new Error('Workflow-Lauf nicht gefunden.');
    if (r.status !== 'active' && r.status !== 'paused') throw new Error('Dieser Lauf ist schon beendet.');
    r.status = status;
    if (status === 'canceled') Object.assign(r, { ended_at: nowIso(), end_reason: 'Von Hand beendet' });
    if (status === 'active' && r.next_at && new Date(r.next_at).getTime() < Date.now()) r.next_at = nowIso();
    this.persist();
  }

  // ---------- E-Mail & SMS ----------
  async sendEmail(input: EmailSendInput) {
    await wait(500);
    if (!this.canSeeLeadId(input.lead_id)) throw new Error('Lead nicht gefunden.');
    const me = this.user();
    const account = this.db.emailAccounts.find((a) => a.user_id === me.id);
    const scheduled = input.send_at && new Date(input.send_at).getTime() > Date.now() + 60_000;
    const e: Email = {
      id: uuid(), lead_id: input.lead_id, contact_id: input.contact_id, user_id: me.id, account_id: account?.id ?? null, direction: 'outbound',
      status: scheduled ? 'scheduled' : 'sent', from_address: account?.email ?? me.email, to_address: input.to, cc: input.cc ?? null, bcc: input.bcc ?? null,
      subject: input.subject, body: input.body, is_html: input.is_html, attachments: input.attachments ?? [], template_id: input.template_id ?? null,
      send_at: scheduled ? input.send_at! : null, sent_at: scheduled ? null : nowIso(), opens: 0, created_at: nowIso(),
    };
    this.db.emails.push(e);
    this.recompute(input.lead_id);
    this.persist();
    this.emit('emails', e as unknown as Record<string, unknown>);
    return clone(e);
  }

  async bulkEmail(leadIds: ID[], templateId: ID, sendAt: string | null = null) {
    this.require('bulk_email', 'Keine Berechtigung für Sammel-E-Mails.');
    const tpl = this.db.templates.find((t) => t.id === templateId);
    if (!tpl) throw new Error('Vorlage nicht gefunden.');
    let queued = 0;
    let skipped = 0;
    for (const id of leadIds) {
      const lead = this.db.leads.find((l) => l.id === id);
      const contact = this.db.contacts.find((c) => c.lead_id === id && c.emails.length);
      if (!lead || !this.canSee(lead) || !contact) {
        skipped++;
        continue;
      }
      const vars = this.templateVars(lead, contact, this.user());
      await this.sendEmail({ lead_id: id, contact_id: contact.id, to: contact.emails[0].email, subject: fillTemplate(tpl.subject, vars), body: fillTemplate(tpl.body, vars), is_html: tpl.is_html, template_id: tpl.id, send_at: sendAt });
      queued++;
    }
    return { queued, skipped };
  }

  async sendSms(input: SmsSendInput) {
    this.require('calling', 'Keine Berechtigung zum Telefonieren und Schreiben.');
    await wait(400);
    const to = normalizePhone(input.to);
    if (!to) throw new Error('Die Nummer ist ungültig.');
    if (input.body.trim().length < 1) throw new Error('Bitte einen Text eingeben.');
    const me = this.user();
    const s: SmsMessage = {
      id: uuid(), lead_id: input.lead_id, contact_id: input.contact_id, user_id: me.id, direction: 'outbound',
      from_number: input.from ?? me.phone_number ?? this.db.org.default_caller_id, to_number: to, body: input.body,
      status: input.send_at ? 'scheduled' : 'delivered', send_at: input.send_at ?? null, error: null, created_at: nowIso(),
    };
    this.db.sms.push(s);
    if (s.lead_id) this.recompute(s.lead_id);
    this.persist();
    this.emit('sms_messages', s as unknown as Record<string, unknown>);
    // Demo: Antwort nach ein paar Sekunden
    if (s.lead_id) {
      setTimeout(() => {
        const reply: SmsMessage = { ...s, id: uuid(), user_id: null, direction: 'inbound', from_number: to, to_number: s.from_number, body: 'Danke für die Nachricht! Melde mich morgen.', status: 'received', created_at: nowIso() };
        this.db.sms.push(reply);
        this.workflowEvent(s.lead_id, 'replied', null);
        const owner = this.db.leads.find((l) => l.id === s.lead_id)?.owner_id ?? me.id;
        const n: AppNotification = { id: uuid(), user_id: owner, kind: 'sms', lead_id: s.lead_id, ref_kind: 'sms', ref_id: reply.id, actor_id: null, title: `SMS von ${this.leadName(s.lead_id)}`, body: reply.body, created_at: nowIso(), read_at: null, done_at: null, snoozed_until: null };
        this.db.notifications.push(n);
        this.persist();
        this.emit('sms_messages', reply as unknown as Record<string, unknown>);
        this.emit('notifications', n as unknown as Record<string, unknown>);
      }, 6000);
    }
    return clone(s);
  }

  async listSms(filter: { leadId?: ID; limit?: number }) {
    let rows = this.db.sms.filter((s) => s.user_id === this.me?.id || this.canSeeLeadId(s.lead_id));
    if (filter.leadId) rows = rows.filter((s) => s.lead_id === filter.leadId);
    rows.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    return rows.slice(0, filter.limit ?? 200).map((s) => ({ ...clone(s), lead: this.leadRef(s.lead_id) }));
  }

  async emailAccount<T>(action: 'save' | 'test' | 'delete' | 'sync', payload: Record<string, unknown>): Promise<T> {
    await wait(700);
    const me = this.user();
    if (action === 'delete') {
      this.db.emailAccounts = this.db.emailAccounts.filter((a) => a.id !== payload.id);
      this.persist();
      return { ok: true } as T;
    }
    if (action === 'test') return { ok: true, imap: 'Verbindung klappt (Demo)', smtp: 'Verbindung klappt (Demo)' } as T;
    if (action === 'sync') return { ok: true, fetched: 0 } as T;
    const email = String(payload.email ?? '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Bitte eine gültige E-Mail-Adresse eingeben.');
    let acc = this.db.emailAccounts.find((a) => a.id === payload.id);
    const base = {
      email, display_name: String(payload.display_name ?? me.full_name), imap_host: String(payload.imap_host ?? 'imap.ionos.de'), imap_port: Number(payload.imap_port ?? 993),
      smtp_host: String(payload.smtp_host ?? 'smtp.ionos.de'), smtp_port: Number(payload.smtp_port ?? 465), username: String(payload.username || email), signature: String(payload.signature ?? ''),
      sync_enabled: payload.sync_enabled !== false,
    };
    if (acc) Object.assign(acc, base);
    else {
      acc = { id: uuid(), user_id: me.id, ...base, last_sync_at: null, last_error: null, created_at: nowIso() };
      this.db.emailAccounts.push(acc);
    }
    this.persist();
    return { ok: true, account: clone(acc) } as T;
  }

  // ---------- Audio ----------
  async uploadVoicemailDrop(name: string, wav: Blob, seconds: number, shared: boolean) {
    this.require('calling', 'Keine Berechtigung.');
    const id = uuid();
    const path = `${this.user().id}/${id}.wav`;
    this.audioCache.set(`voicemails/${path}`, await blobToDataUrl(wav));
    const drop: VoicemailDrop = { id, user_id: this.user().id, name, storage_path: path, duration: Math.round(seconds), shared, created_at: nowIso() };
    this.db.drops.push(drop);
    this.persist();
    return clone(drop);
  }

  async deleteVoicemailDrop(drop: VoicemailDrop) {
    this.db.drops = this.db.drops.filter((d) => d.id !== drop.id);
    this.persist();
  }

  async audioUrl(bucket: 'voicemails' | 'recordings', path: string) {
    const key = `${bucket}/${path}`;
    const hit = this.audioCache.get(key);
    if (hit) return hit;
    if (bucket === 'recordings') {
      const callId = path.split('/').pop()?.replace(/\.wav$/, '') ?? '';
      const call = this.db.calls.find((c) => c.id === callId);
      if (call && !call.is_voicemail) {
        if (!this.canListen(call)) throw new Error('Die Aufnahme ist nicht (mehr) vorhanden oder du darfst sie nicht anhören.');
        if (!this.db.callScripts[callId]) this.assignScript(call);
        const rec = this.recordingFor(call);
        if (rec) {
          const url = await blobToDataUrl(rec.wav);
          this.audioCache.set(key, url);
          return url;
        }
      }
    }
    const url = await blobToDataUrl(demoRecording(bucket === 'voicemails' ? 6 : 9, this.pathSeed(path) + 1));
    this.audioCache.set(key, url);
    return url;
  }

  private pathSeed(path: string) {
    let seed = 0;
    for (const ch of path) seed = (seed * 31 + ch.charCodeAt(0)) % 100000;
    return seed;
  }

  async uploadGreeting(wav: Blob) {
    const path = `org/greeting-${Date.now()}.wav`;
    this.audioCache.set(`voicemails/${path}`, await blobToDataUrl(wav));
    return path;
  }

  // ---------- Power Dialer ----------
  private locks = new Map<ID, { user: ID; until: number }>();

  async dialerClaim(leadId: ID) {
    this.require('calling', 'Keine Berechtigung zum Telefonieren.');
    const lead = this.db.leads.find((l) => l.id === leadId);
    if (!lead || !this.canSee(lead) || lead.do_not_call) return false;
    const lock = this.locks.get(leadId);
    const me = this.user().id;
    if (lock && lock.until > Date.now() && lock.user !== me) return false;
    this.locks.set(leadId, { user: me, until: Date.now() + 300_000 });
    return true;
  }

  async dialerRelease(leadId: ID) {
    const lock = this.locks.get(leadId);
    if (lock?.user === this.me?.id) this.locks.delete(leadId);
  }

  // ---------- Fehlerprotokoll ----------
  async logClientError(message: string, details: Record<string, unknown> = {}) {
    this.logs.unshift({ id: Date.now(), at: nowIso(), source: 'browser', level: 'error', user_id: this.me?.id ?? null, message, details });
    this.logs = this.logs.slice(0, 100);
  }

  async listLogs(limit = 100) {
    return clone(this.logs.slice(0, limit));
  }

  // ---------- Import ----------
  async importLeads(rows: ImportRow[], opts: ImportOptions, onProgress?: (done: number) => void): Promise<ImportResult> {
    this.require('import', 'Keine Berechtigung zum Importieren.');
    const result: ImportResult = { created: 0, merged: 0, skipped: 0, failed: [] };
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      try {
        const phones = row.contacts.flatMap((c) => c.phones).map((p) => normalizePhone(p)).filter(Boolean) as string[];
        const existing = opts.duplicateMode === 'create' ? null : this.findDuplicate(row.lead.name, row.lead.address_zip ?? null, phones);
        if (existing && opts.duplicateMode === 'skip') {
          result.skipped++;
        } else if (existing) {
          for (const c of row.contacts) {
            const known = this.db.contacts.some((x) => x.lead_id === existing.id && c.phones.some((p) => x.phones.some((xp) => xp.number === normalizePhone(p))));
            if (!known) this.insertContact({ lead_id: existing.id, name: c.name, title: c.title ?? null, phones: c.phones.map((n) => ({ type: 'office', number: n })), emails: c.emails.map((e) => ({ type: 'office', email: e })) });
          }
          result.merged++;
        } else {
          const lead = await this.createLead(
            { ...row.lead, status_id: row.lead.status_id ?? opts.statusId, owner_id: row.lead.owner_id ?? opts.ownerId, source: row.lead.source ?? opts.source },
            row.contacts.map((c, idx) => ({ name: c.name, title: c.title ?? null, phones: c.phones.map((n) => ({ type: 'office' as const, number: n })), emails: c.emails.map((e) => ({ type: 'office', email: e })), sort: idx })),
          );
          if (row.note) await this.addNote(lead.id, row.note);
          result.created++;
        }
      } catch (e) {
        result.failed.push({ row: i + 1, error: e instanceof Error ? e.message : String(e) });
      }
      if (i % 20 === 0) onProgress?.(i + 1);
    }
    onProgress?.(rows.length);
    this.persist();
    return result;
  }

  private findDuplicate(name: string, zip: string | null, phones: string[]): Lead | null {
    if (phones.length) {
      const c = this.db.contacts.find((x) => x.phones.some((p) => phones.includes(p.number)));
      if (c) return this.db.leads.find((l) => l.id === c.lead_id) ?? null;
    }
    const n = name.trim().toLowerCase();
    return this.db.leads.find((l) => l.name.toLowerCase() === n && (!zip || l.address_zip === zip)) ?? null;
  }

  // ---------- Live ----------
  subscribe(table: RealtimeTable, cb: (row: Record<string, unknown>) => void) {
    if (!this.listeners.has(table)) this.listeners.set(table, new Set());
    this.listeners.get(table)!.add(cb);
    return () => this.listeners.get(table)?.delete(cb);
  }

  async invoke<T>(fn: string): Promise<T> {
    await wait(200);
    if (fn === 'gcal-sync') return (await this.syncCalendars()) as T;
    return { ok: true } as T;
  }

  // ---------- Demo-Helfer ----------
  demoCalendlyBooking(leadId: ID, contactId: ID | null, link: { name: string; duration?: number }, start: Date) {
    const lead = this.db.leads.find((l) => l.id === leadId);
    const contact = this.db.contacts.find((c) => c.id === contactId) ?? this.db.contacts.find((c) => c.lead_id === leadId);
    return this.saveMeeting({
      lead_id: leadId,
      contact_id: contact?.id ?? null,
      source: 'calendly',
      title: link.name,
      starts_at: start.toISOString(),
      ends_at: new Date(start.getTime() + (link.duration ?? 30) * 60_000).toISOString(),
      host_user_id: DEMO_USERS.lea,
      set_by: this.user().id,
      invitee_name: contact?.name ?? lead?.name ?? null,
      invitee_email: contact?.emails[0]?.email ?? null,
      join_url: 'https://meet.google.com/demo-link',
      location: 'Google Meet',
    });
  }

  randomLeadForInbound(): { lead: Lead; contact: Contact } | null {
    const withPhone = this.db.contacts.filter((c) => c.phones.length && this.canSeeLeadId(c.lead_id));
    if (!withPhone.length) return null;
    const contact = withPhone[Math.floor(Math.random() * withPhone.length)];
    const lead = this.db.leads.find((l) => l.id === contact.lead_id);
    return lead ? { lead: clone(lead), contact: clone(contact) } : null;
  }

  todayStats(userId: ID) {
    const from = startOfDay();
    const to = new Date(from.getTime() + DAY);
    return this.reportActivity(from, to).then((rows) => rows.find((r) => r.user_id === userId));
  }

  upcomingFor(days = 7) {
    return this.listMeetings({ from: startOfDay(), to: addDays(startOfDay(), days) });
  }
}
