// Live-Modus: Daten liegen in eurer Supabase-Datenbank (EU).

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config.ts';
import { searchTerms } from '../filters.ts';
import { normalizePhone } from '../format.ts';
import { uuid } from '../ids.ts';
import { permsOfRole, visibilityOfRole } from '../perms.ts';
import type {
  ActivityRow,
  ActivityType,
  AppLog,
  AppNotification,
  Call,
  CallHourRow,
  CallInsights,
  CallOutcome,
  CallQuality,
  Comment,
  CommentTarget,
  Contact,
  CustomActivity,
  CustomField,
  DailyRow,
  DuplicatePair,
  Email,
  EmailAccount,
  EmailTemplate,
  FilterSet,
  FormValueRow,
  FunnelRow,
  Group,
  GroupMember,
  ID,
  IntegrationLink,
  Lead,
  LeadInput,
  LeadStatus,
  LiveCall,
  Meeting,
  MeetingStatus,
  Note,
  Opportunity,
  OpportunityStatus,
  OrgSettings,
  OutcomeRow,
  Permission,
  PhoneNumberRow,
  Pipeline,
  Profile,
  RefData,
  Role,
  SmartView,
  SmsMessage,
  SortSpec,
  StatusChangeRow,
  Task,
  TimelineItem,
  VoicemailDrop,
  Workflow,
  WorkflowRun,
} from '../types.ts';
import { filterExpr } from './pgFilter.ts';
import {
  type CalendarEventInput,
  type CallFilter,
  type CallFinalize,
  CONFIG_KEYS,
  type ConfigRows,
  type ConfigTable,
  type ContactFilter,
  type EmailSendInput,
  type ImportOptions,
  type ImportResult,
  type ImportRow,
  type JobsState,
  type ManualCallInput,
  type MeetingFilter,
  type NotificationFilter,
  type OpportunityFilter,
  type Page,
  type RealtimeTable,
  type SmsSendInput,
  type Store,
  type SyncResult,
  type TaskFilter,
} from './types.ts';

export class FunctionError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

type Q = any; // Abfrage-Builder von supabase-js (Typen dort sind sehr verschachtelt)

function must<T>(res: { data: T; error: { message: string; code?: string } | null }, what: string): T {
  if (res.error) throw new Error(translateError(res.error.message, what));
  return res.data;
}

function translateError(msg: string, what: string): string {
  if (/row-level security|permission denied/i.test(msg)) return `${what}: Keine Berechtigung.`;
  if (/JWT expired|invalid JWT/i.test(msg)) return 'Sitzung abgelaufen – bitte neu anmelden.';
  if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) return `${what}: Keine Verbindung zum Server.`;
  if (/duplicate key/i.test(msg)) return `${what}: Gibt es schon.`;
  if (/violates foreign key/i.test(msg)) return `${what}: Wird noch verwendet.`;
  return `${what}: ${msg}`;
}

