// Nur für Tests: In-Memory-Datenbank, die das Repo-Interface nachbildet.

import type { CallRow, InsightsRow, LeadInfo, MeetingRow, OrgSettings, PhoneMatch, PhoneNumberRow, Profile, Repo } from './db.ts';

export const DEFAULT_ORG: OrgSettings = {
  name: 'Test GmbH',
  currency: 'EUR',
  default_caller_id: '+4969000000',
  local_presence: false,
  recording_mode: 'manual',
  recording_format: 'wav',
  recording_retention_days: null,
  recording_announcement: false,
  recording_announcement_text: 'Dieses Gespräch wird aufgezeichnet.',
  delete_twilio_recordings: true,
  transcription_enabled: false,
  summary_enabled: false,
  conference_mode: false,
  allowed_prefixes: ['+49', '+43', '+41'],
  inbound_ring_timeout: 25,
  dialer_ring_timeout: 30,
  missed_call_tasks: true,
  voicemail_drop_outcome: 'nicht_erreicht',
  voicemail_greeting_text: 'Bitte Nachricht hinterlassen.',
  voicemail_greeting_path: null,
  meeting_status_id: 'status-meeting',
  calendly_create_leads: true,
  calendly_links: [],
  calendly_connected_at: null,
  gcal_calendars: [],
  gcal_last_sync: null,
  gcal_last_error: null,
};

export const ALL_PERMS = [
  'manage_organization', 'manage_customizations', 'manage_phone_numbers', 'manage_team_smart_views', 'manage_team_templates',
  'manage_workflows', 'bulk_edit', 'bulk_delete', 'bulk_email', 'bulk_workflow', 'import', 'export', 'delete_leads', 'merge_leads',
  'edit_restricted_fields', 'manage_others_activities', 'delete_own_activities', 'manage_others_opportunities',
  'delete_own_opportunities', 'manage_others_tasks', 'delete_own_tasks', 'calling', 'recordings_listen_all', 'recordings_download',
  'recordings_delete', 'call_coach_listen', 'call_coach_barge', 'view_team_reports', 'view_others_inbox', 'use_ai',
];

export function number(n: string, extra: Partial<PhoneNumberRow> = {}): PhoneNumberRow {
  return {
    number: n,
    label: '',
    twilio_sid: null,
    sms_capable: true,
    members: [],
    group_id: null,
    ring_mode: 'simultaneous',
    ring_timeout: 25,
    route_to_owner: true,
    available_to_all: true,
    forward_to: null,
    forward_mode: 'never',
    business_hours: null,
    outside_hours_action: 'voicemail',
    greeting_text: null,
    greeting_path: null,
    ivr: null,
    record_inbound: null,
    rr_pointer: 0,
    ...extra,
  };
}

export function member(id: string, name: string, extra: Partial<Profile> = {}): Profile {
  return {
    id,
    email: `${name.toLowerCase()}@firma.de`,
    full_name: name,
    role_id: 'user',
    team_function: 'opener',
    phone_number: null,
    forward_number: null,
    forward_mode: 'never',
    available: true,
    active: true,
    last_seen_at: new Date().toISOString(),
    ...extra,
  };
}

export class FakeRepo implements Repo {
  orgSettings: OrgSettings = { ...DEFAULT_ORG };
  profiles: Profile[] = [];
  perms = new Map<string, Set<string>>();
  groups: Record<string, string[]> = {};
  numbers: PhoneNumberRow[] = [];
  contacts: { id: string; lead_id: string; name: string; phones: string[]; emails: string[] }[] = [];
  leads: (LeadInfo & { source?: string })[] = [];
  calls = new Map<string, CallRow>();
  insightsRows = new Map<string, InsightsRow>();
  tasks: Record<string, unknown>[] = [];
  notifications: { user: string | null; kind: string; title: string; body: string }[] = [];
  meetings: (MeetingRow & { id: string })[] = [];
  uploads: { bucket: string; path: string; size: number; contentType: string; bytes: Uint8Array }[] = [];
  removed: { bucket: string; path: string }[] = [];
  secrets = new Map<string, string>();
  logs: { source: string; level: string; message: string }[] = [];
  drops: { id: string; user_id: string | null; shared: boolean; storage_path: string; name: string }[] = [];
  private seq = 0;

  id(prefix: string) {
    this.seq++;
    return `${prefix}-${this.seq}`;
  }

