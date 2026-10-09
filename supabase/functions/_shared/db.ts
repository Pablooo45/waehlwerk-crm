// Datenbankzugriff für die Edge Functions (mit Service-Schlüssel, umgeht RLS).
// Telefonie-Funktionen gehen über das Interface `Repo`, damit sie ohne Datenbank testbar bleiben.

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.117.2';
import { HttpError } from './http.ts';

export interface OrgSettings {
  name: string;
  currency: string;
  default_caller_id: string | null;
  local_presence: boolean;
  recording_mode: 'off' | 'manual' | 'auto' | 'auto_agent';
  recording_format: 'wav' | 'mp3';
  recording_retention_days: number | null;
  recording_announcement: boolean;
  recording_announcement_text: string;
  delete_twilio_recordings: boolean;
  transcription_enabled: boolean;
  summary_enabled: boolean;
  conference_mode: boolean;
  allowed_prefixes: string[];
  inbound_ring_timeout: number;
  dialer_ring_timeout: number;
  missed_call_tasks: boolean;
  voicemail_drop_outcome: string | null;
  voicemail_greeting_text: string;
  voicemail_greeting_path: string | null;
  meeting_status_id: string | null;
  calendly_create_leads: boolean;
  calendly_links: unknown[];
  calendly_connected_at: string | null;
  gcal_calendars: { id: string; label?: string }[];
  gcal_last_sync: string | null;
  gcal_last_error: string | null;
}

export interface Profile {
  id: string;
  email: string;
  full_name: string;
  role_id: string;
  team_function: string;
  phone_number: string | null;
  forward_number: string | null;
  forward_mode: 'never' | 'no_answer' | 'always';
  available: boolean;
  active: boolean;
  color?: string;
  last_seen_at?: string | null;
}

export interface IvrMenu {
  greeting: string;
  options: { digit: string; label: string; action: 'ring' | 'user' | 'group' | 'voicemail' | 'forward'; target?: string | null }[];
  timeout_action?: 'ring' | 'voicemail';
}

export interface PhoneNumberRow {
  number: string;
  label: string;
  twilio_sid: string | null;
  sms_capable: boolean;
  members: string[];
  group_id: string | null;
  ring_mode: 'simultaneous' | 'round_robin';
  ring_timeout: number;
  route_to_owner: boolean;
  available_to_all: boolean;
  forward_to: string | null;
  forward_mode: 'never' | 'no_answer' | 'always' | 'outside_hours';
  business_hours: Record<string, [string, string][]> | null;
  outside_hours_action: 'voicemail' | 'forward' | 'ring';
  greeting_text: string | null;
  greeting_path: string | null;
  ivr: IvrMenu | null;
  record_inbound: boolean | null;
  rr_pointer: number;
}

export interface Monitor {
  user_id: string;
  mode: 'listen' | 'whisper' | 'barge';
  at: string;
  call_sid?: string | null;
  ended_at?: string | null;
}

export interface CallRow {
  id: string;
  lead_id: string | null;
  contact_id: string | null;
  user_id: string | null;
  direction: 'outbound' | 'inbound';
  from_number: string | null;
  to_number: string | null;
  status: string;
  outcome: string | null;
  note: string | null;
  started_at: string;
  answered_at?: string | null;
  ended_at?: string | null;
  duration: number;
  twilio_call_sid: string | null;
  twilio_child_sid: string | null;
  conference_sid?: string | null;
  conference_name?: string | null;
  recording_status: string;
  recording_sid: string | null;
  recording_path: string | null;
  recording_duration: number | null;
  recording_format?: string | null;
  recording_channels?: number | null;
  agent_channel?: number | null;
  recording_bytes?: number | null;
  recording_attempts?: number;
  recording_tried_at?: string | null;
  recording_error?: string | null;
  extra_recordings: { sid?: string; path: string; duration?: number | null }[];
  talk_agent_ms?: number | null;
  talk_customer_ms?: number | null;
  transcript_status?: string;
  monitors?: Monitor[];
  is_voicemail: boolean;
  dialer_session?: string | null;
  voicemail_drop_id?: string | null;
  transferred_to?: string | null;
  parent_call_id?: string | null;
}

export interface PhoneMatch {
  contact_id: string;
  contact_name: string;
  lead_id: string;
  lead_name: string;
  owner_id: string | null;
  do_not_call?: boolean;
}

export interface LeadInfo {
  id: string;
  name: string;
  owner_id: string | null;
  status_id: string | null;
  status_kind: 'open' | 'won' | 'lost' | null;
  do_not_call?: boolean;
}

