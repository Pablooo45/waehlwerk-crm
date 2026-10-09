// Datentypen – entsprechen den Tabellen in supabase/migrations.

export type ID = string;
export type ISODate = string;

export type TeamFunction = 'opener' | 'setter' | 'closer' | 'manager' | 'other';

export interface UserSettings {
  dialerAutoAdvance?: number; // Sekunden bis zum nächsten Lead (Power Dialer)
  dialerPrepare?: number; // Sekunden Vorbereitung vor dem Wählen
  dialerSkipRecent?: boolean;
  inputDeviceId?: string;
  outputDeviceId?: string;
  ringtoneDeviceId?: string;
  notifications?: boolean;
  theme?: 'system' | 'light' | 'dark';
  pinnedViews?: ID[]; // eigene angeheftete Smart Views (zusätzlich zu den Team-Ansichten)
  hiddenViews?: ID[]; // Team-Ansichten, die ich ausgeblendet habe
  leadColumns?: string[]; // Spalten der Leadliste ohne Smart View
  playbackRate?: number;
  enhanceAudio?: boolean;
}

// ---------- Rollen & Rechte ----------

export type Permission =
  | 'manage_organization'
  | 'manage_customizations'
  | 'manage_phone_numbers'
  | 'manage_team_smart_views'
  | 'manage_team_templates'
  | 'manage_workflows'
  | 'bulk_edit'
  | 'bulk_delete'
  | 'bulk_email'
  | 'bulk_workflow'
  | 'import'
  | 'export'
  | 'delete_leads'
  | 'merge_leads'
  | 'edit_restricted_fields'
  | 'manage_others_activities'
  | 'delete_own_activities'
  | 'manage_others_opportunities'
  | 'delete_own_opportunities'
  | 'manage_others_tasks'
  | 'delete_own_tasks'
  | 'calling'
  | 'recordings_listen_all'
  | 'recordings_download'
  | 'recordings_delete'
  | 'call_coach_listen'
  | 'call_coach_barge'
  | 'view_team_reports'
  | 'view_others_inbox'
  | 'use_ai';

export type LeadVisibility = 'all' | 'own' | 'own_and_unassigned';

export interface Role {
  id: string;
  name: string;
  description: string;
  is_builtin: boolean;
  permissions: Permission[];
  lead_visibility: LeadVisibility;
  sort: number;
  created_at: ISODate;
  updated_at: ISODate;
}

export interface Group {
  id: ID;
  name: string;
  color: string;
  created_at: ISODate;
}

export interface GroupMember {
  group_id: ID;
  user_id: ID;
}

export interface Profile {
  id: ID;
  email: string;
  full_name: string;
  role_id: string;
  team_function: TeamFunction;
  phone_number: string | null;
  forward_number: string | null;
  forward_mode: 'never' | 'no_answer' | 'always';
  available: boolean;
  active: boolean;
  color: string;
  settings: UserSettings;
  last_seen_at: ISODate | null;
  created_at: ISODate;
}

// ---------- Organisation ----------

export type RecordingMode = 'off' | 'manual' | 'auto' | 'auto_agent';

export interface CalendlyLink {
  name: string;
  url: string;
  duration?: number;
  owner?: string | null;
  source?: 'calendly' | 'manual';
}

export interface OrgSettings {
  name: string;
  currency: string;
  default_caller_id: string | null;
  local_presence: boolean;
  recording_mode: RecordingMode;
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
  call_script: string;
  dialer_skip_recent_minutes: number;
  meeting_status_id: ID | null;
  calendly_create_leads: boolean;
  calendly_links: CalendlyLink[];
  calendly_connected_at: ISODate | null;
  gcal_calendars: { id: string; label?: string }[];
  gcal_last_sync: ISODate | null;
  gcal_last_error: string | null;
}

export type StatusKind = 'open' | 'won' | 'lost';

export interface LeadStatus {
  id: ID;
  label: string;
  color: string;
  sort: number;
  kind: StatusKind;
  is_default: boolean;
}

