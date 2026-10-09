// Gemeinsame Schnittstelle für Demo- und Live-Daten.

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
  EmailTemplate,
  FilterSet,
  FormValueRow,
  FunnelRow,
  Group,
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

export interface Page {
  offset: number;
  limit: number;
}

export interface LeadList {
  rows: Lead[];
  total: number;
}

export interface CallFilter {
  userId?: ID | null;
  userIds?: ID[] | null;
  direction?: 'outbound' | 'inbound' | null;
  outcome?: string | null;
  withRecording?: boolean;
  withTranscript?: boolean;
  minDuration?: number | null;
  from?: Date | null;
  to?: Date | null;
  leadId?: ID | null;
  q?: string | null; // Suche in Abschriften
}

export interface ContactFilter {
  q?: string;
  role?: string | null; // Feld „Contact Role“
  page: Page;
}

export interface TaskFilter {
  assignedTo?: ID | 'team' | 'all';
  done?: boolean;
  leadId?: ID;
  dueBefore?: Date;
  dueAfter?: Date;
  types?: Task['type'][];
}

export interface MeetingFilter {
  from: Date;
  to: Date;
  userId?: ID | null; // Gastgeber ODER gelegt von
  leadId?: ID | null;
  includeCanceled?: boolean;
}

export interface OpportunityFilter {
  leadId?: ID;
  open?: boolean;
  pipelineId?: ID | null;
  userId?: ID | null;
  statusIds?: ID[];
}

export interface NotificationFilter {
  userId?: ID;
  box: 'inbox' | 'later' | 'done';
  limit?: number;
}

export interface CallFinalize {
  outcome?: string | null;
  note?: string | null;
  lead_id?: ID | null;
  contact_id?: ID | null;
}

export interface ManualCallInput {
  lead_id: ID;
  contact_id?: ID | null;
  direction: 'outbound' | 'inbound';
  outcome: string | null;
  note: string | null;
  duration: number;
  started_at?: string;
}

export interface CalendarEventInput {
  leadId: ID;
  contactId?: ID | null;
  title: string;
  start: string;
  end: string;
  description?: string;
  hostUserId?: ID | null;
  location?: string | null;
  calendarId?: string;
}

export interface EmailSendInput {
  lead_id: ID;
  contact_id: ID | null;
  to: string;
  cc?: string | null;
  bcc?: string | null;
  subject: string;
  body: string;
  is_html: boolean;
  template_id?: ID | null;
  send_at?: string | null;
  account_id?: ID | null;
  attachments?: { name: string; size: number; path: string }[];
}

export interface SmsSendInput {
  lead_id: ID | null;
  contact_id: ID | null;
  to: string;
  body: string;
  from?: string | null;
  send_at?: string | null;
}

export interface ImportRow {
  lead: LeadInput & { name: string };
  contacts: { name: string; title?: string | null; phones: string[]; emails: string[] }[];
  note?: string | null;
}

export interface ImportOptions {
  duplicateMode: 'skip' | 'merge' | 'create';
  statusId: ID | null;
  ownerId: ID | null;
  source: string | null;
}

export interface ImportResult {
  created: number;
  merged: number;
  skipped: number;
  failed: { row: number; error: string }[];
}

export interface SyncResult {
  ok: boolean;
  upserted?: number;
  unchanged?: number;
  linkedToCalendly?: number;
  errors?: string[];
  skipped?: string;
}

// Hintergrundaufgaben (Workflows, geplante E-Mails, Postfächer, Aufnahmen nachholen …)
export interface JobsState {
  scheduled: boolean;
  lastRun: string | null;
}

export type RealtimeTable = 'calls' | 'tasks' | 'meetings' | 'notifications' | 'sms_messages' | 'emails' | 'call_insights';

// Einstellungs-Tabellen, die über saveConfig/deleteConfig gepflegt werden
export interface ConfigRows {
  roles: Role;
  groups: Group;
  lead_statuses: LeadStatus;
  call_outcomes: CallOutcome;
  pipelines: Pipeline;
  opportunity_statuses: OpportunityStatus;
  custom_fields: CustomField;
  activity_types: ActivityType;
  integration_links: IntegrationLink;
  email_templates: EmailTemplate;
  workflows: Workflow;
  phone_numbers: PhoneNumberRow;
  smart_views: SmartView;
}

export type ConfigTable = keyof ConfigRows;

export const CONFIG_KEYS: { [T in ConfigTable]: keyof ConfigRows[T] & string } = {
  roles: 'id',
  groups: 'id',
  lead_statuses: 'id',
  call_outcomes: 'key',
  pipelines: 'id',
  opportunity_statuses: 'id',
  custom_fields: 'key',
  activity_types: 'id',
  integration_links: 'id',
  email_templates: 'id',
  workflows: 'id',
  phone_numbers: 'number',
  smart_views: 'id',
};

export interface Store {
  readonly mode: 'demo' | 'live';