export interface MeetingRow {
  id?: string;
  lead_id?: string | null;
  contact_id?: string | null;
  source: 'calendly' | 'google' | 'crm';
  external_id: string;
  calendar_id?: string | null;
  google_event_id?: string | null;
  title?: string;
  description?: string | null;
  location?: string | null;
  join_url?: string | null;
  starts_at: string;
  ends_at?: string | null;
  host_user_id?: string | null;
  host_email?: string | null;
  host_name?: string | null;
  set_by?: string | null;
  invitee_name?: string | null;
  invitee_email?: string | null;
  invitee_phone?: string | null;
  status?: string;
  raw?: unknown;
}

export interface InsightsRow {
  call_id: string;
  peaks?: unknown;
  talk?: unknown;
  transcript_job?: string | null;
  segments?: unknown;
  transcript_text?: string | null;
  summary?: unknown;
  language?: string | null;
  error?: string | null;
}

export interface Repo {
  org(): Promise<OrgSettings>;
  updateOrg(patch: Partial<OrgSettings>): Promise<void>;
  profile(id: string): Promise<Profile | null>;
  profileByEmail(email: string): Promise<Profile | null>;
  activeMembers(): Promise<Profile[]>;
  permissions(userId: string): Promise<Set<string>>;
  groupMembership(): Promise<Record<string, string[]>>;
  busyUserIds(): Promise<Set<string>>;
  phoneNumber(number: string): Promise<PhoneNumberRow | null>;
  phoneNumbers(): Promise<PhoneNumberRow[]>;
  bumpRoundRobin(number: string): Promise<number>;
  anyPhoneNumber(): Promise<string | null>;
  findByPhone(e164: string): Promise<PhoneMatch | null>;
  findByEmail(email: string): Promise<PhoneMatch | null>;
  findLeadsByName(name: string): Promise<{ id: string; name: string }[]>;
  lead(id: string): Promise<LeadInfo | null>;
  createLead(row: Record<string, unknown>): Promise<string>;
  updateLead(id: string, patch: Record<string, unknown>): Promise<void>;
  addContact(row: Record<string, unknown>): Promise<string>;
  upsertCall(row: Partial<CallRow> & { id: string }): Promise<void>;
  call(id: string): Promise<CallRow | null>;
  callBySid(sid: string): Promise<CallRow | null>;
  callByConference(name: string): Promise<CallRow | null>;
  updateCall(id: string, patch: Partial<CallRow>): Promise<void>;
  advanceCall(id: string, status: string, childSid?: string | null, duration?: number | null, userId?: string | null): Promise<void>;
  upsertInsights(row: InsightsRow): Promise<void>;
  insights(callId: string): Promise<InsightsRow | null>;
  insertTask(row: Record<string, unknown>): Promise<boolean>; // false = gibt es schon (z. B. verpasster Anruf)
  convertCallTask(callId: string, type: string, title: string): Promise<boolean>;
  notify(userId: string | null, kind: string, leadId: string | null, refKind: string | null, refId: string | null, title: string, body?: string): Promise<void>;
  voicemailDrop(id: string): Promise<{ id: string; user_id: string | null; shared: boolean; storage_path: string; name: string } | null>;
  upsertMeeting(row: MeetingRow): Promise<string>;
  meetingByExternal(source: string, externalId: string): Promise<MeetingRow | null>;
  findCalendlyMeetingAt(startsAt: string, emails: string[]): Promise<MeetingRow | null>;
  updateMeeting(id: string, patch: Partial<MeetingRow>): Promise<void>;
  googleMeetings(calendarId: string): Promise<Map<string, MeetingRow>>;
  upload(bucket: string, path: string, bytes: Uint8Array, contentType: string): Promise<void>;
  removeFiles(bucket: string, paths: string[]): Promise<void>;
  signedUrl(bucket: string, path: string, seconds: number): Promise<string>;
  secret(name: string): Promise<string | null>;
  setSecret(name: string, value: string): Promise<void>;
  log(source: string, level: 'debug' | 'info' | 'warn' | 'error', message: string, details?: unknown): Promise<void>;
}

export function getServiceKey(): string {
  const direct = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SECRET_KEY') ||
    Deno.env.get('CRM_SERVICE_KEY');
  if (direct) return direct;
  const many = Deno.env.get('SUPABASE_SECRET_KEYS');
  if (many) {
    try {
      const parsed = JSON.parse(many);
      const first = Object.values(parsed)[0];
      if (typeof first === 'string') return first;
    } catch {
      /* ignorieren */
    }
  }
  throw new Error('Service-Schlüssel fehlt (SUPABASE_SERVICE_ROLE_KEY).');
}