export interface CallOutcome {
  key: string;
  label: string;
  description: string;
  color: string;
  sort: number;
  counts_as_connected: boolean;
  is_meeting: boolean;
  next_status_id: ID | null;
  followup_days: number | null;
  active: boolean;
}

export interface Pipeline {
  id: ID;
  name: string;
  sort: number;
}

export interface OpportunityStatus {
  id: ID;
  pipeline_id: ID;
  label: string;
  kind: StatusKind;
  color: string;
  sort: number;
}

export type CustomFieldType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'date'
  | 'datetime'
  | 'choice'
  | 'multichoice'
  | 'checkbox'
  | 'url'
  | 'user';

export type FieldEntity = 'lead' | 'contact' | 'opportunity';

export interface CustomField {
  key: string;
  entity: FieldEntity;
  label: string;
  description: string;
  type: CustomFieldType;
  choices: string[];
  sort: number;
  show_in_list: boolean;
  always_show: boolean; // am Lead auch leer zeigen (sonst erst, wenn ausgefüllt – wie in Close)
  restricted: boolean;
}

// Formulare (Close: Custom Activities)
export interface ActivityField {
  key: string;
  label: string;
  type: Exclude<CustomFieldType, 'url'> | 'url';
  choices?: string[];
  required?: boolean;
  description?: string;
  creates_task?: boolean;
  sets_lead_date?: { field: string; map: Record<string, string> };
}

export interface ActivityType {
  id: ID;
  name: string;
  description: string;
  color: string;
  fields: ActivityField[];
  archived: boolean;
  sort: number;
  created_at: ISODate;
  updated_at: ISODate;
}

export interface CustomActivity {
  id: ID;
  type_id: ID;
  lead_id: ID;
  contact_id: ID | null;
  user_id: ID | null;
  call_id: ID | null;
  data: Record<string, unknown>;
  status: 'draft' | 'published';
  created_at: ISODate;
  updated_at: ISODate;
}

export interface IntegrationLink {
  id: ID;
  name: string;
  url_template: string;
  scope: 'lead' | 'contact';
  sort: number;
}

// ---------- Leads & Kontakte ----------

export type PhoneType = 'office' | 'mobile' | 'direct' | 'fax' | 'other';

export interface PhoneEntry {
  type: PhoneType;
  number: string;
}

export interface EmailEntry {
  type: string;
  email: string;
}

export interface Contact {
  id: ID;
  lead_id: ID;
  name: string;
  title: string | null;
  phones: PhoneEntry[];
  emails: EmailEntry[];
  custom: Record<string, unknown>;
  sort: number;
  created_at: ISODate;
  lead?: { id: ID; name: string; status_id: ID | null; owner_id: ID | null } | null;
}

export interface Lead {
  id: ID;
  name: string;
  status_id: ID | null;
  owner_id: ID | null;
  opener_id: ID | null;
  url: string | null;
  description: string | null;
  address_street: string | null;
  address_zip: string | null;
  address_city: string | null;
  address_state: string | null;
  address_country: string | null;
  source: string | null;
  custom: Record<string, unknown>;
  do_not_call: boolean;
  last_call_at: ISODate | null;
  last_call_outcome: string | null;
  last_connected_at: ISODate | null;
  call_count: number;
  last_activity_at: ISODate | null;
  next_task_due: ISODate | null;
  next_meeting_at: ISODate | null;
  created_by: ID | null;
  created_at: ISODate;
  updated_at: ISODate;
  contacts?: Contact[];
}

export type LeadInput = Partial<
  Pick<
    Lead,
    | 'name'
    | 'status_id'
    | 'owner_id'
    | 'opener_id'
    | 'url'
    | 'description'
    | 'address_street'
    | 'address_zip'
    | 'address_city'
    | 'address_state'
    | 'address_country'
    | 'source'
    | 'custom'
    | 'do_not_call'
  >
>;

// ---------- Telefonie ----------

export type CallStatus =
  | 'initiated'
  | 'queued'
  | 'ringing'
  | 'in-progress'
  | 'completed'
  | 'busy'
  | 'no-answer'
  | 'failed'
  | 'canceled';