  // Anmeldung
  currentUser(): Promise<Profile | null>;
  signIn(email: string, password: string): Promise<Profile>;
  signOut(): Promise<void>;
  sendPasswordReset(email: string): Promise<void>;
  changePassword(password: string): Promise<void>;
  onSignedOut(cb: () => void): () => void;

  // Stammdaten
  loadRef(): Promise<RefData>;

  // Leads
  listLeads(filter: FilterSet, sort: SortSpec, page: Page): Promise<LeadList>;
  listLeadIds(filter: FilterSet, sort: SortSpec, limit: number): Promise<ID[]>;
  countLeads(filter: FilterSet): Promise<number>;
  searchLeads(q: string, limit?: number): Promise<Lead[]>;
  getLead(id: ID): Promise<Lead | null>;
  getLeads(ids: ID[]): Promise<Lead[]>;
  createLead(input: LeadInput & { name: string }, contacts?: Partial<Contact>[]): Promise<Lead>;
  updateLead(id: ID, patch: LeadInput): Promise<void>;
  bulkUpdateLeads(ids: ID[], patch: LeadInput): Promise<number>;
  deleteLeads(ids: ID[]): Promise<number>;
  saveContact(contact: Partial<Contact> & { lead_id: ID }): Promise<Contact>;
  deleteContact(id: ID): Promise<void>;
  findLeadByPhone(number: string): Promise<{ lead: Lead; contact: Contact | null } | null>;
  listContacts(filter: ContactFilter): Promise<{ rows: Contact[]; total: number }>;
  findDuplicates(leadId?: ID | null, limit?: number): Promise<DuplicatePair[]>;
  dismissDuplicate(a: ID, b: ID): Promise<void>;
  mergeLeads(keepId: ID, mergeId: ID): Promise<void>;

  // Verlauf, Notizen, Kommentare, Formulare
  timeline(leadId: ID, limit?: number): Promise<TimelineItem[]>;
  addNote(leadId: ID, body: string, contactId?: ID | null, mentions?: ID[]): Promise<Note>;
  updateNote(id: ID, patch: Partial<Pick<Note, 'body' | 'pinned' | 'mentions'>>): Promise<void>;
  deleteNote(id: ID): Promise<void>;
  logEmail(input: { lead_id: ID; contact_id: ID | null; to_address: string | null; subject: string; body: string }): Promise<Email>;
  listComments(leadId: ID): Promise<Comment[]>;
  listCommentsFor(kind: CommentTarget, targetId: ID): Promise<Comment[]>;
  addComment(input: { lead_id: ID; target_kind: CommentTarget; target_id: ID; body: string; at_ms?: number | null; mentions?: ID[] }): Promise<Comment>;
  deleteComment(id: ID): Promise<void>;
  saveActivity(a: Partial<CustomActivity> & { type_id: ID; lead_id: ID; data: Record<string, unknown> }): Promise<CustomActivity>;
  deleteActivity(id: ID): Promise<void>;
  listActivities(filter: { typeId?: ID | null; userId?: ID | null; from?: Date; to?: Date; limit?: number }): Promise<(CustomActivity & { lead?: { id: ID; name: string } | null })[]>;

  // Anrufe & Aufnahmen
  finalizeCall(callId: ID, patch: CallFinalize): Promise<void>;
  logManualCall(input: ManualCallInput): Promise<Call>;
  getCall(id: ID): Promise<Call | null>;
  listCalls(filter: CallFilter, page: Page): Promise<{ rows: Call[]; total: number }>;
  recordingUrl(path: string): Promise<string>;
  getCallInsights(callId: ID): Promise<CallInsights | null>;
  requestTranscript(callId: ID): Promise<void>;
  deleteRecording(callId: ID): Promise<void>;
  swapRecordingChannels(callId: ID): Promise<void>;
  retryRecording(callId: ID): Promise<void>; // fehlgeschlagene Aufnahme erneut bei Twilio holen
  saveCallQuality(callId: ID, quality: CallQuality): Promise<void>;
  liveCalls(): Promise<LiveCall[]>;

  // Aufgaben
  listTasks(filter: TaskFilter): Promise<Task[]>;
  saveTask(task: Partial<Task> & { title: string }): Promise<Task>;
  setTaskDone(id: ID, done: boolean): Promise<void>;
  deleteTask(id: ID): Promise<void>;

  // Inbox & Benachrichtigungen
  listNotifications(filter: NotificationFilter): Promise<AppNotification[]>;
  updateNotifications(ids: ID[], patch: { read?: boolean; done?: boolean; snoozed_until?: string | null }): Promise<void>;
  inboxCounts(userId?: ID): Promise<{ tasks_due: number; notifications_new: number }>;

  // Termine
  listMeetings(filter: MeetingFilter): Promise<Meeting[]>;
  saveMeeting(meeting: Partial<Meeting> & { starts_at: string; title: string }): Promise<Meeting>;
  setMeetingStatus(id: ID, status: MeetingStatus, note?: string | null): Promise<void>;
  createCalendarEvent(input: CalendarEventInput): Promise<{ meetingId: ID; htmlLink: string | null }>;
  syncCalendars(force?: boolean): Promise<SyncResult>;
  scheduleJobs(): Promise<void>;
  jobsState(): Promise<JobsState | null>; // nur für Admins, sonst null