const CHUNK = 200;
function chunks<T>(arr: T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

const num = (v: unknown) => Number(v ?? 0);

export class SupabaseStore implements Store {
  readonly mode = 'live' as const;
  readonly sb: SupabaseClient;
  private me: Profile | null = null;
  private statuses: LeadStatus[] = [];
  private customFields: CustomField[] = [];
  private oppStatuses: OpportunityStatus[] = [];
  private org: OrgSettings | null = null;

  constructor(url = config.supabaseUrl, key = config.supabaseKey) {
    this.sb = createClient(url, key, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
  }

  private user(): Profile {
    if (!this.me) throw new Error('Nicht angemeldet.');
    return this.me;
  }

  // ---------- Anmeldung ----------
  private async loadProfile(id: string): Promise<Profile> {
    const p = must(await this.sb.from('profiles').select('*').eq('id', id).maybeSingle(), 'Profil') as Profile | null;
    if (!p) {
      await this.sb.auth.signOut();
      throw new Error(
        'Zu diesem Login gibt es kein Profil. Wurde der Benutzer vor der Datenbank-Einrichtung angelegt? Dann in Supabase unter Authentication → Users löschen und neu anlegen (EINRICHTUNG.md, Schritt 5).',
      );
    }
    if (!p.active) {
      await this.sb.auth.signOut();
      throw new Error('Dein Zugang ist noch nicht freigeschaltet oder wurde deaktiviert. Bitte einen Admin, dich im Team freizuschalten.');
    }
    this.me = p;
    return p;
  }

  async currentUser() {
    const { data } = await this.sb.auth.getSession();
    if (!data.session) return null;
    return this.loadProfile(data.session.user.id);
  }

  async signIn(email: string, password: string) {
    const { data, error } = await this.sb.auth.signInWithPassword({ email: email.trim(), password });
    if (error || !data.user) {
      if (/invalid login/i.test(error?.message ?? '')) throw new Error('E-Mail oder Passwort ist falsch.');
      if (/not confirmed/i.test(error?.message ?? '')) throw new Error('Die E-Mail-Adresse ist noch nicht bestätigt.');
      throw new Error(error?.message ?? 'Anmeldung fehlgeschlagen.');
    }
    return this.loadProfile(data.user.id);
  }

  async signOut() {
    await this.sb.auth.signOut();
    this.me = null;
  }

  async sendPasswordReset(email: string) {
    const { error } = await this.sb.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${location.origin}${location.pathname}`,
    });
    if (error) throw new Error(error.message);
  }

  async changePassword(password: string) {
    const { error } = await this.sb.auth.updateUser({ password });
    if (error) throw new Error(error.message);
  }

  onSignedOut(cb: () => void) {
    const { data } = this.sb.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') cb();
    });
    return () => data.subscription.unsubscribe();
  }

  onPasswordRecovery(cb: () => void) {
    const { data } = this.sb.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') cb();
    });
    return () => data.subscription.unsubscribe();
  }

  // ---------- Stammdaten ----------
  async loadRef(): Promise<RefData> {
    const me = this.user();
    const [
      profiles, roles, groups, groupMembers, statuses, outcomes, pipelines, opp, cf, types, links, org, views, numbers,
      templates, drops, workflows, accounts,
    ] = await Promise.all([
      this.sb.from('profiles').select('*').order('full_name'),
      this.sb.from('roles').select('*').order('sort'),
      this.sb.from('groups').select('*').order('name'),
      this.sb.from('group_members').select('*'),
      this.sb.from('lead_statuses').select('*').order('sort'),
      this.sb.from('call_outcomes').select('*').order('sort'),
      this.sb.from('pipelines').select('*').order('sort'),
      this.sb.from('opportunity_statuses').select('*').order('sort'),
      this.sb.from('custom_fields').select('*').order('sort'),
      this.sb.from('activity_types').select('*').order('sort'),
      this.sb.from('integration_links').select('*').order('sort'),
      this.sb.from('org_settings').select('*').eq('id', 1).single(),
      this.sb.from('smart_views').select('*').order('position'),
      this.sb.from('phone_numbers').select('*').order('number'),
      this.sb.from('email_templates').select('*').order('name'),
      this.sb.from('voicemail_drops').select('*').order('created_at'),
      this.sb.from('workflows').select('*').order('name'),
      this.sb.from('email_accounts').select('*').eq('user_id', me.id).order('created_at'),
    ]);
    this.statuses = must(statuses, 'Status') as LeadStatus[];
    this.org = must(org, 'Einstellungen') as OrgSettings;
    this.customFields = must(cf, 'Eigene Felder') as CustomField[];
    this.oppStatuses = must(opp, 'Pipeline') as OpportunityStatus[];
    const allProfiles = must(profiles, 'Team') as Profile[];
    const allRoles = must(roles, 'Rollen') as Role[];
    this.me = allProfiles.find((p) => p.id === me.id) ?? me;
    const myRole = allRoles.find((r) => r.id === this.me!.role_id);
    return {
      me: this.me,
      perms: permsOfRole(myRole) as Permission[],
      visibility: visibilityOfRole(myRole),
      profiles: allProfiles,
      roles: allRoles,
      groups: must(groups, 'Gruppen') as Group[],
      groupMembers: must(groupMembers, 'Gruppen') as GroupMember[],
      statuses: this.statuses,
      outcomes: must(outcomes, 'Anruf-Ergebnisse') as CallOutcome[],
      pipelines: must(pipelines, 'Pipelines') as Pipeline[],
      oppStatuses: this.oppStatuses,
      customFields: this.customFields,
      activityTypes: must(types, 'Formulare') as ActivityType[],
      integrationLinks: must(links, 'Links') as IntegrationLink[],
      org: this.org,
      smartViews: must(views, 'Smart Views') as SmartView[],
      phoneNumbers: must(numbers, 'Nummern') as PhoneNumberRow[],
      templates: must(templates, 'Vorlagen') as EmailTemplate[],
      voicemailDrops: must(drops, 'Mailbox-Nachrichten') as VoicemailDrop[],
      workflows: must(workflows, 'Workflows') as Workflow[],
      emailAccounts: must(accounts, 'Postfächer') as EmailAccount[],
    };
  }

  // ---------- Filter → Datenbank ----------
  private applyFilter(q: Q, filter: FilterSet): Q {
    const expr = filterExpr(filter, { me: this.user().id, statuses: this.statuses, customFields: this.customFields });
    if (expr) q = q.or(expr);
    for (const term of searchTerms(filter.q)) q = q.ilike('search_text', `%${term}%`);
    return q;
  }

  private withSortedContacts(lead: Lead): Lead {
    if (lead.contacts) lead.contacts = [...lead.contacts].sort((a, b) => a.sort - b.sort || a.created_at.localeCompare(b.created_at));
    return lead;
  }

  // ---------- Leads ----------
  async listLeads(filter: FilterSet, sort: SortSpec, page: Page) {
    let q: Q = this.sb.from('leads').select('*, contacts(*)', { count: 'exact' });
    q = this.applyFilter(q, filter);
    q = q.order(sort.field, { ascending: sort.dir === 'asc', nullsFirst: false }).order('id');
    q = q.range(page.offset, page.offset + page.limit - 1);
    const res = await q;
    const rows = (must(res, 'Leads') as Lead[]).map((l) => this.withSortedContacts(l));
    return { rows, total: res.count ?? rows.length };
  }

  async listLeadIds(filter: FilterSet, sort: SortSpec, limit: number) {
    const out: ID[] = [];
    for (let offset = 0; offset < limit; offset += 1000) {
      let q: Q = this.sb.from('leads').select('id');
      q = this.applyFilter(q, filter);
      q = q.order(sort.field, { ascending: sort.dir === 'asc', nullsFirst: false }).order('id');
      q = q.range(offset, Math.min(offset + 999, limit - 1));
      const rows = must(await q, 'Leads') as { id: ID }[];
      out.push(...rows.map((r) => r.id));
      if (rows.length < 1000) break;
    }
    return out;
  }

  async countLeads(filter: FilterSet) {
    let q: Q = this.sb.from('leads').select('id', { count: 'exact', head: true });
    q = this.applyFilter(q, filter);
    const res = await q;
    must(res, 'Leads');
    return res.count ?? 0;
  }

  async searchLeads(q: string, limit = 8) {
    const terms = searchTerms(q);
    if (!terms.length) return [];
    let query: Q = this.sb.from('leads').select('*, contacts(*)');
    for (const t of terms) query = query.ilike('search_text', `%${t}%`);
    query = query.order('last_activity_at', { ascending: false, nullsFirst: false }).limit(limit);
    return (must(await query, 'Suche') as Lead[]).map((l) => this.withSortedContacts(l));
  }

  async getLead(id: ID) {
    const lead = must(await this.sb.from('leads').select('*, contacts(*)').eq('id', id).maybeSingle(), 'Lead') as Lead | null;
    return lead ? this.withSortedContacts(lead) : null;
  }

  async getLeads(ids: ID[]) {
    const out: Lead[] = [];
    for (const part of chunks(ids)) {
      out.push(...(must(await this.sb.from('leads').select('*, contacts(*)').in('id', part), 'Leads') as Lead[]));
    }
    return out.map((l) => this.withSortedContacts(l));
  }

  async createLead(input: LeadInput & { name: string }, contacts: Partial<Contact>[] = []) {
    const status = input.status_id ?? this.statuses.find((s) => s.is_default)?.id ?? null;
    const id = uuid();
    // ohne Rückgabe: bei eingeschränkter Sichtbarkeit wäre der neue Lead sonst „unsichtbar“
    must(await this.sb.from('leads').insert({ ...input, id, status_id: status }), 'Lead anlegen');
    if (contacts.length) {
      must(
        await this.sb.from('contacts').insert(
          contacts.map((c, i) => ({
            lead_id: id,
            name: c.name ?? '',
            title: c.title ?? null,
            phones: c.phones ?? [],
            emails: c.emails ?? [],
            custom: c.custom ?? {},
            sort: c.sort ?? i,
          })),
        ),
        'Kontakte anlegen',
      );
    }
    const lead = await this.getLead(id);
    if (!lead) throw new Error('Lead angelegt – du siehst ihn aber nicht, weil er jemand anderem zugeordnet ist.');
    return lead;
  }

  async updateLead(id: ID, patch: LeadInput) {
    must(await this.sb.from('leads').update(patch).eq('id', id), 'Lead speichern');
  }

  async bulkUpdateLeads(ids: ID[], patch: LeadInput) {
    let total = 0;
    for (const part of chunks(ids, 1000)) {
      total += Number(must(await this.sb.rpc('bulk_update_leads', { p_ids: part, p_patch: patch }), 'Leads ändern') ?? 0);
    }
    return total;
  }

  async deleteLeads(ids: ID[]) {
    let total = 0;
    if (ids.length > 1) {
      for (const part of chunks(ids, 1000)) {
        total += Number(must(await this.sb.rpc('bulk_delete_leads', { p_ids: part }), 'Leads löschen') ?? 0);
      }
    } else if (ids.length) {
      const rows = must(await this.sb.from('leads').delete().in('id', ids).select('id'), 'Lead löschen') as { id: ID }[];
      total = rows.length;
    }
    if (total < ids.length) throw new Error(total ? `Nur ${total} von ${ids.length} Leads gelöscht – für die übrigen fehlt die Berechtigung.` : 'Keine Berechtigung zum Löschen.');
    return total;
  }

  async saveContact(contact: Partial<Contact> & { lead_id: ID }) {
    const row = {
      lead_id: contact.lead_id,
      name: contact.name ?? '',
      title: contact.title ?? null,
      phones: contact.phones ?? [],
      emails: contact.emails ?? [],
      custom: contact.custom ?? {},
      sort: contact.sort ?? 0,
    };
    const res = contact.id
      ? await this.sb.from('contacts').update(row).eq('id', contact.id).select('*').single()
      : await this.sb.from('contacts').insert(row).select('*').single();
    return must(res, 'Kontakt speichern') as Contact;
  }

  async deleteContact(id: ID) {
    must(await this.sb.from('contacts').delete().eq('id', id), 'Kontakt löschen');
  }

  async findLeadByPhone(number: string) {
    const n = normalizePhone(number);
    if (!n) return null;
    const rows = must(
      await this.sb.from('contacts').select('*').contains('phones', JSON.stringify([{ number: n }])).limit(1),
      'Suche',
    ) as Contact[];
    if (!rows.length) return null;
    const lead = await this.getLead(rows[0].lead_id);
    return lead ? { lead, contact: rows[0] } : null;
  }

  async listContacts(filter: ContactFilter) {
    let q: Q = this.sb.from('contacts').select('*, lead:leads(id, name, status_id, owner_id)', { count: 'exact' });
    const term = (filter.q ?? '').trim();
    if (term) {
      const phone = normalizePhone(term);
      if (phone && /^[+0-9 ()/-]+$/.test(term)) q = q.contains('phones', JSON.stringify([{ number: phone }]));
      else if (term.includes('@')) q = q.contains('emails', JSON.stringify([{ email: term.toLowerCase() }]));
      else q = q.or(`name.ilike.${JSON.stringify(`*${term.replace(/[%_*,()"]/g, ' ')}*`)},title.ilike.${JSON.stringify(`*${term.replace(/[%_*,()"]/g, ' ')}*`)}`);
    }
    if (filter.role) q = q.contains('custom', JSON.stringify({ contact_role: [filter.role] }));
    q = q.order('name').range(filter.page.offset, filter.page.offset + filter.page.limit - 1);
    const res = await q;
    return { rows: must(res, 'Kontakte') as Contact[], total: res.count ?? 0 };
  }

  async findDuplicates(leadId: ID | null = null, limit = 200) {
    const rows = must(await this.sb.rpc('find_duplicate_leads', { p_lead: leadId, p_limit: limit }), 'Dubletten') as DuplicatePair[];
    return rows ?? [];
  }

  async dismissDuplicate(a: ID, b: ID) {
    const [x, y] = a < b ? [a, b] : [b, a];
    must(await this.sb.from('duplicate_dismissals').insert({ lead_a: x, lead_b: y }), 'Dublette ausblenden');
  }

  async mergeLeads(keepId: ID, mergeId: ID) {
    must(await this.sb.rpc('merge_leads', { p_keep: keepId, p_merge: mergeId }), 'Zusammenführen');
  }

  // ---------- Verlauf ----------
  async timeline(leadId: ID, limit = 200) {
    const rows = must(
      await this.sb.from('lead_timeline').select('*').eq('lead_id', leadId).order('at', { ascending: false }).limit(limit),
      'Verlauf',
    );
    return rows as TimelineItem[];
  }

  async addNote(leadId: ID, body: string, contactId: ID | null = null, mentions: ID[] = []) {
    return must(
      await this.sb.from('notes').insert({ lead_id: leadId, body, contact_id: contactId, mentions }).select('*').single(),
      'Notiz speichern',
    ) as Note;
  }

  async updateNote(id: ID, patch: Partial<Pick<Note, 'body' | 'pinned' | 'mentions'>>) {
    must(await this.sb.from('notes').update(patch).eq('id', id), 'Notiz speichern');
  }

  async deleteNote(id: ID) {
    must(await this.sb.from('notes').delete().eq('id', id), 'Notiz löschen');
  }

  async logEmail(input: { lead_id: ID; contact_id: ID | null; to_address: string | null; subject: string; body: string }) {
    return must(await this.sb.from('emails').insert({ ...input, status: 'logged' }).select('*').single(), 'E-Mail speichern') as Email;
  }

  async listComments(leadId: ID) {
    return must(await this.sb.from('comments').select('*').eq('lead_id', leadId).order('created_at'), 'Kommentare') as Comment[];
  }

  async listCommentsFor(kind: CommentTarget, targetId: ID) {
    return must(
      await this.sb.from('comments').select('*').eq('target_kind', kind).eq('target_id', targetId).order('created_at'),
      'Kommentare',
    ) as Comment[];
  }

  async addComment(input: { lead_id: ID; target_kind: CommentTarget; target_id: ID; body: string; at_ms?: number | null; mentions?: ID[] }) {
    return must(
      await this.sb.from('comments').insert({ ...input, mentions: input.mentions ?? [] }).select('*').single(),
      'Kommentar',
    ) as Comment;
  }

  async deleteComment(id: ID) {
    must(await this.sb.from('comments').delete().eq('id', id), 'Kommentar löschen');
  }

  async saveActivity(a: Partial<CustomActivity> & { type_id: ID; lead_id: ID; data: Record<string, unknown> }) {
    const row = {
      type_id: a.type_id,
      lead_id: a.lead_id,
      contact_id: a.contact_id ?? null,
      call_id: a.call_id ?? null,
      data: a.data,
      status: a.status ?? 'published',
    };
    const res = a.id
      ? await this.sb.from('custom_activities').update(row).eq('id', a.id).select('*').single()
      : await this.sb.from('custom_activities').insert(row).select('*').single();
    return must(res, 'Formular speichern') as CustomActivity;
  }

  async deleteActivity(id: ID) {
    must(await this.sb.from('custom_activities').delete().eq('id', id), 'Formular löschen');
  }

  async listActivities(filter: { typeId?: ID | null; userId?: ID | null; from?: Date; to?: Date; limit?: number }) {
    let q: Q = this.sb.from('custom_activities').select('*, lead:leads(id, name)').eq('status', 'published');
    if (filter.typeId) q = q.eq('type_id', filter.typeId);
    if (filter.userId) q = q.eq('user_id', filter.userId);
    if (filter.from) q = q.gte('created_at', filter.from.toISOString());
    if (filter.to) q = q.lt('created_at', filter.to.toISOString());
    q = q.order('created_at', { ascending: false }).limit(filter.limit ?? 200);
    return must(await q, 'Formulare') as (CustomActivity & { lead?: { id: ID; name: string } | null })[];
  }

  // ---------- Anrufe ----------
  async finalizeCall(callId: ID, patch: CallFinalize) {
    const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
    const updated = must(await this.sb.from('calls').update(clean).eq('id', callId).select('id'), 'Anruf speichern') as {
      id: ID;
    }[];
    if (updated.length) return;
    // Anruf kam nie bei Twilio an (z. B. Mikrofon blockiert) → trotzdem protokollieren
    must(
      await this.sb.from('calls').upsert(
        { id: callId, user_id: this.user().id, direction: 'outbound', status: 'failed', ...clean },
        { onConflict: 'id' },
      ),
      'Anruf speichern',
    );
  }

  async logManualCall(input: ManualCallInput) {
    const start = input.started_at ?? new Date(Date.now() - input.duration * 1000).toISOString();
    return must(
      await this.sb.from('calls').insert({
        lead_id: input.lead_id,
        contact_id: input.contact_id ?? null,
        user_id: this.user().id,
        direction: input.direction,
        outcome: input.outcome,
        note: input.note,
        duration: input.duration,
        status: 'completed',
        started_at: start,
        ended_at: new Date().toISOString(),
      }).select('*').single(),
      'Anruf protokollieren',
    ) as Call;
  }

  async getCall(id: ID) {
    return must(await this.sb.from('calls').select('*, lead:leads(id, name)').eq('id', id).maybeSingle(), 'Anruf') as Call | null;
  }

  async listCalls(filter: CallFilter, page: Page) {
    const term = (filter.q ?? '').trim();
    let q: Q = this.sb
      .from('calls')
      .select(term ? '*, lead:leads(id, name), insights:call_insights!inner(transcript_text)' : '*, lead:leads(id, name)', { count: 'exact' });
    if (filter.userId) q = q.eq('user_id', filter.userId);
    if (filter.userIds?.length) q = q.in('user_id', filter.userIds);
    if (filter.direction) q = q.eq('direction', filter.direction);
    if (filter.outcome) q = q.eq('outcome', filter.outcome);
    if (filter.withRecording) q = q.not('recording_path', 'is', null);
    if (filter.withTranscript) q = q.eq('transcript_status', 'ready');
    if (filter.minDuration) q = q.gte('duration', filter.minDuration);
    if (filter.leadId) q = q.eq('lead_id', filter.leadId);
    if (filter.from) q = q.gte('started_at', filter.from.toISOString());
    if (filter.to) q = q.lt('started_at', filter.to.toISOString());
    if (term) q = q.ilike('insights.transcript_text', `%${term.replace(/[%_]/g, ' ')}%`);
    q = q.order('started_at', { ascending: false }).range(page.offset, page.offset + page.limit - 1);
    const res = await q;
    const rows = (must(res, 'Anrufe') as (Call & { insights?: unknown })[]).map((r) => {
      delete r.insights;
      return r as Call;
    });
    return { rows, total: res.count ?? 0 };
  }

  async recordingUrl(path: string) {
    return this.audioUrl('recordings', path);
  }

  async getCallInsights(callId: ID) {
    return must(await this.sb.from('call_insights').select('*').eq('call_id', callId).maybeSingle(), 'Auswertung') as CallInsights | null;
  }

  async requestTranscript(callId: ID) {
    await this.invoke('call-control', { action: 'transcribe', callId });
  }

  async deleteRecording(callId: ID) {
    must(await this.sb.rpc('delete_recording', { p_call: callId }), 'Aufnahme löschen');
  }

  async swapRecordingChannels(callId: ID) {
    must(await this.sb.rpc('swap_recording_channels', { p_call: callId }), 'Spuren tauschen');
  }

  async retryRecording(callId: ID) {
    await this.invoke('call-control', { action: 'recording_retry', callId });
  }

  async saveCallQuality(callId: ID, quality: CallQuality) {
    await this.sb.from('calls').update({ quality }).eq('id', callId);
  }

  async liveCalls() {
    return (must(await this.sb.rpc('live_calls'), 'Laufende Gespräche') as LiveCall[]) ?? [];
  }

  // ---------- Aufgaben ----------
  async listTasks(filter: TaskFilter) {
    let q: Q = this.sb.from('tasks').select('*, lead:leads(id, name)');
    if (filter.assignedTo === 'team') q = q.is('assigned_to', null);
    else if (filter.assignedTo && filter.assignedTo !== 'all') q = q.eq('assigned_to', filter.assignedTo);
    else if (!filter.assignedTo && !filter.leadId) q = q.eq('assigned_to', this.user().id);
    if (filter.done !== undefined) q = q.eq('done', filter.done);
    if (filter.leadId) q = q.eq('lead_id', filter.leadId);
    if (filter.dueBefore) q = q.or(`due_at.is.null,due_at.lte.${JSON.stringify(filter.dueBefore.toISOString())}`);
    if (filter.dueAfter) q = q.gt('due_at', filter.dueAfter.toISOString());
    if (filter.types?.length) q = q.in('type', filter.types);
    q = q.order('due_at', { ascending: true, nullsFirst: false }).limit(500);
    return must(await q, 'Aufgaben') as Task[];
  }

  async saveTask(task: Partial<Task> & { title: string }) {
    // Beim Ändern nur mitgeschickte Felder setzen (z. B. nur das Fälligkeitsdatum beim „Später“)
    const keys = ['title', 'lead_id', 'contact_id', 'type', 'note', 'due_at', 'call_id', 'assigned_to'] as const;
    const row: Record<string, unknown> = {};
    for (const k of keys) if (task[k] !== undefined) row[k] = task[k];
    if (!task.id) {
      row.type ??= 'todo';
      if (task.assigned_to === undefined) row.assigned_to = this.user().id;
    }
    const res = task.id
      ? await this.sb.from('tasks').update(row).eq('id', task.id).select('*').single()
      : await this.sb.from('tasks').insert(row).select('*').single();
    return must(res, 'Aufgabe speichern') as Task;
  }

  async setTaskDone(id: ID, done: boolean) {
    must(await this.sb.from('tasks').update({ done }).eq('id', id), 'Aufgabe');
  }

  async deleteTask(id: ID) {
    must(await this.sb.from('tasks').delete().eq('id', id), 'Aufgabe löschen');
  }

  // ---------- Inbox ----------
  async listNotifications(filter: NotificationFilter) {
    const now = new Date().toISOString();
    let q: Q = this.sb.from('notifications').select('*, lead:leads(id, name)').eq('user_id', filter.userId ?? this.user().id);
    if (filter.box === 'done') q = q.not('done_at', 'is', null).order('done_at', { ascending: false });
    else if (filter.box === 'later') q = q.is('done_at', null).gt('snoozed_until', now).order('snoozed_until');
    else q = q.is('done_at', null).or(`snoozed_until.is.null,snoozed_until.lte.${JSON.stringify(now)}`).order('created_at', { ascending: false });
    q = q.limit(filter.limit ?? 200);
    return must(await q, 'Benachrichtigungen') as AppNotification[];
  }

  async updateNotifications(ids: ID[], patch: { read?: boolean; done?: boolean; snoozed_until?: string | null }) {
    if (!ids.length) return;
    const now = new Date().toISOString();
    const row: Record<string, unknown> = {};
    if (patch.read !== undefined) row.read_at = patch.read ? now : null;
    if (patch.done !== undefined) {
      row.done_at = patch.done ? now : null;
      if (patch.done) row.read_at = now;
    }
    if (patch.snoozed_until !== undefined) row.snoozed_until = patch.snoozed_until;
    for (const part of chunks(ids)) must(await this.sb.from('notifications').update(row).in('id', part), 'Benachrichtigungen');
  }

  async inboxCounts(userId?: ID) {
    const rows = must(await this.sb.rpc('inbox_counts', { p_user: userId ?? null }), 'Inbox') as Record<string, unknown>[];
    const r = rows?.[0] ?? {};
    return { tasks_due: num(r.tasks_due), notifications_new: num(r.notifications_new) };
  }

  // ---------- Termine ----------
  async listMeetings(filter: MeetingFilter) {
    let q: Q = this.sb.from('meetings')
      .select('*, lead:leads(id, name)')
      .gte('starts_at', filter.from.toISOString())
      .lt('starts_at', filter.to.toISOString());
    if (!filter.includeCanceled) q = q.not('status', 'in', '(canceled,rescheduled)');
    if (filter.userId) q = q.or(`host_user_id.eq.${filter.userId},set_by.eq.${filter.userId}`);
    if (filter.leadId) q = q.eq('lead_id', filter.leadId);
    q = q.order('starts_at').limit(1000);
    return must(await q, 'Termine') as Meeting[];
  }

  async saveMeeting(meeting: Partial<Meeting> & { starts_at: string; title: string }) {
    const row: Record<string, unknown> = {
      lead_id: meeting.lead_id ?? null,
      contact_id: meeting.contact_id ?? null,
      title: meeting.title,
      description: meeting.description ?? null,
      location: meeting.location ?? null,
      join_url: meeting.join_url ?? null,
      starts_at: meeting.starts_at,
      ends_at: meeting.ends_at ?? null,
      host_user_id: meeting.host_user_id ?? null,
      invitee_name: meeting.invitee_name ?? null,
      invitee_email: meeting.invitee_email ?? null,
    };
    let saved: Meeting;
    if (meeting.id) {
      saved = must(await this.sb.from('meetings').update(row).eq('id', meeting.id).select('*').single(), 'Termin') as Meeting;
    } else {
      saved = must(
        await this.sb.from('meetings').insert({
          ...row,
          source: 'crm',
          external_id: uuid(),
          set_by: meeting.set_by ?? this.user().id,
          status: 'scheduled',
        }).select('*').single(),
        'Termin',
      ) as Meeting;
      await this.markLeadMeeting(saved.lead_id);
    }
    return saved;
  }

  private async markLeadMeeting(leadId: ID | null) {
    const target = this.org?.meeting_status_id;
    if (!leadId || !target) return;
    const lead = await this.getLead(leadId);
    if (!lead || lead.status_id === target) return;
    const kind = this.statuses.find((s) => s.id === lead.status_id)?.kind;
    if (kind !== 'won') await this.updateLead(leadId, { status_id: target });
  }

  async setMeetingStatus(id: ID, status: MeetingStatus, note?: string | null) {
    const patch: Record<string, unknown> = { status };
    if (note !== undefined) patch.outcome_note = note;
    must(await this.sb.from('meetings').update(patch).eq('id', id), 'Termin');
  }

  async createCalendarEvent(input: CalendarEventInput) {
    const res = await this.invoke<{ meetingId: ID; htmlLink: string | null }>('gcal-sync', {
      action: 'create',
      event: input,
      appUrl: `${location.origin}${location.pathname}`,
    });
    await this.markLeadMeeting(input.leadId);
    return res;
  }

  async syncCalendars(force = false) {
    return this.invoke<SyncResult>('gcal-sync', { action: 'sync', force });
  }

  async scheduleJobs() {
    must(await this.sb.rpc('admin_schedule_jobs', { p_base: config.functionsUrl }), 'Zeitplan');
  }

  async jobsState() {
    const res = await this.sb.rpc('admin_jobs_state');
    return res.error ? null : ((res.data as JobsState | null) ?? null);
  }

  // ---------- Pipeline ----------
  async listOpportunities(filter: OpportunityFilter = {}) {
    let q: Q = this.sb.from('opportunities').select('*, lead:leads(id, name)');
    if (filter.leadId) q = q.eq('lead_id', filter.leadId);
    if (filter.userId) q = q.eq('user_id', filter.userId);
    let statusIds = filter.statusIds?.length ? filter.statusIds : null;
    if (filter.pipelineId) {
      const inPipe = this.oppStatuses.filter((s) => s.pipeline_id === filter.pipelineId).map((s) => s.id);
      statusIds = statusIds ? statusIds.filter((id) => inPipe.includes(id)) : inPipe;
    }
    if (filter.open) {
      const open = this.oppStatuses.filter((s) => s.kind === 'open').map((s) => s.id);
      statusIds = statusIds ? statusIds.filter((id) => open.includes(id)) : open;
    }
    if (statusIds) {
      if (!statusIds.length) return [];
      q = q.in('status_id', statusIds);
    }
    q = q.order('created_at', { ascending: false }).limit(3000);
    return must(await q, 'Pipeline') as Opportunity[];
  }

  async saveOpportunity(o: Partial<Opportunity> & { lead_id: ID }) {
    // Beim Ändern nur mitgeschickte Felder (z. B. nur die Phase beim Ziehen im Board)
    const keys = ['lead_id', 'contact_id', 'status_id', 'value', 'value_period', 'confidence', 'expected_close', 'note', 'custom', 'user_id'] as const;
    const row: Record<string, unknown> = {};
    for (const k of keys) if (o[k] !== undefined) row[k] = o[k];
    if ('expected_close' in row) row.expected_close = row.expected_close || null;
    if (!o.id) {
      row.value ??= 0;
      row.value_period ??= 'one_time';
      row.confidence ??= 50;
      row.custom ??= {};
      if (!row.user_id) delete row.user_id;
    }
    const res = o.id
      ? await this.sb.from('opportunities').update(row).eq('id', o.id).select('*').single()
      : await this.sb.from('opportunities').insert(row).select('*').single();
    return must(res, 'Opportunity') as Opportunity;
  }

  async deleteOpportunity(id: ID) {
    must(await this.sb.from('opportunities').delete().eq('id', id), 'Opportunity löschen');
  }

  // ---------- Smart Views ----------
  async saveSmartView(v: Partial<SmartView> & { name: string; filters: FilterSet; sort: SortSpec }) {
    const row: Record<string, unknown> = {
      name: v.name,
      description: v.description ?? '',
      filters: v.filters,
      sort: v.sort,
      shared: v.shared ?? false,
      pinned: v.pinned ?? false,
      position: v.position ?? 100,
    };
    if (v.columns) row.columns = v.columns;
    const res = v.id
      ? await this.sb.from('smart_views').update(row).eq('id', v.id).select('*').single()
      : await this.sb.from('smart_views').insert(row).select('*').single();
    return must(res, 'Smart View') as SmartView;
  }

  async deleteSmartView(id: ID) {
    must(await this.sb.from('smart_views').delete().eq('id', id), 'Smart View löschen');
  }

  // ---------- Berichte ----------
  private range(from: Date, to: Date) {
    return { p_from: from.toISOString(), p_to: to.toISOString() };
  }

  async reportActivity(from: Date, to: Date, users: ID[] | null = null) {
    const rows = must(await this.sb.rpc('report_activity', { ...this.range(from, to), p_users: users?.length ? users : null }), 'Bericht') as Record<string, unknown>[];
    return rows.map((r) => ({
      user_id: r.user_id as string,
      dials: num(r.dials),
      reached: num(r.reached),
      meetings_logged: num(r.meetings_logged),
      talk_seconds: num(r.talk_seconds),
      inbound: num(r.inbound),
      meetings_booked: num(r.meetings_booked),
      meetings_held: num(r.meetings_held),
      notes: num(r.notes),
      emails: num(r.emails),
      sms: num(r.sms),
      forms: num(r.forms),
      tasks_done: num(r.tasks_done),
      opps_created: num(r.opps_created),
      deals_won: num(r.deals_won),
      won_value: num(r.won_value),
      opened_won: num(r.opened_won),
    })) as ActivityRow[];
  }

  async reportDaily(from: Date, to: Date, userId: ID | null = null, users: ID[] | null = null) {
    const rows = must(
      await this.sb.rpc('report_daily', { ...this.range(from, to), p_user: userId ?? null, p_users: users?.length ? users : null }),
      'Bericht',
    ) as Record<string, unknown>[];
    return rows.map((r) => ({
      day: String(r.day),
      dials: num(r.dials),
      reached: num(r.reached),
      meetings: num(r.meetings),
      talk_seconds: num(r.talk_seconds),
    })) as DailyRow[];
  }

  async reportOutcomes(from: Date, to: Date, userId: ID | null = null, users: ID[] | null = null) {
    const rows = must(
      await this.sb.rpc('report_outcomes', { ...this.range(from, to), p_user: userId ?? null, p_users: users?.length ? users : null }),
      'Bericht',
    ) as Record<string, unknown>[];
    return rows.map((r) => ({ outcome: String(r.outcome), cnt: num(r.cnt) })) as OutcomeRow[];
  }

  async reportStatusCounts() {
    const rows = must(await this.sb.rpc('report_status_counts'), 'Bericht') as Record<string, unknown>[];
    return rows.map((r) => ({ status_id: (r.status_id as string) ?? null, cnt: num(r.cnt) }));
  }

  async reportStatusChanges(from: Date, to: Date, users: ID[] | null = null) {
    const rows = must(await this.sb.rpc('report_status_changes', { ...this.range(from, to), p_users: users?.length ? users : null }), 'Bericht') as Record<string, unknown>[];
    return rows.map((r) => ({ from_status: (r.from_status as string) ?? null, to_status: (r.to_status as string) ?? null, cnt: num(r.cnt) })) as StatusChangeRow[];
  }

  async reportFunnel(from: Date, to: Date, pipelineId: ID, users: ID[] | null = null) {
    const rows = must(
      await this.sb.rpc('report_funnel', { ...this.range(from, to), p_pipeline: pipelineId, p_users: users?.length ? users : null }),
      'Bericht',
    ) as Record<string, unknown>[];
    return rows.map((r) => ({
      status_id: String(r.status_id),
      reached: num(r.reached),
      reached_value: num(r.reached_value),
      current_cnt: num(r.current_cnt),
      current_value: num(r.current_value),
    })) as FunnelRow[];
  }

  async reportCallHours(from: Date, to: Date, users: ID[] | null = null) {
    const rows = must(await this.sb.rpc('report_call_hours', { ...this.range(from, to), p_users: users?.length ? users : null }), 'Bericht') as Record<string, unknown>[];
    return rows.map((r) => ({ dow: num(r.dow), hour: num(r.hour), dials: num(r.dials), reached: num(r.reached) })) as CallHourRow[];
  }

  async reportFormValues(typeId: ID, field: string, from: Date, to: Date, users: ID[] | null = null) {
    const rows = must(
      await this.sb.rpc('report_form_values', { p_type: typeId, p_field: field, ...this.range(from, to), p_users: users?.length ? users : null }),
      'Bericht',
    ) as Record<string, unknown>[];
    return rows.map((r) => ({ value: String(r.value), cnt: num(r.cnt) })) as FormValueRow[];
  }

  // ---------- Einstellungen ----------
  async saveConfig<T extends ConfigTable>(table: T, row: Partial<ConfigRows[T]>, isNew = false): Promise<ConfigRows[T]> {
    const pk = CONFIG_KEYS[table];
    const key = (row as Record<string, unknown>)[pk] as string | undefined;
    const clean = { ...row } as Record<string, unknown>;
    delete clean.created_at;
    delete clean.updated_at;
    if (table === 'lead_statuses' && clean.is_default) {
      must(await this.sb.from('lead_statuses').update({ is_default: false }).neq('id', key ?? ''), 'Status');
    }
    const from = this.sb.from(table) as Q;
    const res = isNew || !key
      ? await from.insert(clean).select('*').single()
      : await from.update(clean).eq(pk, key).select('*').single();
    return must(res, 'Speichern') as ConfigRows[T];
  }

  async deleteConfig(table: ConfigTable, key: string) {
    must(await (this.sb.from(table) as Q).delete().eq(CONFIG_KEYS[table], key), 'Löschen');
  }

  async setGroupMembers(groupId: ID, userIds: ID[]) {
    must(await this.sb.from('group_members').delete().eq('group_id', groupId), 'Gruppe');
    if (userIds.length) {
      must(await this.sb.from('group_members').insert(userIds.map((user_id) => ({ group_id: groupId, user_id }))), 'Gruppe');
    }
  }

  async updateOrg(patch: Partial<OrgSettings>) {
    must(await this.sb.from('org_settings').update(patch).eq('id', 1), 'Einstellungen speichern');
    this.org = { ...(this.org as OrgSettings), ...patch };
  }

  async updateMyProfile(patch: Partial<Pick<Profile, 'full_name' | 'settings' | 'color' | 'available' | 'forward_number' | 'forward_mode'>>) {
    must(await this.sb.from('profiles').update(patch).eq('id', this.user().id), 'Profil speichern');
    this.me = { ...this.user(), ...patch } as Profile;
  }

  async uploadAttachment(file: File) {
    if (file.size > 15 * 1024 * 1024) throw new Error(`„${file.name}“ ist größer als 15 MB.`);
    const safe = file.name.replace(/[^\w.\-äöüÄÖÜß ]+/g, '_').slice(-120);
    const path = `${this.user().id}/${uuid()}-${safe}`;
    must(await this.sb.storage.from('attachments').upload(path, file, { contentType: file.type || 'application/octet-stream', upsert: false }), 'Anhang hochladen');
    return { name: file.name, size: file.size, path };
  }

  async attachmentUrl(path: string) {
    const res = await this.sb.storage.from('attachments').createSignedUrl(path, 600, { download: true });
    return (must(res, 'Anhang') as { signedUrl: string }).signedUrl;
  }

  async heartbeat() {
    await this.sb.from('profiles').update({ last_seen_at: new Date().toISOString() }).eq('id', this.user().id);
  }

  async teamPresence() {
    return (must(await this.sb.from('profiles').select('id, available, last_seen_at').eq('active', true), 'Team-Status') ?? []) as Pick<Profile, 'id' | 'available' | 'last_seen_at'>[];
  }

  async admin<T = Record<string, unknown>>(action: string, payload: Record<string, unknown> = {}) {
    return this.invoke<T>('admin', { action, ...payload });
  }

  // ---------- Workflows ----------
  async listWorkflowRuns(filter: { workflowId?: ID; leadId?: ID; status?: WorkflowRun['status'][]; limit?: number }) {
    let q: Q = this.sb.from('workflow_runs').select('*, lead:leads(id, name)');
    if (filter.workflowId) q = q.eq('workflow_id', filter.workflowId);
    if (filter.leadId) q = q.eq('lead_id', filter.leadId);
    if (filter.status?.length) q = q.in('status', filter.status);
    q = q.order('started_at', { ascending: false }).limit(filter.limit ?? 300);
    return must(await q, 'Workflow-Läufe') as WorkflowRun[];
  }

  async enrollInWorkflow(workflowId: ID, leadIds: ID[], contactId: ID | null = null) {
    let total = 0;
    for (const part of chunks(leadIds, 500)) {
      total += Number(must(await this.sb.rpc('workflow_enroll', { p_workflow: workflowId, p_leads: part, p_contact: contactId }), 'Workflow') ?? 0);
    }
    return total;
  }

  async setWorkflowRunStatus(runId: ID, status: 'active' | 'paused' | 'canceled') {
    must(await this.sb.rpc('workflow_run_set_status', { p_run: runId, p_status: status }), 'Workflow');
  }

  // ---------- E-Mail & SMS ----------
  async sendEmail(input: EmailSendInput) {
    const res = await this.invoke<{ email: Email }>('email', { action: 'send', ...input });
    return res.email;
  }

  async bulkEmail(leadIds: ID[], templateId: ID, sendAt: string | null = null) {
    return this.invoke<{ queued: number; skipped: number }>('email', { action: 'bulk', leadIds, templateId, sendAt });
  }

  async sendSms(input: SmsSendInput) {
    const res = await this.invoke<{ sms: SmsMessage }>('sms', { action: 'send', ...input });
    return res.sms;
  }

  async listSms(filter: { leadId?: ID; limit?: number }) {
    let q: Q = this.sb.from('sms_messages').select('*, lead:leads(id, name)');
    if (filter.leadId) q = q.eq('lead_id', filter.leadId);
    q = q.order('created_at', { ascending: false }).limit(filter.limit ?? 200);
    return must(await q, 'SMS') as SmsMessage[];
  }

  async emailAccount<T = Record<string, unknown>>(action: 'save' | 'test' | 'delete' | 'sync', payload: Record<string, unknown>) {
    return this.invoke<T>('email', { action: `account_${action}`, ...payload });
  }

  // ---------- Audio ----------
  async uploadVoicemailDrop(name: string, wav: Blob, seconds: number, shared: boolean) {
    const path = `${this.user().id}/${uuid()}.wav`;
    const up = await this.sb.storage.from('voicemails').upload(path, wav, { contentType: 'audio/wav' });
    if (up.error) throw new Error(`Hochladen fehlgeschlagen: ${up.error.message}`);
    return must(
      await this.sb.from('voicemail_drops').insert({ name, storage_path: path, duration: Math.round(seconds), shared }).select('*').single(),
      'Mailbox-Nachricht',
    ) as VoicemailDrop;
  }

  async deleteVoicemailDrop(drop: VoicemailDrop) {
    await this.sb.storage.from('voicemails').remove([drop.storage_path]);
    must(await this.sb.from('voicemail_drops').delete().eq('id', drop.id), 'Mailbox-Nachricht löschen');
  }

  async audioUrl(bucket: 'voicemails' | 'recordings', path: string) {
    const { data, error } = await this.sb.storage.from(bucket).createSignedUrl(path, 3600);
    if (error || !data) {
      throw new Error(
        /not found|object/i.test(error?.message ?? '')
          ? 'Die Aufnahme ist nicht (mehr) vorhanden oder du darfst sie nicht anhören.'
          : `Aufnahme: ${error?.message}`,
      );
    }
    return data.signedUrl;
  }

  async uploadGreeting(wav: Blob) {
    const path = `org/greeting-${Date.now()}.wav`;
    const up = await this.sb.storage.from('voicemails').upload(path, wav, { contentType: 'audio/wav' });
    if (up.error) throw new Error(`Hochladen fehlgeschlagen: ${up.error.message}`);
    return path;
  }

  // ---------- Power Dialer ----------
  async dialerClaim(leadId: ID) {
    return must(await this.sb.rpc('dialer_claim', { p_lead: leadId, p_seconds: 600 }), 'Power Dialer') as boolean;
  }

  async dialerRelease(leadId: ID) {
    await this.sb.rpc('dialer_release', { p_lead: leadId });
  }

  // ---------- Fehlerprotokoll ----------
  async logClientError(message: string, details: Record<string, unknown> = {}) {
    try {
      await this.sb.from('app_logs').insert({ source: 'browser', level: 'error', message: message.slice(0, 2000), details });
    } catch {
      /* Protokoll darf nie selbst Fehler werfen */
    }
  }

  async listLogs(limit = 100) {
    return must(await this.sb.from('app_logs').select('*').order('at', { ascending: false }).limit(limit), 'Protokoll') as AppLog[];
  }

  // ---------- Import ----------
  async importLeads(rows: ImportRow[], opts: ImportOptions, onProgress?: (done: number) => void): Promise<ImportResult> {
    const result: ImportResult = { created: 0, merged: 0, skipped: 0, failed: [] };
    const byPhone = new Map<string, ID>();
    const byName = new Map<string, ID>();
    if (opts.duplicateMode !== 'create') {
      for (let offset = 0; ; offset += 1000) {
        const part = must(
          await this.sb.from('contacts').select('lead_id, phones').range(offset, offset + 999),
          'Dubletten prüfen',
        ) as { lead_id: ID; phones: { number: string }[] }[];
        part.forEach((c) => c.phones.forEach((p) => byPhone.set(p.number, c.lead_id)));
        if (part.length < 1000) break;
      }
      for (let offset = 0; ; offset += 1000) {
        const part = must(
          await this.sb.from('leads').select('id, name, address_zip').range(offset, offset + 999),
          'Dubletten prüfen',
        ) as { id: ID; name: string; address_zip: string | null }[];
        part.forEach((l) => byName.set(`${l.name.trim().toLowerCase()}|${l.address_zip ?? ''}`, l.id));
        if (part.length < 1000) break;
      }
    }

    let done = 0;
    for (const batch of chunks(rows.map((row, i) => ({ row, i })), 100)) {
      const toCreate: { row: ImportRow; i: number; id: ID }[] = [];
      const extraContacts: Record<string, unknown>[] = [];
      for (const item of batch) {
        const phones = item.row.contacts.flatMap((c) => c.phones).map((p) => normalizePhone(p)).filter(Boolean) as string[];
        let existing: ID | undefined;
        if (opts.duplicateMode !== 'create') {
          existing = phones.map((p) => byPhone.get(p)).find(Boolean) ??
            byName.get(`${item.row.lead.name.trim().toLowerCase()}|${item.row.lead.address_zip ?? ''}`);
        }
        if (existing && opts.duplicateMode === 'skip') {
          result.skipped++;
        } else if (existing) {
          for (const c of item.row.contacts) {
            const fresh = c.phones.map((p) => normalizePhone(p) ?? p).filter((p) => !byPhone.has(p));
            if (!fresh.length && !c.emails.length) continue;
            extraContacts.push({
              lead_id: existing,
              name: c.name,
              title: c.title ?? null,
              phones: fresh.map((number) => ({ type: 'office', number })),
              emails: c.emails.map((email) => ({ type: 'office', email })),
            });
            fresh.forEach((p) => byPhone.set(p, existing!));
          }
          result.merged++;
        } else {
          toCreate.push({ ...item, id: uuid() });
        }
      }
      try {
        if (toCreate.length) {
          must(
            await this.sb.from('leads').insert(
              toCreate.map(({ row, id }) => ({
                ...row.lead,
                id,
                status_id: row.lead.status_id ?? opts.statusId ?? this.statuses.find((s) => s.is_default)?.id ?? null,
                owner_id: row.lead.owner_id ?? opts.ownerId,
                source: row.lead.source ?? opts.source,
              })),
            ),
            'Import',
          );
          const contactRows: Record<string, unknown>[] = [];
          const noteRows: Record<string, unknown>[] = [];
          toCreate.forEach(({ row, id }) => {
            row.contacts.forEach((c, ci) => {
              const phones = c.phones.map((p) => normalizePhone(p) ?? p);
              phones.forEach((p) => byPhone.set(p, id));
              contactRows.push({
                lead_id: id,
                name: c.name,
                title: c.title ?? null,
                phones: phones.map((number) => ({ type: 'office', number })),
                emails: c.emails.map((email) => ({ type: 'office', email })),
                sort: ci,
              });
            });
            if (row.note) noteRows.push({ lead_id: id, body: row.note });
            byName.set(`${row.lead.name.trim().toLowerCase()}|${row.lead.address_zip ?? ''}`, id);
          });
          if (contactRows.length) must(await this.sb.from('contacts').insert(contactRows), 'Import Kontakte');
          if (noteRows.length) must(await this.sb.from('notes').insert(noteRows), 'Import Notizen');
          result.created += toCreate.length;
        }
        if (extraContacts.length) must(await this.sb.from('contacts').insert(extraContacts), 'Import Kontakte');
      } catch (e) {
        for (const { i } of toCreate) result.failed.push({ row: i + 1, error: e instanceof Error ? e.message : String(e) });
      }
      done += batch.length;
      onProgress?.(done);
    }
    return result;
  }

  // ---------- Live ----------
  subscribe(table: RealtimeTable, cb: (row: Record<string, unknown>) => void) {
    const channel = this.sb
      .channel(`rt-${table}-${uuid()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table }, (payload) => {
        cb((payload.new && Object.keys(payload.new).length ? payload.new : payload.old) as Record<string, unknown>);
      })
      .subscribe();
    return () => {
      this.sb.removeChannel(channel);
    };
  }

  async invoke<T = Record<string, unknown>>(fn: string, body: Record<string, unknown> = {}): Promise<T> {
    const { data } = await this.sb.auth.getSession();
    const token = data.session?.access_token;
    let res: Response;
    try {
      res = await fetch(`${config.functionsUrl}/${fn}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: config.supabaseKey,
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
      });
    } catch {
      throw new FunctionError('Server nicht erreichbar. Internetverbindung prüfen.', 0);
    }
    const text = await res.text();
    let json: Record<string, unknown> = {};
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      /* keine JSON-Antwort */
    }
    if (!res.ok) {
      const msg = typeof json.error === 'string'
        ? json.error
        : res.status === 404
        ? `Funktion "${fn}" ist nicht installiert (siehe Einrichtung).`
        : `Fehler ${res.status}`;
      throw new FunctionError(msg, res.status);
    }
    return json as T;
  }
}