export function supabaseUrl(): string {
  const url = Deno.env.get('SUPABASE_URL');
  if (!url) throw new Error('SUPABASE_URL fehlt.');
  return url.replace(/\/$/, '');
}

export function functionUrl(name: string, query?: Record<string, string | null | undefined>): string {
  const base = Deno.env.get('CRM_FUNCTIONS_URL') || `${supabaseUrl()}/functions/v1`;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query ?? {})) if (v != null && v !== '') qs.set(k, v);
  const s = qs.toString();
  return `${base}/${name}${s ? `?${s}` : ''}`;
}

// Region, in der Twilio-Aufrufe laufen sollen: dort, wo die Datenbank steht (Frankfurt).
// Sonst liefe die Funktion beim Twilio-Rechenzentrum in den USA und jede Datenbankabfrage
// ginge zweimal über den Atlantik – das verzögert den Rufaufbau.
export function functionRegion(): string | null {
  const v = (Deno.env.get('CRM_FUNCTION_REGION') ?? 'eu-central-1').trim();
  return v && v !== 'off' ? v : null;
}

// Adresse für Twilio (Webhooks): Region immer als letzter Parameter
export function hookUrl(name: string, query?: Record<string, string | null | undefined>): string {
  const region = functionRegion();
  return functionUrl(name, region ? { ...query, forceFunctionRegion: region } : query);
}