export type RecordingStatus = 'none' | 'recording' | 'paused' | 'processing' | 'ready' | 'failed' | 'deleted';
export type TranscriptStatus = 'none' | 'queued' | 'processing' | 'ready' | 'failed';

export interface CallQuality {
  mos?: number | null; // 1–4,5
  jitter?: number | null; // ms
  rtt?: number | null; // ms
  packetLoss?: number | null; // %
  codec?: string | null;
  edge?: string | null;
  warnings?: string[];
}

export interface Call {
  id: ID;
  lead_id: ID | null;
  contact_id: ID | null;
  user_id: ID | null;
  direction: 'outbound' | 'inbound';
  from_number: string | null;
  to_number: string | null;
  status: CallStatus | string;
  outcome: string | null;
  note: string | null;
  started_at: ISODate;
  answered_at: ISODate | null;
  ended_at: ISODate | null;
  duration: number;
  conference_name?: string | null;
  recording_status: RecordingStatus;
  recording_path: string | null;
  recording_duration: number | null;
  recording_format?: string | null;
  recording_channels?: number | null;
  agent_channel?: number | null;
  recording_bytes?: number | null;
  recording_attempts?: number;
  recording_tried_at?: ISODate | null;
  recording_error?: string | null;
  extra_recordings: { sid?: string; path: string; duration?: number | null }[];
  talk_agent_ms?: number | null;
  talk_customer_ms?: number | null;
  quality?: CallQuality | null;
  transcript_status?: TranscriptStatus;
  monitors?: { user_id: ID; mode: 'listen' | 'whisper' | 'barge'; at: ISODate }[];
  is_voicemail: boolean;
  voicemail_drop_id: ID | null;
  dialer_session: ID | null;
  transferred_to?: ID | null;
  created_at: ISODate;
  lead?: { id: ID; name: string } | null;
}

export interface TranscriptSegment {
  speaker: 'agent' | 'customer';
  start: number; // ms
  end: number; // ms
  text: string;
}

export interface CallSummary {
  text: string;
  next_steps?: string[];
  objections?: string[];
  mood?: string | null;
}

export interface CallInsights {
  call_id: ID;
  peaks: { bucket_ms: number; agent: number[]; customer: number[] } | null;
  talk: {
    agent_ms: number;
    customer_ms: number;
    overlap_ms?: number;
    silence_ms?: number;
    longest_customer_ms?: number;
    switches?: number;
  } | null;
  segments: TranscriptSegment[] | null;
  transcript_text: string | null;
  summary: CallSummary | null;
  language: string | null;
  error: string | null;
  updated_at: ISODate;
}

export interface LiveCall {
  call_id: ID;
  user_id: ID | null;
  lead_id: ID | null;
  lead_name: string | null;
  direction: 'outbound' | 'inbound';
  status: string;
  started_at: ISODate;
  answered_at: ISODate | null;
  to_number: string | null;
  from_number: string | null;
  conference: boolean;
}

export interface BusinessHours {
  [day: string]: [string, string][]; // mon..sun → [["08:00","18:00"]]
}

export interface IvrMenu {
  greeting: string;
  options: { digit: string; label: string; action: 'ring' | 'user' | 'group' | 'voicemail' | 'forward'; target?: string | null }[];
  timeout_action?: 'ring' | 'voicemail';
}

export interface PhoneNumberRow {
  number: string;
  label: string;
  twilio_sid?: string | null;
  sms_capable: boolean;
  members: ID[];
  group_id: ID | null;
  ring_mode: 'simultaneous' | 'round_robin';
  ring_timeout: number;
  route_to_owner: boolean;
  available_to_all: boolean;
  forward_to: string | null;
  forward_mode: 'never' | 'no_answer' | 'always' | 'outside_hours';
  business_hours: BusinessHours | null;
  outside_hours_action: 'voicemail' | 'forward' | 'ring';
  greeting_text: string | null;
  greeting_path: string | null;
  ivr: IvrMenu | null;
  record_inbound: boolean | null;
}