  async org() {
    return this.orgSettings;
  }
  async updateOrg(patch: Partial<OrgSettings>) {
    this.orgSettings = { ...this.orgSettings, ...patch };
  }
  async profile(id: string) {
    return this.profiles.find((p) => p.id === id) ?? null;
  }
  async profileByEmail(email: string) {
    return this.profiles.find((p) => p.email === email.toLowerCase()) ?? null;
  }
  async activeMembers() {
    return this.profiles.filter((p) => p.active);
  }
  async permissions(userId: string) {
    const p = this.profiles.find((x) => x.id === userId);
    if (!p?.active) return new Set<string>();
    if (p.role_id === 'admin') return new Set(ALL_PERMS);
    return this.perms.get(userId) ?? new Set(['calling', 'delete_own_activities', 'delete_own_tasks', 'use_ai']);
  }
  async groupMembership() {
    return this.groups;
  }
  async busyUserIds() {
    return new Set([...this.calls.values()].filter((c) => c.status === 'in-progress' && !c.ended_at && c.user_id).map((c) => c.user_id!));
  }
  async phoneNumber(n: string) {
    return this.numbers.find((x) => x.number === n) ?? null;
  }
  async phoneNumbers() {
    return this.numbers;
  }
  async bumpRoundRobin(n: string) {
    const row = this.numbers.find((x) => x.number === n);
    const cur = row?.rr_pointer ?? 0;
    if (row) row.rr_pointer = cur + 1;
    return cur;
  }
  async anyPhoneNumber() {
    return this.numbers[0]?.number ?? null;
  }
  private toMatch(c: FakeRepo['contacts'][number]): PhoneMatch {
    const lead = this.leads.find((l) => l.id === c.lead_id)!;
    return { contact_id: c.id, contact_name: c.name, lead_id: lead.id, lead_name: lead.name, owner_id: lead.owner_id, do_not_call: lead.do_not_call };
  }
  async findByPhone(e164: string) {
    const c = this.contacts.find((c) => c.phones.includes(e164));
    return c ? this.toMatch(c) : null;
  }
  async findByEmail(email: string) {
    const c = this.contacts.find((c) => c.emails.includes(email.toLowerCase()));
    return c ? this.toMatch(c) : null;
  }
  async findLeadsByName(name: string) {
    return this.leads.filter((l) => l.name.toLowerCase() === name.toLowerCase()).map((l) => ({ id: l.id, name: l.name }));
  }
  async lead(id: string) {
    return this.leads.find((l) => l.id === id) ?? null;
  }
  async createLead(row: Record<string, unknown>) {
    const id = crypto.randomUUID();
    this.leads.push({
      id,
      name: String(row.name),
      owner_id: (row.owner_id as string) ?? null,
      status_id: (row.status_id as string) ?? null,
      status_kind: 'open',
      source: row.source as string,
    });
    return id;
  }
  async updateLead(id: string, patch: Record<string, unknown>) {
    const l = this.leads.find((l) => l.id === id);
    if (l) Object.assign(l, patch);
  }
  async addContact(row: Record<string, unknown>) {
    const id = crypto.randomUUID();
    this.contacts.push({
      id,
      lead_id: String(row.lead_id),
      name: String(row.name ?? ''),
      phones: ((row.phones as { number: string }[]) ?? []).map((p) => p.number),
      emails: ((row.emails as { email: string }[]) ?? []).map((e) => e.email),
    });
    return id;
  }
  async upsertCall(row: Partial<CallRow> & { id: string }) {
    const old = this.calls.get(row.id);
    this.calls.set(row.id, {
      lead_id: null,
      contact_id: null,
      user_id: null,
      direction: 'outbound',
      from_number: null,
      to_number: null,
      status: 'initiated',
      outcome: null,
      note: null,
      started_at: new Date().toISOString(),
      answered_at: null,
      ended_at: null,
      duration: 0,
      twilio_call_sid: null,
      twilio_child_sid: null,
      conference_sid: null,
      conference_name: null,
      recording_status: 'none',
      recording_sid: null,
      recording_path: null,
      recording_duration: null,
      extra_recordings: [],
      transcript_status: 'none',
      monitors: [],
      is_voicemail: false,
      ...old,
      ...row,
    } as CallRow);
  }
  async call(id: string) {
    const c = this.calls.get(id);
    return c ? structuredClone(c) : null;
  }
  async callBySid(sid: string) {
    return [...this.calls.values()].find((c) => c.twilio_call_sid === sid || c.twilio_child_sid === sid) ?? null;
  }
  async callByConference(name: string) {
    return [...this.calls.values()].find((c) => c.conference_name === name) ?? null;
  }
  async updateCall(id: string, patch: Partial<CallRow>) {
    const c = this.calls.get(id);
    if (c) this.calls.set(id, { ...c, ...patch });
  }
  // wie public.call_status_advance: nur vorwärts
  async advanceCall(id: string, status: string, childSid?: string | null, duration?: number | null, userId?: string | null) {
    const c = this.calls.get(id);
    if (!c) return;
    const rank = (s: string) => ({ initiated: 0, queued: 0, ringing: 1, 'in-progress': 2, answered: 2 } as Record<string, number>)[s] ?? 3;
    const nr = rank(status);
    if (nr > rank(c.status)) c.status = status === 'answered' ? 'in-progress' : status;
    if (nr === 2 && !c.answered_at) c.answered_at = new Date().toISOString();
    if (nr === 3 && !c.ended_at) c.ended_at = new Date().toISOString();
    c.twilio_child_sid = c.twilio_child_sid ?? childSid ?? null;
    c.duration = Math.max(c.duration, duration ?? 0);
    if (userId) c.user_id = userId;
  }
  async upsertInsights(row: InsightsRow) {
    this.insightsRows.set(row.call_id, { ...(this.insightsRows.get(row.call_id) ?? {}), ...row });
  }
  async insights(callId: string) {
    return this.insightsRows.get(callId) ?? null;
  }
  async insertTask(row: Record<string, unknown>) {
    // wie der Datenbank-Index: je Anruf höchstens eine Aufgabe „verpasst/Mailbox“
    if (row.call_id && ['missed_call', 'voicemail'].includes(String(row.type))) {
      if (this.tasks.some((t) => t.call_id === row.call_id && ['missed_call', 'voicemail'].includes(String(t.type)))) return false;
    }
    this.tasks.push({ id: this.id('task'), done: false, ...row });
    return true;
  }
  async convertCallTask(callId: string, type: string, title: string) {
    const t = this.tasks.find((t) => t.call_id === callId && !t.done);
    if (!t) return false;
    t.type = type;
    t.title = title;
    return true;
  }
  async notify(userId: string | null, kind: string, _leadId: string | null, _refKind: string | null, _refId: string | null, title: string, body = '') {
    if (!userId) return;
    this.notifications.push({ user: userId, kind, title, body });
  }
  async voicemailDrop(id: string) {
    return this.drops.find((d) => d.id === id) ?? null;
  }
  async upsertMeeting(row: MeetingRow) {
    const existing = this.meetings.find((m) => m.source === row.source && m.external_id === row.external_id);
    if (existing) {
      Object.assign(existing, row);
      return existing.id;
    }
    const id = crypto.randomUUID();
    this.meetings.push({ ...row, id });
    return id;
  }
  async meetingByExternal(source: string, externalId: string) {
    return this.meetings.find((m) => m.source === source && m.external_id === externalId) ?? null;
  }
  async findCalendlyMeetingAt(startsAt: string, emails: string[]) {
    const t = new Date(startsAt).getTime();
    return this.meetings.find((m) =>
      m.source === 'calendly' && Math.abs(new Date(m.starts_at).getTime() - t) <= 60_000 &&
      (!emails.length || (m.invitee_email && emails.includes(m.invitee_email)))
    ) ?? null;
  }
  async updateMeeting(id: string, patch: Partial<MeetingRow>) {
    const m = this.meetings.find((m) => m.id === id);
    if (m) Object.assign(m, patch);
  }
  async googleMeetings(calendarId: string) {
    const out = new Map<string, MeetingRow>();
    this.meetings.filter((m) => m.source === 'google' && m.calendar_id === calendarId)
      .forEach((m) => out.set(m.external_id, m));
    return out;
  }
  async upload(bucket: string, path: string, bytes: Uint8Array, contentType: string) {
    this.uploads.push({ bucket, path, size: bytes.length, contentType, bytes });
  }
  async removeFiles(bucket: string, paths: string[]) {
    paths.forEach((path) => this.removed.push({ bucket, path }));
  }
  async signedUrl(bucket: string, path: string) {
    return `https://storage.example/${bucket}/${path}?token=x`;
  }
  async secret(name: string) {
    return this.secrets.get(name) ?? null;
  }
  async setSecret(name: string, value: string) {
    this.secrets.set(name, value);
  }
  async log(source: string, level: string, message: string) {
    this.logs.push({ source, level, message });
  }
}

export const fnUrl = (name: string, q?: Record<string, string | null | undefined>) => {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(q ?? {})) if (v) qs.set(k, v);
  const s = qs.toString();
  return `https://test.supabase.co/functions/v1/${name}${s ? `?${s}` : ''}`;
};

export function assert(cond: unknown, msg = 'Bedingung nicht erfüllt'): asserts cond {
  if (!cond) throw new Error(msg);
}

export function assertEquals<T>(actual: T, expected: T, msg = '') {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg}\n  erwartet: ${e}\n  erhalten: ${a}`);
}

export async function assertRejects(fn: () => Promise<unknown>, includes: string) {
  try {
    await fn();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!msg.includes(includes)) throw new Error(`Falsche Fehlermeldung: ${msg} (erwartet: …${includes}…)`);
    return;
  }
  throw new Error(`Kein Fehler, erwartet: …${includes}…`);
}