  // Pipeline
  listOpportunities(filter?: OpportunityFilter): Promise<Opportunity[]>;
  saveOpportunity(o: Partial<Opportunity> & { lead_id: ID }): Promise<Opportunity>;
  deleteOpportunity(id: ID): Promise<void>;

  // Smart Views
  saveSmartView(v: Partial<SmartView> & { name: string; filters: FilterSet; sort: SortSpec }): Promise<SmartView>;
  deleteSmartView(id: ID): Promise<void>;

  // Berichte
  reportActivity(from: Date, to: Date, users?: ID[] | null): Promise<ActivityRow[]>;
  reportDaily(from: Date, to: Date, userId?: ID | null, users?: ID[] | null): Promise<DailyRow[]>;
  reportOutcomes(from: Date, to: Date, userId?: ID | null, users?: ID[] | null): Promise<OutcomeRow[]>;
  reportStatusCounts(): Promise<{ status_id: ID | null; cnt: number }[]>;
  reportStatusChanges(from: Date, to: Date, users?: ID[] | null): Promise<StatusChangeRow[]>;
  reportFunnel(from: Date, to: Date, pipelineId: ID, users?: ID[] | null): Promise<FunnelRow[]>;
  reportCallHours(from: Date, to: Date, users?: ID[] | null): Promise<CallHourRow[]>;
  reportFormValues(typeId: ID, field: string, from: Date, to: Date, users?: ID[] | null): Promise<FormValueRow[]>;

  // Einstellungen
  saveConfig<T extends ConfigTable>(table: T, row: Partial<ConfigRows[T]>, isNew?: boolean): Promise<ConfigRows[T]>;
  deleteConfig(table: ConfigTable, key: string): Promise<void>;
  setGroupMembers(groupId: ID, userIds: ID[]): Promise<void>;
  updateOrg(patch: Partial<OrgSettings>): Promise<void>;
  updateMyProfile(patch: Partial<Pick<Profile, 'full_name' | 'settings' | 'color' | 'available' | 'forward_number' | 'forward_mode'>>): Promise<void>;
  heartbeat(): Promise<void>; // „zuletzt online“ aktualisieren
  teamPresence(): Promise<Pick<Profile, 'id' | 'available' | 'last_seen_at'>[]>;
  admin<T = Record<string, unknown>>(action: string, payload?: Record<string, unknown>): Promise<T>;

  // Workflows
  listWorkflowRuns(filter: { workflowId?: ID; leadId?: ID; status?: WorkflowRun['status'][]; limit?: number }): Promise<WorkflowRun[]>;
  enrollInWorkflow(workflowId: ID, leadIds: ID[], contactId?: ID | null): Promise<number>;
  setWorkflowRunStatus(runId: ID, status: 'active' | 'paused' | 'canceled'): Promise<void>;

  // E-Mail & SMS
  sendEmail(input: EmailSendInput): Promise<Email>;
  bulkEmail(leadIds: ID[], templateId: ID, sendAt?: string | null): Promise<{ queued: number; skipped: number }>;
  sendSms(input: SmsSendInput): Promise<SmsMessage>;
  listSms(filter: { leadId?: ID; limit?: number }): Promise<SmsMessage[]>;
  emailAccount<T = Record<string, unknown>>(action: 'save' | 'test' | 'delete' | 'sync', payload: Record<string, unknown>): Promise<T>;
  uploadAttachment(file: File): Promise<{ name: string; size: number; path: string }>;
  attachmentUrl(path: string): Promise<string>;

  // Mailbox-Nachrichten & Ansagen
  uploadVoicemailDrop(name: string, wav: Blob, seconds: number, shared: boolean): Promise<VoicemailDrop>;
  deleteVoicemailDrop(drop: VoicemailDrop): Promise<void>;
  audioUrl(bucket: 'voicemails' | 'recordings', path: string): Promise<string>;
  uploadGreeting(wav: Blob): Promise<string>;

  // Power Dialer
  dialerClaim(leadId: ID): Promise<boolean>;
  dialerRelease(leadId: ID): Promise<void>;

  // Fehlerprotokoll
  logClientError(message: string, details?: Record<string, unknown>): Promise<void>;
  listLogs(limit?: number): Promise<AppLog[]>;

  // Import
  importLeads(rows: ImportRow[], opts: ImportOptions, onProgress?: (done: number) => void): Promise<ImportResult>;

  // Live-Aktualisierung
  subscribe(table: RealtimeTable, cb: (row: Record<string, unknown>) => void): () => void;

  // Server-Funktionen (nur live; Demo simuliert)
  invoke<T = Record<string, unknown>>(fn: string, body?: Record<string, unknown>): Promise<T>;
}

export type { PhoneNumberRow };