export interface VoicemailDrop {
  id: ID;
  user_id: ID | null;
  name: string;
  storage_path: string;
  duration: number | null;
  shared: boolean;
  created_at: ISODate;
}

// ---------- Aktivitäten ----------

export interface Note {
  id: ID;
  lead_id: ID;
  contact_id: ID | null;
  user_id: ID | null;
  body: string;
  mentions: ID[];
  pinned: boolean;
  created_at: ISODate;
  updated_at: ISODate;
}

export type EmailStatus = 'logged' | 'draft' | 'scheduled' | 'sending' | 'sent' | 'failed' | 'received';

export interface Email {
  id: ID;
  lead_id: ID;
  contact_id: ID | null;
  user_id: ID | null;
  account_id?: ID | null;
  direction: 'outbound' | 'inbound';
  status: EmailStatus;
  from_address?: string | null;
  to_address: string | null;
  cc?: string | null;
  bcc?: string | null;
  subject: string;
  body: string;
  is_html?: boolean;
  attachments?: { name: string; size: number; path: string }[];
  template_id?: ID | null;
  send_at?: ISODate | null;
  sent_at?: ISODate | null;
  opens?: number;
  last_opened_at?: ISODate | null;
  error?: string | null;
  created_at: ISODate;
}

export interface EmailAccount {
  id: ID;
  user_id: ID;
  email: string;
  display_name: string;
  imap_host: string;
  imap_port: number;
  smtp_host: string;
  smtp_port: number;
  username: string;
  signature: string;
  sync_enabled: boolean;
  last_sync_at: ISODate | null;
  last_error: string | null;
  created_at: ISODate;
}

export interface SmsMessage {
  id: ID;
  lead_id: ID | null;
  contact_id: ID | null;
  user_id: ID | null;
  direction: 'outbound' | 'inbound';
  from_number: string | null;
  to_number: string | null;
  body: string;
  status: 'draft' | 'scheduled' | 'queued' | 'sending' | 'sent' | 'delivered' | 'undelivered' | 'failed' | 'received';
  send_at: ISODate | null;
  error: string | null;
  created_at: ISODate;
  lead?: { id: ID; name: string } | null;
}

export interface EmailTemplate {
  id: ID;
  name: string;
  kind: 'email' | 'sms';
  subject: string;
  body: string;
  is_html: boolean;
  shared: boolean;
  created_by: ID | null;
  created_at: ISODate;
}

export type TaskType = 'todo' | 'call' | 'email' | 'missed_call' | 'voicemail' | 'meeting_followup' | 'workflow';

// Kurzer Verweis auf einen Lead (Name und – wo geladen – Status, z. B. für die Inbox)
export interface LeadRef {
  id: ID;
  name: string;
  status_id?: ID | null;
}

export interface Task {
  id: ID;
  lead_id: ID | null;
  contact_id: ID | null;
  assigned_to: ID | null;
  created_by: ID | null;
  type: TaskType;
  title: string;
  note?: string | null;
  due_at: ISODate | null;
  done: boolean;
  done_at: ISODate | null;
  done_by: ID | null;
  call_id: ID | null;
  created_at: ISODate;
  lead?: LeadRef | null;
}

export type MeetingStatus = 'scheduled' | 'canceled' | 'rescheduled' | 'completed' | 'no_show';

export interface Meeting {
  id: ID;
  lead_id: ID | null;
  contact_id: ID | null;
  source: 'calendly' | 'google' | 'crm';
  external_id: string | null;
  calendar_id: string | null;
  title: string;
  description: string | null;
  location: string | null;
  join_url: string | null;
  starts_at: ISODate;
  ends_at: ISODate | null;
  host_user_id: ID | null;
  host_email: string | null;
  host_name: string | null;
  set_by: ID | null;
  invitee_name: string | null;
  invitee_email: string | null;
  invitee_phone: string | null;
  status: MeetingStatus;
  outcome_note: string | null;
  created_at: ISODate;
  lead?: { id: ID; name: string } | null;
}