let cachedClient: SupabaseClient | null = null;
export function serviceClient(): SupabaseClient {
  if (!cachedClient) {
    cachedClient = createClient(supabaseUrl(), getServiceKey(), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return cachedClient;
}

export function check<T>(res: { data: T; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data;
}

const secretCache = new Map<string, { value: string | null; until: number }>();
let orgCache: { value: OrgSettings; until: number } | null = null;
let allPermsCache: string[] | null = null;
const permsCache = new Map<string, { value: Set<string>; until: number }>();

export class SupabaseRepo implements Repo {
  constructor(readonly db: SupabaseClient = serviceClient()) {}

  async org(): Promise<OrgSettings> {
    if (orgCache && orgCache.until > Date.now()) return orgCache.value;
    const data = check(await this.db.from('org_settings').select('*').eq('id', 1).single(), 'Einstellungen');
    orgCache = { value: data as OrgSettings, until: Date.now() + 15_000 };
    return data as OrgSettings;
  }

  async updateOrg(patch: Partial<OrgSettings>): Promise<void> {
    check(await this.db.from('org_settings').update(patch).eq('id', 1), 'Einstellungen speichern');
    orgCache = null;
  }

  async profile(id: string): Promise<Profile | null> {
    const res = await this.db.from('profiles').select('*').eq('id', id).maybeSingle();
    return check(res, 'Profil') as Profile | null;
  }

  async profileByEmail(email: string): Promise<Profile | null> {
    if (!email) return null;
    const res = await this.db.from('profiles').select('*').eq('email', email.toLowerCase()).maybeSingle();
    return check(res, 'Profil') as Profile | null;
  }

  async activeMembers(): Promise<Profile[]> {
    const res = await this.db.from('profiles').select('*').eq('active', true).order('created_at');
    return check(res, 'Team') as Profile[];
  }

  // Rechte einer Person (Admin hat immer alle)
  async permissions(userId: string): Promise<Set<string>> {
    const hit = permsCache.get(userId);
    if (hit && hit.until > Date.now()) return hit.value;
    const res = await this.db.from('profiles').select('role_id, active, role:roles(permissions)').eq('id', userId).maybeSingle();
    const row = check(res, 'Rechte') as unknown as { role_id: string; active: boolean; role: { permissions: string[] } | null } | null;
    let perms: string[] = [];
    if (row?.active) {
      if (row.role_id === 'admin') {
        if (!allPermsCache) allPermsCache = check(await this.db.rpc('all_permissions'), 'Rechte') as string[];
        perms = allPermsCache;
      } else perms = row.role?.permissions ?? [];
    }
    const value = new Set(perms);
    permsCache.set(userId, { value, until: Date.now() + 30_000 });
    return value;
  }

  async groupMembership(): Promise<Record<string, string[]>> {
    const res = await this.db.from('group_members').select('group_id, user_id');
    const out: Record<string, string[]> = {};
    for (const r of check(res, 'Gruppen') as { group_id: string; user_id: string }[]) (out[r.group_id] ??= []).push(r.user_id);
    return out;
  }

  // Wer telefoniert gerade? (Für eingehende Anrufe: nicht bei Besetzten klingeln)
  async busyUserIds(): Promise<Set<string>> {
    const res = await this.db.from('calls').select('user_id').is('ended_at', null).eq('status', 'in-progress')
      .gt('started_at', new Date(Date.now() - 6 * 3_600_000).toISOString()).not('user_id', 'is', null);
    return new Set((check(res, 'Laufende Anrufe') as { user_id: string }[]).map((r) => r.user_id));
  }

  async phoneNumber(number: string): Promise<PhoneNumberRow | null> {
    const res = await this.db.from('phone_numbers').select('*').eq('number', number).maybeSingle();
    return check(res, 'Nummer') as PhoneNumberRow | null;
  }

  async phoneNumbers(): Promise<PhoneNumberRow[]> {
    const res = await this.db.from('phone_numbers').select('*').order('created_at');
    return check(res, 'Nummern') as PhoneNumberRow[];
  }

  async bumpRoundRobin(number: string): Promise<number> {
    const row = await this.phoneNumber(number);
    const current = row?.rr_pointer ?? 0;
    await this.db.from('phone_numbers').update({ rr_pointer: current + 1 }).eq('number', number);
    return current;
  }

  async anyPhoneNumber(): Promise<string | null> {
    const res = await this.db.from('phone_numbers').select('number').order('created_at').limit(1);
    const rows = check(res, 'Nummern') as { number: string }[];
    return rows[0]?.number ?? null;
  }

  private async matchContact(column: 'phones' | 'emails', value: unknown): Promise<PhoneMatch | null> {
    const res = await this.db
      .from('contacts')
      .select('id, name, lead_id, lead:leads!inner(id, name, owner_id, updated_at, do_not_call)')
      .contains(column, JSON.stringify([value]))
      .limit(5);
    const rows = check(res, 'Kontaktsuche') as unknown as {
      id: string;
      name: string;
      lead_id: string;
      lead: { id: string; name: string; owner_id: string | null; updated_at: string; do_not_call: boolean };
    }[];
    if (!rows.length) return null;
    rows.sort((a, b) => (b.lead.updated_at > a.lead.updated_at ? 1 : -1));
    const r = rows[0];
    return { contact_id: r.id, contact_name: r.name, lead_id: r.lead.id, lead_name: r.lead.name, owner_id: r.lead.owner_id, do_not_call: r.lead.do_not_call };
  }

  findByPhone(e164: string) {
    return this.matchContact('phones', { number: e164 });
  }

  findByEmail(email: string) {
    return this.matchContact('emails', { email: email.toLowerCase().trim() });
  }

  async findLeadsByName(name: string) {
    const res = await this.db.from('leads').select('id, name').ilike('name', name.trim()).limit(3);
    return check(res, 'Leadsuche') as { id: string; name: string }[];
  }

  async lead(id: string): Promise<LeadInfo | null> {
    const res = await this.db.from('leads').select('id, name, owner_id, status_id, do_not_call, status:lead_statuses(kind)')
      .eq('id', id).maybeSingle();
    const row = check(res, 'Lead') as unknown as
      | { id: string; name: string; owner_id: string | null; status_id: string | null; do_not_call: boolean; status: { kind: string } | null }
      | null;
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      owner_id: row.owner_id,
      status_id: row.status_id,
      status_kind: (row.status?.kind as LeadInfo['status_kind']) ?? null,
      do_not_call: row.do_not_call,
    };
  }

  async createLead(row: Record<string, unknown>): Promise<string> {
    const res = await this.db.from('leads').insert(row).select('id').single();
    return (check(res, 'Lead anlegen') as { id: string }).id;
  }

  async updateLead(id: string, patch: Record<string, unknown>): Promise<void> {
    check(await this.db.from('leads').update(patch).eq('id', id), 'Lead speichern');
  }

  async addContact(row: Record<string, unknown>): Promise<string> {
    const res = await this.db.from('contacts').insert(row).select('id').single();
    return (check(res, 'Kontakt anlegen') as { id: string }).id;
  }

  async upsertCall(row: Partial<CallRow> & { id: string }): Promise<void> {
    check(await this.db.from('calls').upsert(row, { onConflict: 'id' }), 'Anruf speichern');
  }

  async call(id: string): Promise<CallRow | null> {
    const res = await this.db.from('calls').select('*').eq('id', id).maybeSingle();
    return check(res, 'Anruf') as CallRow | null;
  }

  async callBySid(sid: string): Promise<CallRow | null> {
    const res = await this.db.from('calls').select('*').or(`twilio_call_sid.eq.${sid},twilio_child_sid.eq.${sid}`)
      .limit(1).maybeSingle();
    return check(res, 'Anruf') as CallRow | null;
  }

  async callByConference(name: string): Promise<CallRow | null> {
    const res = await this.db.from('calls').select('*').eq('conference_name', name).order('started_at', { ascending: true })
      .limit(1).maybeSingle();
    return check(res, 'Anruf') as CallRow | null;
  }

  async updateCall(id: string, patch: Partial<CallRow>): Promise<void> {
    check(await this.db.from('calls').update(patch).eq('id', id), 'Anruf aktualisieren');
  }

  async advanceCall(id: string, status: string, childSid?: string | null, duration?: number | null, userId?: string | null) {
    check(
      await this.db.rpc('call_status_advance', {
        p_call: id,
        p_status: status,
        p_child_sid: childSid ?? null,
        p_duration: duration ?? null,
        p_user: userId ?? null,
      }),
      'Anrufstatus',
    );
  }

  async upsertInsights(row: InsightsRow): Promise<void> {
    check(await this.db.from('call_insights').upsert({ ...row, updated_at: new Date().toISOString() }, { onConflict: 'call_id' }), 'Auswertung speichern');
  }

  async insights(callId: string): Promise<InsightsRow | null> {
    const res = await this.db.from('call_insights').select('*').eq('call_id', callId).maybeSingle();
    return check(res, 'Auswertung') as InsightsRow | null;
  }

  async insertTask(row: Record<string, unknown>): Promise<boolean> {
    const res = await this.db.from('tasks').insert(row);
    if (res.error?.code === '23505') return false;
    check(res, 'Aufgabe anlegen');
    return true;
  }

  async convertCallTask(callId: string, type: string, title: string): Promise<boolean> {
    const res = await this.db.from('tasks').update({ type, title }).eq('call_id', callId).eq('done', false)
      .select('id');
    const rows = check(res, 'Aufgabe ändern') as { id: string }[];
    return rows.length > 0;
  }

  async notify(userId: string | null, kind: string, leadId: string | null, refKind: string | null, refId: string | null, title: string, body = '') {
    if (!userId) return;
    const res = await this.db.rpc('notify', {
      p_user: userId,
      p_kind: kind,
      p_lead: leadId,
      p_ref_kind: refKind,
      p_ref_id: refId,
      p_title: title,
      p_body: body,
    });
    if (res.error) await this.log('notify', 'warn', `Benachrichtigung fehlgeschlagen: ${res.error.message}`, { kind, userId });
  }

  async voicemailDrop(id: string) {
    const res = await this.db.from('voicemail_drops').select('id, user_id, shared, storage_path, name').eq('id', id)
      .maybeSingle();
    return check(res, 'Mailbox-Nachricht');
  }

  async upsertMeeting(row: MeetingRow): Promise<string> {
    const res = await this.db.from('meetings').upsert(row, { onConflict: 'source,external_id' }).select('id').single();
    return (check(res, 'Termin speichern') as { id: string }).id;
  }

  async meetingByExternal(source: string, externalId: string): Promise<MeetingRow | null> {
    const res = await this.db.from('meetings').select('*').eq('source', source).eq('external_id', externalId)
      .maybeSingle();
    return check(res, 'Termin') as MeetingRow | null;
  }

  async findCalendlyMeetingAt(startsAt: string, emails: string[]): Promise<MeetingRow | null> {
    const t = new Date(startsAt).getTime();
    const res = await this.db.from('meetings').select('*').eq('source', 'calendly')
      .gte('starts_at', new Date(t - 60_000).toISOString())
      .lte('starts_at', new Date(t + 60_000).toISOString())
      .limit(10);
    const rows = check(res, 'Termin') as MeetingRow[];
    if (!rows.length) return null;
    const lower = emails.map((e) => e.toLowerCase());
    return rows.find((r) => r.invitee_email && lower.includes(r.invitee_email.toLowerCase())) ??
      (rows.length === 1 ? rows[0] : null);
  }

  async updateMeeting(id: string, patch: Partial<MeetingRow>): Promise<void> {
    check(await this.db.from('meetings').update(patch).eq('id', id), 'Termin aktualisieren');
  }

  async googleMeetings(calendarId: string): Promise<Map<string, MeetingRow>> {
    const out = new Map<string, MeetingRow>();
    let from = 0;
    for (;;) {
      const res = await this.db.from('meetings')
        .select('id, lead_id, contact_id, set_by, status, raw, external_id, source, starts_at, host_user_id')
        .eq('source', 'google').eq('calendar_id', calendarId)
        .range(from, from + 999);
      const rows = check(res, 'Termine') as MeetingRow[];
      rows.forEach((r) => out.set(r.external_id, r));
      if (rows.length < 1000) break;
      from += 1000;
    }
    return out;
  }

  async upload(bucket: string, path: string, bytes: Uint8Array, contentType: string): Promise<void> {
    const { error } = await this.db.storage.from(bucket).upload(path, bytes, { contentType, upsert: true });
    if (error) throw new Error(`Speichern fehlgeschlagen: ${error.message}`);
  }

  async removeFiles(bucket: string, paths: string[]): Promise<void> {
    if (!paths.length) return;
    const { error } = await this.db.storage.from(bucket).remove(paths);
    if (error) throw new Error(`Löschen fehlgeschlagen: ${error.message}`);
  }

  async signedUrl(bucket: string, path: string, seconds: number): Promise<string> {
    const { data, error } = await this.db.storage.from(bucket).createSignedUrl(path, seconds);
    if (error || !data) throw new Error(`Link konnte nicht erstellt werden: ${error?.message}`);
    return data.signedUrl;
  }

  async secret(name: string): Promise<string | null> {
    const env = Deno.env.get(name);
    if (env) return env;
    const hit = secretCache.get(name);
    if (hit && hit.until > Date.now()) return hit.value;
    const res = await this.db.rpc('kv_get', { p_key: name });
    if (res.error) throw new Error(`Geheimnis ${name}: ${res.error.message}`);
    const value = (res.data as string | null) || null;
    secretCache.set(name, { value, until: Date.now() + 60_000 });
    return value;
  }

  async setSecret(name: string, value: string): Promise<void> {
    check(await this.db.rpc('kv_set', { p_key: name, p_value: value }), `Geheimnis ${name}`);
    secretCache.set(name, { value: value || null, until: Date.now() + 60_000 });
  }

  async log(source: string, level: 'debug' | 'info' | 'warn' | 'error', message: string, details?: unknown) {
    try {
      await this.db.from('app_logs').insert({
        source,
        level,
        message: message.slice(0, 2000),
        details: details ?? {},
        user_id: null,
      });
    } catch (e) {
      console.error('Log fehlgeschlagen', e);
    }
    if (level === 'error') console.error(`[${source}] ${message}`, details ?? '');
  }
}

// ---------------------------------------------------------------------------
// Angemeldete Person + Rechte
// ---------------------------------------------------------------------------
export interface Caller extends Profile {
  perms: Set<string>;
  can(p: string): boolean;
  isAdmin: boolean;
}

export async function requireUser(req: Request, repo: SupabaseRepo): Promise<Caller> {
  const auth = req.headers.get('Authorization') ?? '';
  const token = auth.replace(/^Bearer\s+/i, '');
  if (!token) throw new HttpError(401, 'Nicht angemeldet.');
  const { data, error } = await repo.db.auth.getUser(token);
  if (error || !data?.user) throw new HttpError(401, 'Sitzung abgelaufen – bitte neu anmelden.');
  const profile = await repo.profile(data.user.id);
  if (!profile || !profile.active) throw new HttpError(403, 'Dein Zugang ist nicht freigeschaltet.');
  const perms = await repo.permissions(profile.id);
  return { ...profile, perms, can: (p: string) => perms.has(p), isAdmin: perms.has('manage_organization') };
}

export async function requirePerm(req: Request, repo: SupabaseRepo, perm: string, message = 'Keine Berechtigung.'): Promise<Caller> {
  const user = await requireUser(req, repo);
  if (!user.can(perm)) throw new HttpError(403, message);
  return user;
}

export async function requireAdmin(req: Request, repo: SupabaseRepo): Promise<Caller> {
  return requirePerm(req, repo, 'manage_organization', 'Nur für Admins.');
}

// Zeitplan-Aufrufe (pg_cron) tragen ein geheimes Token im Header
export async function isCronRequest(req: Request, repo: Repo): Promise<boolean> {
  const got = req.headers.get('x-crm-cron');
  if (!got) return false;
  const expected = await repo.secret('CRON_TOKEN');
  return !!expected && got === expected;
}