export interface Opportunity {
  id: ID;
  lead_id: ID;
  contact_id: ID | null;
  user_id: ID | null;
  status_id: ID | null;
  value: number;
  value_period: 'one_time' | 'monthly' | 'annual';
  confidence: number;
  expected_close: string | null;
  note: string | null;
  custom: Record<string, unknown>;
  closed_at: ISODate | null;
  created_at: ISODate;
  updated_at: ISODate;
  lead?: { id: ID; name: string } | null;
}

export interface LeadEvent {
  id: ID;
  lead_id: ID;
  user_id: ID | null;
  type: string;
  data: Record<string, unknown>;
  created_at: ISODate;
}

export type CommentTarget = 'note' | 'call' | 'email' | 'meeting' | 'activity' | 'opportunity' | 'task' | 'event';

export interface Comment {
  id: ID;
  lead_id: ID;
  target_kind: CommentTarget;
  target_id: ID;
  user_id: ID | null;
  body: string;
  at_ms: number | null;
  mentions: ID[];
  created_at: ISODate;
  updated_at: ISODate;
}

export type NotificationKind =
  | 'mention'
  | 'comment'
  | 'assigned'
  | 'missed_call'
  | 'voicemail'
  | 'sms'
  | 'email'
  | 'meeting'
  | 'workflow'
  | 'system';

export interface AppNotification {
  id: ID;
  user_id: ID;
  kind: NotificationKind;
  lead_id: ID | null;
  ref_kind: string | null;
  ref_id: ID | null;
  actor_id: ID | null;
  title: string;
  body: string;
  created_at: ISODate;
  read_at: ISODate | null;
  done_at: ISODate | null;
  snoozed_until: ISODate | null;
  lead?: LeadRef | null;
}

export type TimelineKind = 'call' | 'note' | 'email' | 'sms' | 'meeting' | 'event' | 'task' | 'activity';

export type TimelineItem =
  | { kind: 'call'; id: ID; lead_id: ID; user_id: ID | null; at: ISODate; data: Call }
  | { kind: 'note'; id: ID; lead_id: ID; user_id: ID | null; at: ISODate; data: Note }
  | { kind: 'email'; id: ID; lead_id: ID; user_id: ID | null; at: ISODate; data: Email }
  | { kind: 'sms'; id: ID; lead_id: ID; user_id: ID | null; at: ISODate; data: SmsMessage }
  | { kind: 'meeting'; id: ID; lead_id: ID; user_id: ID | null; at: ISODate; data: Meeting }
  | { kind: 'event'; id: ID; lead_id: ID; user_id: ID | null; at: ISODate; data: LeadEvent }
  | { kind: 'task'; id: ID; lead_id: ID; user_id: ID | null; at: ISODate; data: Task }
  | { kind: 'activity'; id: ID; lead_id: ID; user_id: ID | null; at: ISODate; data: CustomActivity };

// ---------- Workflows ----------

export type WorkflowTriggerType =
  | 'manual'
  | 'lead_created'
  | 'status_changed'
  | 'call_outcome'
  | 'meeting_booked'
  | 'activity_created'
  | 'opportunity_status';

export type WorkflowStepType = 'email' | 'sms' | 'call' | 'task' | 'update_lead' | 'assign' | 'opportunity' | 'notify' | 'filter';

export interface WorkflowStep {
  id: string;
  type: WorkflowStepType;
  wait: { amount: number; unit: 'minutes' | 'hours' | 'days' };
  config: Record<string, unknown>;
}

export interface Workflow {
  id: ID;
  name: string;
  description: string;
  status: 'draft' | 'active' | 'paused';
  trigger: { type: WorkflowTriggerType; value?: string | null; filters?: { status_ids?: ID[]; owner_ids?: ID[] } };
  steps: WorkflowStep[];
  goal: { type: 'none' | 'status' | 'meeting' | 'replied' | 'outcome'; value?: string | null };
  send_window: { days: number[]; from: string; to: string };
  allow_reenroll: boolean;
  stop_on_reply: boolean;
  sender_mode: 'owner' | 'enroller' | 'fixed';
  sender_user: ID | null;
  created_by: ID | null;
  created_at: ISODate;
  updated_at: ISODate;
}

export interface WorkflowRun {
  id: ID;
  workflow_id: ID;
  lead_id: ID;
  contact_id: ID | null;
  status: 'active' | 'paused' | 'finished' | 'goal_met' | 'canceled' | 'failed';
  step_index: number;
  next_at: ISODate | null;
  started_by: ID | null;
  started_at: ISODate;
  ended_at: ISODate | null;
  end_reason: string | null;
  log: { at: ISODate; step: number; result: string }[];
  lead?: { id: ID; name: string } | null;
}

// ---------- Smart Views / Filter ----------

export type FilterField =
  | 'status'
  | 'owner'
  | 'opener'
  | 'name'
  | 'city'
  | 'zip'
  | 'state'
  | 'source'
  | 'last_call'
  | 'last_outcome'
  | 'reached'
  | 'last_activity'
  | 'call_count'
  | 'next_task'
  | 'meeting'
  | 'created'
  | 'do_not_call'
  | `custom:${string}`;

export interface Condition {
  field: FilterField;
  op: string;
  value?: unknown;
}

export interface FilterSet {
  q?: string;
  match?: 'all' | 'any';
  conditions: Condition[];
}

export type SortField =
  | 'name'
  | 'created_at'
  | 'last_call_at'
  | 'next_task_due'
  | 'last_activity_at'
  | 'call_count'
  | 'next_meeting_at'
  | 'updated_at';

export interface SortSpec {
  field: SortField;
  dir: 'asc' | 'desc';
}

export interface SmartView {
  id: ID;
  name: string;
  description: string;
  kind: 'lead' | 'contact';
  filters: FilterSet;
  sort: SortSpec;
  columns: string[];
  shared: boolean;
  pinned: boolean;
  position: number;
  created_by: ID | null;
  created_at: ISODate;
}

// ---------- Berichte ----------

export interface ActivityRow {
  user_id: ID;
  dials: number;
  reached: number;
  meetings_logged: number;
  talk_seconds: number;
  inbound: number;
  meetings_booked: number;
  meetings_held: number;
  notes: number;
  emails: number;
  sms: number;
  forms: number;
  tasks_done: number;
  opps_created: number;
  deals_won: number;
  won_value: number;
  opened_won: number;
}

export interface DailyRow {
  day: string; // YYYY-MM-DD
  dials: number;
  reached: number;
  meetings: number;
  talk_seconds: number;
}

export interface OutcomeRow {
  outcome: string;
  cnt: number;
}

export interface StatusChangeRow {
  from_status: ID | null;
  to_status: ID | null;
  cnt: number;
}

export interface FunnelRow {
  status_id: ID;
  reached: number;
  reached_value: number;
  current_cnt: number;
  current_value: number;
}

export interface CallHourRow {
  dow: number; // 1 = Montag
  hour: number;
  dials: number;
  reached: number;
}

export interface FormValueRow {
  value: string;
  cnt: number;
}

export interface DuplicatePair {
  lead_a: ID;
  lead_b: ID;
  reasons: string;
}

export interface AppLog {
  id: number;
  at: ISODate;
  source: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  user_id: ID | null;
  message: string;
  details: Record<string, unknown>;
}

export interface RefData {
  me: Profile;
  perms: Permission[];
  visibility: LeadVisibility;
  profiles: Profile[];
  roles: Role[];
  groups: Group[];
  groupMembers: GroupMember[];
  statuses: LeadStatus[];
  outcomes: CallOutcome[];
  pipelines: Pipeline[];
  oppStatuses: OpportunityStatus[];
  customFields: CustomField[];
  activityTypes: ActivityType[];
  integrationLinks: IntegrationLink[];
  org: OrgSettings;
  smartViews: SmartView[];
  phoneNumbers: PhoneNumberRow[];
  templates: EmailTemplate[];
  voicemailDrops: VoicemailDrop[];
  workflows: Workflow[];
  emailAccounts: EmailAccount[];
}
