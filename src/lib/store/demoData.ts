// Beispieldaten für den Demo-Modus (alle Apotheken und Personen sind erfunden).
// Aufbau wie euer Close-Konto: Status, Pipelines, Ergebnisse, Felder, Formulare,
// Smart Views und Vorlagen entsprechen der Einrichtung bei Salus Digital.

import { DEMO_SCRIPTS, scriptDurationSeconds } from '../audio/demoAudio.ts';
import { addDays, startOfDay } from '../dates.ts';
import { ALL_PERMISSIONS } from '../perms.ts';
import type {
  ActivityType,
  AppNotification,
  Call,
  CallOutcome,
  Comment,
  Contact,
  CustomActivity,
  CustomField,
  Email,
  EmailAccount,
  EmailTemplate,
  Group,
  GroupMember,
  IntegrationLink,
  Lead,
  LeadEvent,
  LeadStatus,
  Meeting,
  Note,
  Opportunity,
  OpportunityStatus,
  OrgSettings,
  Permission,
  PhoneNumberRow,
  Pipeline,
  Profile,
  Role,
  SmartView,
  SmsMessage,
  Task,
  VoicemailDrop,
  Workflow,
  WorkflowRun,
} from '../types.ts';

export interface DemoDb {
  version: number;
  profiles: Profile[];
  roles: Role[];
  groups: Group[];
  groupMembers: GroupMember[];
  org: OrgSettings;
  statuses: LeadStatus[];
  outcomes: CallOutcome[];
  pipelines: Pipeline[];
  oppStatuses: OpportunityStatus[];
  customFields: CustomField[];
  activityTypes: ActivityType[];
  integrationLinks: IntegrationLink[];
  leads: Lead[];
  contacts: Contact[];
  calls: Call[];
  notes: Note[];
  emails: Email[];
  sms: SmsMessage[];
  tasks: Task[];
  meetings: Meeting[];
  opportunities: Opportunity[];
  activities: CustomActivity[];
  comments: Comment[];
  notifications: AppNotification[];
  events: LeadEvent[];
  smartViews: SmartView[];
  templates: EmailTemplate[];
  drops: VoicemailDrop[];
  numbers: PhoneNumberRow[];
  workflows: Workflow[];
  runs: WorkflowRun[];
  emailAccounts: EmailAccount[];
  dismissed: [string, string][];
  callScripts: Record<string, { key: string; seed: number }>;
}

export const DEMO_VERSION = 8;

/** Wochenende vermeiden: Samstag/Sonntag auf Montag (dir = 1) bzw. Freitag (dir = -1) schieben. */
function weekday(d: Date, dir: 1 | -1): Date {
  const day = d.getDay();
  if (day === 6) return addDays(d, dir === 1 ? 2 : -1);
  if (day === 0) return addDays(d, dir === 1 ? 1 : -2);
  return d;
}

// Reproduzierbarer Zufall
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const U = {
  alex: '0d7c0000-0000-4000-8000-000000000001',
  mia: '0d7c0000-0000-4000-8000-000000000002',
  jonas: '0d7c0000-0000-4000-8000-000000000003',
  lea: '0d7c0000-0000-4000-8000-000000000004',
  tom: '0d7c0000-0000-4000-8000-000000000005',
};
export const DEMO_USERS = U;

export const S = {
  kunde: '5a000000-0000-4000-8000-000000000001',
  neu: '5a000000-0000-4000-8000-000000000002',
  wv: '5a000000-0000-4000-8000-000000000003',
  setting: '5a000000-0000-4000-8000-000000000004',
  closing: '5a000000-0000-4000-8000-000000000005',
  kpk: '5a000000-0000-4000-8000-000000000006',
};

const P = {
  sales: '9a000000-0000-4000-8000-000000000001',
  sc: '9a000000-0000-4000-8000-000000000002',
};

const O = {
  sTerminiert: '0f000000-0000-4000-8000-000000000001',
  sClosing: '0f000000-0000-4000-8000-000000000002',
  sFollow: '0f000000-0000-4000-8000-000000000003',
  sKunde: '0f000000-0000-4000-8000-000000000004',
  sNicht: '0f000000-0000-4000-8000-000000000005',
  cSetting: '0f000000-0000-4000-8000-000000000011',
  cNoShow: '0f000000-0000-4000-8000-000000000012',
  cDurch: '0f000000-0000-4000-8000-000000000013',
  cClosing: '0f000000-0000-4000-8000-000000000014',
  cAngebot: '0f000000-0000-4000-8000-000000000015',
  cGewonnen: '0f000000-0000-4000-8000-000000000016',
  cVerloren: '0f000000-0000-4000-8000-000000000017',
};

export const AT = {
  kg: 'ac000000-0000-4000-8000-000000000001',
  mg: 'ac000000-0000-4000-8000-000000000002',
  wv: 'ac000000-0000-4000-8000-000000000003',
};

const W = {
  info: 'b0000000-0000-4000-8000-000000000001',
  setting: 'b0000000-0000-4000-8000-000000000002',
  wv: 'b0000000-0000-4000-8000-000000000003',
};

const TPL = {
  kg: '6e000000-0000-4000-8000-000000000001',
  mg: '6e000000-0000-4000-8000-000000000002',
  sms: '6e000000-0000-4000-8000-000000000003',
};

const BUILTIN_DATE = '2026-06-01T08:00:00.000Z';

function role(id: string, name: string, description: string, permissions: Permission[], visibility: Role['lead_visibility'], sort: number, builtin: boolean): Role {
  return { id, name, description, is_builtin: builtin, permissions: [...permissions].sort(), lead_visibility: visibility, sort, created_at: BUILTIN_DATE, updated_at: BUILTIN_DATE };
}

export function builtinRoles(): Role[] {
  return [
    role('admin', 'Admin', 'Darf alles, auch Benutzer, Rollen, Telefonie und Abrechnung verwalten.', ALL_PERMISSIONS, 'all', 10, true),
    role('superuser', 'Super User', 'Darf alles außer die Organisation selbst verwalten (Benutzer, Rollen, Telefonie-Einstellungen).', ALL_PERMISSIONS.filter((p) => p !== 'manage_organization'), 'all', 20, true),
    role('user', 'User', 'Normales Teammitglied: telefoniert, bearbeitet Leads und sieht Team-Berichte.', [
      'use_ai', 'bulk_email', 'import', 'bulk_workflow', 'calling', 'delete_leads', 'delete_own_activities', 'delete_own_opportunities',
      'delete_own_tasks', 'manage_others_activities', 'manage_others_opportunities', 'manage_others_tasks', 'merge_leads',
      'recordings_listen_all', 'recordings_download', 'view_team_reports',
    ], 'all', 30, true),
    role('restricted', 'Eingeschränkt', 'Telefoniert und pflegt eigene Aktivitäten, ohne Löschen, Export und fremde Aufnahmen.', [
      'use_ai', 'calling', 'delete_own_activities', 'delete_own_opportunities', 'delete_own_tasks',
    ], 'all', 40, true),
  ];
}

function profile(id: string, name: string, email: string, roleId: string, fn: Profile['team_function'], color: string, phone: string | null): Profile {
  return {
    id,
    email,
    full_name: name,
    role_id: roleId,
    team_function: fn,
    phone_number: phone,
    forward_number: null,
    forward_mode: 'never',
    available: true,
    active: true,
    color,
    settings: { dialerAutoAdvance: 3, dialerPrepare: 1, dialerSkipRecent: true },
    last_seen_at: null,
    created_at: BUILTIN_DATE,
  };
}

// Stadt, PLZ, Vorwahl, Bundesland
const CITIES: [string, string, string, string][] = [
  ['Stuttgart', '70173', '711', 'Baden-Württemberg'],
  ['Freiburg im Breisgau', '79098', '761', 'Baden-Württemberg'],
  ['Konstanz', '78462', '7531', 'Baden-Württemberg'],
  ['Singen', '78224', '7731', 'Baden-Württemberg'],
  ['Radolfzell', '78315', '7732', 'Baden-Württemberg'],
  ['Lörrach', '79539', '7621', 'Baden-Württemberg'],
  ['Weil am Rhein', '79576', '7621', 'Baden-Württemberg'],
  ['Waldshut-Tiengen', '79761', '7751', 'Baden-Württemberg'],
  ['Bad Säckingen', '79713', '7761', 'Baden-Württemberg'],
  ['Heilbronn', '74072', '7131', 'Baden-Württemberg'],
  ['Karlsruhe', '76133', '721', 'Baden-Württemberg'],
  ['Ulm', '89073', '731', 'Baden-Württemberg'],
  ['Hamburg', '20095', '40', 'Hamburg'],
  ['Hamburg', '22765', '40', 'Hamburg'],
  ['Kiel', '24103', '431', 'Schleswig-Holstein'],
  ['Lübeck', '23552', '451', 'Schleswig-Holstein'],
  ['Flensburg', '24937', '461', 'Schleswig-Holstein'],
  ['Bremen', '28195', '421', 'Bremen'],
  ['Lüneburg', '21335', '4131', 'Niedersachsen'],
  ['Oldenburg', '26122', '441', 'Niedersachsen'],
  ['Nürnberg', '90402', '911', 'Bayern'],
  ['Erlangen', '91052', '9131', 'Bayern'],
  ['Fürth', '90762', '911', 'Bayern'],
  ['Regensburg', '93047', '941', 'Bayern'],
  ['Bamberg', '96047', '951', 'Bayern'],
  ['Würzburg', '97070', '931', 'Bayern'],
  ['Bayreuth', '95444', '921', 'Bayern'],
  ['Amberg', '92224', '9621', 'Bayern'],
  ['Erfurt', '99084', '361', 'Thüringen'],
  ['Weimar', '99423', '3643', 'Thüringen'],
  ['Jena', '07743', '3641', 'Thüringen'],
  ['Leipzig', '04109', '341', 'Sachsen'],
  ['Dresden', '01067', '351', 'Sachsen'],
  ['Chemnitz', '09111', '371', 'Sachsen'],
  ['Potsdam', '14467', '331', 'Brandenburg'],
  ['Cottbus', '03046', '355', 'Brandenburg'],
  ['Rostock', '18055', '381', 'Mecklenburg-Vorpommern'],
  ['Schwerin', '19053', '385', 'Mecklenburg-Vorpommern'],
  ['Magdeburg', '39104', '391', 'Sachsen-Anhalt'],
  ['Halle (Saale)', '06108', '345', 'Sachsen-Anhalt'],
  ['Frankfurt am Main', '60311', '69', 'Hessen'],
  ['Hanau', '63450', '6181', 'Hessen'],
  ['Köln', '50667', '221', 'Nordrhein-Westfalen'],
  ['Düsseldorf', '40213', '211', 'Nordrhein-Westfalen'],
  ['München', '80331', '89', 'Bayern'],
  ['Mainz', '55116', '6131', 'Rheinland-Pfalz'],
  ['Saarbrücken', '66111', '681', 'Saarland'],
  ['Berlin', '10115', '30', 'Berlin'],
  ['Hannover', '30159', '511', 'Niedersachsen'],
];

const NEW_STATES = ['Brandenburg', 'Mecklenburg-Vorpommern', 'Sachsen', 'Sachsen-Anhalt', 'Thüringen'];

const PREFIXES = [
  'Löwen', 'Stern', 'Adler', 'Rathaus', 'Markt', 'Bahnhof', 'Sonnen', 'Rosen', 'Linden', 'Schloss', 'Park', 'Brunnen',
  'Post', 'Hirsch', 'Einhorn', 'Kronen', 'Glocken', 'Burg', 'Engel', 'Falken', 'Turm', 'Kloster', 'Wiesen', 'Mühlen',
  'Stadt', 'Hof', 'Bären', 'Schwanen', 'Hirschen', 'Dom', 'See', 'Tor',
];
const STREETS = ['Hauptstraße', 'Bahnhofstraße', 'Marktplatz', 'Kirchgasse', 'Lindenallee', 'Schillerstraße', 'Goethestraße', 'Am Rathaus', 'Kaiserstraße', 'Rosenweg'];
const FEMALE = ['Sabine', 'Petra', 'Claudia', 'Andrea', 'Julia', 'Katrin', 'Nicole', 'Anja', 'Birgit', 'Susanne'];
const MALE = ['Thomas', 'Michael', 'Stefan', 'Markus', 'Christian', 'Daniel', 'Florian', 'Tobias', 'Jens', 'Matthias'];
const LAST = ['Krämer', 'Becker', 'Schäfer', 'Wagner', 'Neumann', 'Zimmermann', 'Hartmann', 'Lange', 'Werner', 'Krause', 'Lehmann', 'Kaiser', 'Fuchs', 'Vogel', 'Brandt', 'Roth', 'Seidel', 'Franke'];
const NOTES = [
  'Chefin ist meistens dienstags und donnerstags vormittags da.',
  'Hat schon eine Agentur für Instagram, ist aber unzufrieden mit der Reichweite.',
  'Sekretariat blockt ab – direkt nach dem Inhaber fragen, am besten vor 9 Uhr.',
  'Zweite Filiale in Planung, Thema Personalgewinnung über Social Media.',
  'Rückruf nach den Herbstferien gewünscht.',
  'Nutzt aktuell nur Google-Bewertungen, sonst kein Marketing.',
  'Inhaber laut Impressum geändert – Nachfolgerin seit Juli.',
  'Ist im Apothekenverbund, Entscheidungen laufen über die Zentrale.',
];

export function createDemoDb(now = new Date()): DemoDb {
  const r = rng(20261007);
  const pick = <T,>(arr: T[]) => arr[Math.floor(r() * arr.length)];
  const iso = (d: Date) => d.toISOString();
  const today = startOfDay(now);
  const at = (daysAgo: number, hour: number) => new Date(weekday(addDays(today, -daysAgo), -1).getTime() + hour * 3_600_000);

  const roles: Role[] = [
    ...builtinRoles(),
    role('opener', 'Opener', 'Telefoniert Leads aus dem Pool: sieht eigene und freie Leads, keine fremden Aufnahmen.', [
      'calling', 'delete_own_activities', 'delete_own_tasks', 'use_ai',
    ], 'own_and_unassigned', 50, false),
    role('closer', 'Closer', 'Führt Settings und Closings: alle Leads, alle Aufnahmen, Team-Berichte und Export.', [
      'calling', 'delete_own_activities', 'delete_own_opportunities', 'delete_own_tasks', 'manage_others_opportunities',
      'recordings_listen_all', 'recordings_download', 'view_team_reports', 'export', 'merge_leads', 'call_coach_listen', 'use_ai', 'bulk_email',
    ], 'all', 60, false),
  ];

  const profiles = [
    profile(U.alex, 'Alex Brandt', 'alex@vertrieb.example', 'admin', 'manager', '#2346a0', '+4930555010'),
    profile(U.lea, 'Lea Hoffmann', 'lea@vertrieb.example', 'closer', 'closer', '#7c3aed', null),
    profile(U.jonas, 'Jonas Weber', 'jonas@vertrieb.example', 'user', 'setter', '#b45309', '+4930555012'),
    profile(U.mia, 'Mia Schulte', 'mia@vertrieb.example', 'opener', 'opener', '#0e8a5f', '+4930555011'),
    profile(U.tom, 'Tom Becker', 'tom@vertrieb.example', 'restricted', 'opener', '#0f6e8c', null),
  ];
  profiles.find((p) => p.id === U.mia)!.forward_number = '+491515550123';
  profiles.find((p) => p.id === U.mia)!.forward_mode = 'no_answer';

  const groups: Group[] = [
    { id: '6a000000-0000-4000-8000-000000000001', name: 'Opener-Team', color: '#0e8a5f', created_at: BUILTIN_DATE },
    { id: '6a000000-0000-4000-8000-000000000002', name: 'Closing', color: '#7c3aed', created_at: BUILTIN_DATE },
  ];
  const groupMembers: GroupMember[] = [
    { group_id: groups[0].id, user_id: U.mia },
    { group_id: groups[0].id, user_id: U.jonas },
    { group_id: groups[0].id, user_id: U.tom },
    { group_id: groups[1].id, user_id: U.lea },
    { group_id: groups[1].id, user_id: U.alex },
  ];

  const statuses: LeadStatus[] = [
    { id: S.kunde, label: 'Kunde', color: '#178a3e', sort: 10, kind: 'won', is_default: false },
    { id: S.neu, label: 'Neu', color: '#5b6b7f', sort: 20, kind: 'open', is_default: true },
    { id: S.wv, label: 'Wiedervorlage', color: '#c78a12', sort: 30, kind: 'open', is_default: false },
    { id: S.setting, label: 'Setting vereinbart', color: '#2f8f6b', sort: 40, kind: 'open', is_default: false },
    { id: S.closing, label: 'Closing vereinbart', color: '#4c63d9', sort: 50, kind: 'open', is_default: false },
    { id: S.kpk, label: 'KPK', color: '#8a8f98', sort: 60, kind: 'open', is_default: false },
  ];

  const outcomes: CallOutcome[] = [
    { key: 'nicht_erreicht', label: 'Nicht erreicht', description: 'Entscheider nicht am Apparat (Gatekeeper, Mailbox, keine Antwort) — Tag #NE', color: '#8a8f98', sort: 10, counts_as_connected: false, is_meeting: false, next_status_id: null, followup_days: null, active: true },
    { key: 'entscheider_gesprochen', label: 'Entscheider gesprochen', description: 'Inhaber:in am Apparat, kein Termin — Tag #EG', color: '#c78a12', sort: 20, counts_as_connected: true, is_meeting: false, next_status_id: null, followup_days: null, active: true },
    { key: 'setting_gelegt', label: 'Setting gelegt', description: "Termin vereinbart (KG oder MG) — Tag 'Setting gelegt'", color: '#2f8f6b', sort: 30, counts_as_connected: true, is_meeting: true, next_status_id: S.setting, followup_days: null, active: true },
  ];

  const pipelines: Pipeline[] = [
    { id: P.sales, name: 'Sales', sort: 10 },
    { id: P.sc, name: 'Setting → Closing', sort: 20 },
  ];
  const oppStatuses: OpportunityStatus[] = [
    { id: O.sTerminiert, pipeline_id: P.sales, label: 'Setting terminiert', kind: 'open', color: '#4c7bd9', sort: 10 },
    { id: O.sClosing, pipeline_id: P.sales, label: 'Closing vereinbart', kind: 'open', color: '#8a5cd6', sort: 20 },
    { id: O.sFollow, pipeline_id: P.sales, label: 'Follow-Up', kind: 'open', color: '#c78a12', sort: 30 },
    { id: O.sKunde, pipeline_id: P.sales, label: '✅ Kunde', kind: 'won', color: '#178a3e', sort: 40 },
    { id: O.sNicht, pipeline_id: P.sales, label: '❌ Nicht gekauft', kind: 'lost', color: '#b5473a', sort: 50 },
    { id: O.cSetting, pipeline_id: P.sc, label: 'Setting vereinbart', kind: 'open', color: '#4c7bd9', sort: 10 },
    { id: O.cNoShow, pipeline_id: P.sc, label: 'No-Show', kind: 'open', color: '#8a8f98', sort: 20 },
    { id: O.cDurch, pipeline_id: P.sc, label: 'Setting durchgeführt', kind: 'open', color: '#2f8f6b', sort: 30 },
    { id: O.cClosing, pipeline_id: P.sc, label: 'Closing vereinbart', kind: 'open', color: '#8a5cd6', sort: 40 },
    { id: O.cAngebot, pipeline_id: P.sc, label: 'Angebot / Entscheidung offen', kind: 'open', color: '#c78a12', sort: 50 },
    { id: O.cGewonnen, pipeline_id: P.sc, label: 'Gewonnen', kind: 'won', color: '#178a3e', sort: 60 },
    { id: O.cVerloren, pipeline_id: P.sc, label: 'Verloren', kind: 'lost', color: '#b5473a', sort: 70 },
  ];

  const cf = (key: string, entity: CustomField['entity'], label: string, type: CustomField['type'], choices: string[], sort: number, show = false): CustomField =>
    ({ key, entity, label, description: '', type, choices, sort, show_in_list: show, restricted: false });
  const BUNDESLAENDER = ['Baden-Württemberg', 'Bayern', 'Berlin', 'Brandenburg', 'Bremen', 'Hamburg', 'Hessen', 'Mecklenburg-Vorpommern', 'Niedersachsen', 'Nordrhein-Westfalen', 'Rheinland-Pfalz', 'Saarland', 'Sachsen', 'Sachsen-Anhalt', 'Schleswig-Holstein', 'Thüringen'];
  const customFields: CustomField[] = [
    cf('lead_geprueft', 'lead', 'LEAD GEPRÜFT', 'choice', ['JA'], 10),
    cf('anzahl_filialen', 'lead', 'Anzahl Filialen', 'number', [], 20),
    cf('inhaber', 'lead', 'Inhaber', 'text', [], 30, true),
    cf('bundesland', 'lead', 'Bundesland', 'choice', BUNDESLAENDER, 40),
    cf('lead_quelle', 'lead', 'Lead-Quelle', 'choice', ['Empfehlung', 'Inbound', 'Kaltakquise-Liste', 'OSM-Recherche'], 50),
    cf('bestand_setting_notizen', 'lead', 'Bestand: Setting-Notizen', 'choice', ['Ja'], 60),
    cf('manuell_pruefen', 'lead', 'Manuell prüfen', 'choice', ['Ja'], 70),
    cf('inhaber_verifikation', 'lead', 'Inhaber-Verifikation', 'choice', ['Abweichung gefunden', 'Impressum bestätigt', 'Team-Liste 07/2026', 'Ungeprüft'], 80),
    cf('gesperrt_bis', 'lead', 'Gesperrt bis', 'date', [], 90),
    cf('bafa_foerdersatz', 'lead', 'BAFA-Fördersatz', 'choice', ['50 % (max. 1.750 €)', '80 % (max. 2.800 €)'], 100),
    cf('geschlecht', 'lead', 'Geschlecht', 'choice', ['Frau', 'Mann', 'unklar'], 110),
    cf('setting_termin', 'lead', 'Setting-Termin', 'datetime', [], 120),
    cf('setting_art', 'lead', 'Setting-Art', 'choice', ['Kundengewinnung', 'Mitarbeitergewinnung'], 130),
    cf('interesse', 'lead', 'Interesse', 'choice', ['Beides', 'Kundengewinnung', 'Mitarbeitergewinnung', 'Unklar'], 140),
    cf('contact_role', 'contact', 'Contact Role', 'multichoice', ['Decision Maker', 'Gatekeeper', 'Point of Contact'], 10),
    cf('dealphase', 'contact', 'Dealphase', 'text', [], 20),
  ];

  const activityTypes: ActivityType[] = [
    {
      id: AT.kg, name: 'Setting: Kundengewinnung', description: '', color: '#2346a0', archived: false, sort: 10, created_at: BUILTIN_DATE, updated_at: BUILTIN_DATE,
      fields: [
        { key: 'apothekentyp', label: 'Apothekentyp', type: 'choice', choices: ['Center-/Einkaufszentrum', 'Filialverbund', 'klassische Apotheke', 'Landapotheke', 'Sonstiges', 'Ärztehaus'] },
        { key: 'rx_anteil', label: 'Rx-Anteil (%)', type: 'text' },
        { key: 'otc_entwicklung', label: 'OTC-Entwicklung', type: 'choice', choices: ['konstant', 'unklar', 'wandert ab', 'wächst'] },
        { key: 'kundenstruktur', label: 'Kundenstruktur / Altersschnitt', type: 'text' },
        { key: 'pdl_im_angebot', label: 'pDL im Angebot?', type: 'choice', choices: ['ja, aber wenig genutzt', 'ja, läuft', 'nein — kein Interesse', 'nein — Personal', 'nein — Räumlichkeiten', 'unklar'] },
        { key: 'umsatzentwicklung', label: 'Umsatzentwicklung letzte 12 Monate', type: 'text' },
        { key: 'marketing_massnahmen', label: 'Bisherige Marketing-Maßnahmen', type: 'multichoice', choices: ['Agentur beauftragt', 'Apotheken-App', 'Flyer', 'Google Ads', 'Google SEO', 'Internetauftritt / Website', 'nichts', 'Print / Zeitung', 'Social Media Ads', 'Social Media organisch'] },
        { key: 'warum_nicht_mehr', label: 'Warum bisher nicht mehr gemacht?', type: 'multichoice', choices: ['kein Budget', 'keine Zeit', 'kennt sich nicht aus', 'schlechte Erfahrung', 'sieht keinen Bedarf', 'Sonstiges'] },
        { key: 'was_funktioniert', label: 'Was hat funktioniert, was nicht?', type: 'textarea' },
        { key: 'ziel', label: 'Ziel', type: 'choice', choices: ['Nachfolge / Verkauf vorbereiten', 'OTC-Umsatz zurückholen', 'Sichtbarkeit / Bekanntheit', 'Sonstiges', 'Stabilisierung', 'Wachstum / Neukunden'] },
        { key: 'zielbeschreibung', label: 'Zielbeschreibung in eigenen Worten', type: 'textarea' },
        { key: 'kaufmotiv', label: 'Dominantes Kaufmotiv', type: 'textarea' },
        { key: 'dringlichkeit', label: 'Dringlichkeit (Skala 1-10)', type: 'number' },
        { key: 'ergebnisse_bis', label: 'Bis wann sollen Ergebnisse da sein?', type: 'date' },
        { key: 'angebotssumme', label: 'Angebotssumme (€)', type: 'text' },
        { key: 'bafa_foerderung', label: 'Davon BAFA-Förderung (€)', type: 'text' },
        { key: 'eigenanteil', label: 'Eigenanteil (€)', type: 'text' },
        { key: 'entscheider', label: 'Entscheider', type: 'text' },
        { key: 'einwaende', label: 'Mögliche oder angedeutete Einwände', type: 'textarea' },
        { key: 'naechster_schritt', label: 'Nächster Schritt', type: 'text' },
      ],
    },
    {
      id: AT.mg, name: 'Setting: Mitarbeitergewinnung', description: '', color: '#7a3fb0', archived: false, sort: 20, created_at: BUILTIN_DATE, updated_at: BUILTIN_DATE,
      fields: [
        { key: 'mitarbeiteranzahl', label: 'Mitarbeiteranzahl', type: 'text' },
        { key: 'fluktuation', label: 'Fluktuation', type: 'text' },
        { key: 'offene_stellen', label: 'Offene Stellen', type: 'text' },
        { key: 'dringlichkeit', label: 'Dringlichkeit (Skala 1-10)', type: 'number' },
        { key: 'mitarbeiter_bis', label: 'Bis wann werden die Mitarbeiter gebraucht?', type: 'date' },
        { key: 'suche_seit', label: 'Seit wann wird gesucht?', type: 'text' },
        { key: 'bisher_probiert', label: 'Was wurde bisher probiert?', type: 'choice', choices: ['Eigene Website', 'Empfehlungen', 'Nichts', 'Personalvermittler', 'Social Media', 'Stellenbörsen', 'Zeitung / Print'] },
        { key: 'bewerber', label: 'Anzahl und Qualität bisheriger Bewerber', type: 'text' },
        { key: 'herausforderung', label: 'Größte Herausforderung bei der Mitarbeitergewinnung', type: 'textarea' },
        { key: 'kaufmotiv', label: 'Dominantes Kaufmotiv', type: 'textarea' },
        { key: 'budget_laufzeit', label: 'Budget & Laufzeit', type: 'text' },
        { key: 'entscheider', label: 'Entscheider', type: 'text' },
        { key: 'einwaende', label: 'Mögliche oder angedeutete Einwände', type: 'textarea' },
        { key: 'erster_start', label: 'Wann kann der erste Mitarbeiter starten?', type: 'date' },
        { key: 'bafa_besprochen', label: 'BAFA-Förderung besprochen?', type: 'choice', choices: ['Ja', 'Nein', 'Später klären'] },
        { key: 'naechster_schritt', label: 'Nächster Schritt', type: 'text' },
      ],
    },
    {
      id: AT.wv, name: 'Wiedervorlage / Follow-Up', description: '', color: '#b06f12', archived: false, sort: 30, created_at: BUILTIN_DATE, updated_at: BUILTIN_DATE,
      fields: [
        { key: 'datum_uhrzeit', label: 'Datum und Uhrzeit', type: 'datetime', creates_task: true, description: 'Legt automatisch eine Aufgabe zu diesem Zeitpunkt an.' },
        { key: 'notiz', label: 'Notiz', type: 'text' },
        { key: 'grund', label: 'Grund', type: 'choice', choices: ['Angebot liegt vor', 'Gatekeeper blockt', 'Kein Interesse', 'Nicht erreicht', 'Sonstiges', 'Urlaub / abwesend', 'Zu früh — später nochmal'] },
        {
          key: 'sperrdauer', label: 'Sperrdauer', type: 'choice', description: 'Setzt „Gesperrt bis“ am Lead.',
          choices: ['1 Woche', '1 Monat', '3 Monate', '6 Monate', '12 Monate', 'individuelles Datum (Feld unten)'],
          sets_lead_date: { field: 'gesperrt_bis', map: { '1 Woche': '7 days', '1 Monat': '1 month', '3 Monate': '3 months', '6 Monate': '6 months', '12 Monate': '12 months' } },
        },
      ],
    },
  ];

  const integrationLinks: IntegrationLink[] = [
    { id: '1b000000-0000-4000-8000-000000000001', name: 'Google-Suche', url_template: 'https://www.google.com/search?q={{lead.name}} {{lead.address_city}}', scope: 'lead', sort: 10 },
    { id: '1b000000-0000-4000-8000-000000000002', name: 'Google Maps', url_template: 'https://www.google.com/maps/search/{{lead.name}} {{lead.address_street}} {{lead.address_zip}} {{lead.address_city}}', scope: 'lead', sort: 20 },
  ];

  const org: OrgSettings = {
    name: 'Salus Digital (Demo)',
    currency: 'EUR',
    default_caller_id: '+4930555000',
    local_presence: false,
    recording_mode: 'auto',
    recording_format: 'wav',
    recording_retention_days: 365,
    recording_announcement: false,
    recording_announcement_text: 'Dieses Gespräch wird zu Qualitäts- und Schulungszwecken aufgezeichnet.',
    delete_twilio_recordings: true,
    transcription_enabled: true,
    summary_enabled: true,
    conference_mode: true,
    allowed_prefixes: ['+49', '+43', '+41'],
    inbound_ring_timeout: 25,
    dialer_ring_timeout: 30,
    missed_call_tasks: true,
    voicemail_drop_outcome: 'nicht_erreicht',
    voicemail_greeting_text: 'Hallo, hier ist Salus Digital. Leider ist gerade niemand erreichbar. Bitte hinterlassen Sie nach dem Signalton Ihren Namen und Ihre Nummer. Wir rufen zurück.',
    voicemail_greeting_path: null,
    call_script: [
      'Einstieg',
      '„Guten Tag, hier ist … von Salus Digital – spreche ich mit dem Inhaber oder der Inhaberin?“',
      '',
      'Aufhänger',
      'Wir helfen Apotheken, über Google und Social Media mehr Kunden bzw. Mitarbeiter zu gewinnen – staatlich gefördert über die BAFA.',
      '',
      'Fragen',
      '• Wie entwickelt sich das OTC-Geschäft?',
      '• Welche Marketing-Maßnahmen laufen schon?',
      '• Ist Personal gerade ein Thema?',
      '',
      'Termin',
      '„Lassen Sie uns 15 Minuten nehmen – passt Ihnen eher Dienstag oder Donnerstag?“',
    ].join('\n'),
    dialer_skip_recent_minutes: 60,
    meeting_status_id: S.setting,
    calendly_create_leads: true,
    calendly_links: [
      { name: 'Setting Apotheke (20 Min.)', url: 'https://calendly.com/demo-vertrieb/setting', duration: 20, owner: 'Lea Hoffmann', source: 'calendly' },
      { name: 'Closing (45 Min.)', url: 'https://calendly.com/demo-vertrieb/closing', duration: 45, owner: 'Lea Hoffmann', source: 'calendly' },
    ],
    calendly_connected_at: iso(addDays(now, -20)),
    gcal_calendars: [{ id: 'team@group.calendar.google.com', label: 'Team-Kalender' }],
    gcal_last_sync: iso(new Date(now.getTime() - 3 * 60_000)),
    gcal_last_error: null,
  };

  const leads: Lead[] = [];
  const contacts: Contact[] = [];
  const calls: Call[] = [];
  const notes: Note[] = [];
  const tasks: Task[] = [];
  const meetings: Meeting[] = [];
  const opportunities: Opportunity[] = [];
  const activities: CustomActivity[] = [];
  const events: LeadEvent[] = [];
  const emails: Email[] = [];
  const sms: SmsMessage[] = [];
  const callScripts: DemoDb['callScripts'] = {};

  const callers = [U.mia, U.jonas, U.tom, U.mia, U.jonas];
  let leadNo = 0;
  const usedNames = new Set<string>();
  const firstName = (u: string) => profiles.find((p) => p.id === u)!.full_name.split(' ')[0];

  for (let i = 0; i < 118; i++) {
    const [city, zipBase, area, state] = CITIES[i < CITIES.length ? i : Math.floor(r() * CITIES.length)];
    let name = `${pick(PREFIXES)}-Apotheke`;
    if (usedNames.has(`${name}|${city}`)) name = `${pick(PREFIXES)}-Apotheke am ${pick(['Markt', 'Park', 'Bahnhof', 'Ring', 'Dom', 'Tor'])}`;
    if (usedNames.has(`${name}|${city}`)) continue;
    usedNames.add(`${name}|${city}`);
    leadNo++;
    const id = `1e000000-0000-4000-8000-${String(leadNo).padStart(12, '0')}`;
    const created = addDays(today, -Math.floor(20 + r() * 90));
    const roll = r();
    const status = roll < 0.42 ? S.neu : roll < 0.66 ? S.wv : roll < 0.77 ? S.setting : roll < 0.84 ? S.closing : roll < 0.9 ? S.kunde : S.kpk;
    // Opener-Pool: viele Neu-Leads ohne Zuständigen
    const owner = status === S.neu && r() < 0.55 ? null : status === S.closing || status === S.kunde ? U.lea : pick(callers);
    const female = r() < 0.55;
    const ownerFirst = female ? pick(FEMALE) : pick(MALE);
    const ownerLast = pick(LAST);
    const inhaber = `${r() < 0.5 ? 'Dr. ' : ''}${ownerFirst} ${ownerLast}`;
    const slug = name.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss').replace(/[^a-z0-9]+/g, '-').replace(/-apotheke.*/, '');
    const citySlug = city.toLowerCase().split(/[ (]/)[0].replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss');
    const zip = `${zipBase.slice(0, 3)}${String(Number(zipBase.slice(3)) + Math.floor(r() * 9)).padStart(2, '0')}`;
    const contacted = status !== S.neu || r() < 0.2;
    const custom: Record<string, unknown> = {
      bundesland: state,
      lead_quelle: r() < 0.62 ? 'Kaltakquise-Liste' : r() < 0.65 ? 'OSM-Recherche' : r() < 0.6 ? 'Empfehlung' : 'Inbound',
      anzahl_filialen: 1 + Math.floor(r() * r() * 4),
      bafa_foerdersatz: NEW_STATES.includes(state) ? '80 % (max. 2.800 €)' : '50 % (max. 1.750 €)',
      geschlecht: female ? 'Frau' : 'Mann',
    };
    if (r() < 0.72) custom.inhaber = inhaber;
    if (r() < 0.58) custom.lead_geprueft = 'JA';
    const ver = r();
    if (ver < 0.4) custom.inhaber_verifikation = 'Impressum bestätigt';
    else if (ver < 0.58) custom.inhaber_verifikation = 'Team-Liste 07/2026';
    else if (ver < 0.82) custom.inhaber_verifikation = 'Ungeprüft';
    else if (ver < 0.9) custom.inhaber_verifikation = 'Abweichung gefunden';
    if (r() < 0.06) custom.manuell_pruefen = 'Ja';
    if (r() < 0.1) custom.bestand_setting_notizen = 'Ja';
    if (contacted && status !== S.kpk) custom.interesse = pick(['Kundengewinnung', 'Kundengewinnung', 'Mitarbeitergewinnung', 'Beides', 'Unklar']);
    if (status === S.wv && r() < 0.25) custom.gesperrt_bis = addDays(today, 3 + Math.floor(r() * 40)).toISOString().slice(0, 10);

    const lead: Lead = {
      id,
      name,
      status_id: status,
      owner_id: owner,
      opener_id: null,
      url: `www.${slug}-${citySlug}.example`,
      description: null,
      address_street: `${pick(STREETS)} ${1 + Math.floor(r() * 80)}`,
      address_zip: zip,
      address_city: city,
      address_state: state,
      address_country: 'DE',
      source: String(custom.lead_quelle),
      custom,
      do_not_call: false,
      last_call_at: null,
      last_call_outcome: null,
      last_connected_at: null,
      call_count: 0,
      last_activity_at: null,
      next_task_due: null,
      next_meeting_at: null,
      created_by: U.alex,
      created_at: iso(created),
      updated_at: iso(created),
    };
    leads.push(lead);
    events.push({ id: `e0000000-0000-4000-8000-${String(leadNo).padStart(12, '0')}`, lead_id: id, user_id: U.alex, type: 'created', data: { source: lead.source }, created_at: lead.created_at });

    const local = `${555}${String(100 + Math.floor(r() * 899))}`;
    const mainContact: Contact = {
      id: `c0000000-0000-4000-8000-${String(leadNo * 10).padStart(12, '0')}`,
      lead_id: id,
      name: inhaber,
      title: female ? 'Inhaberin' : 'Inhaber',
      phones: [{ type: 'office', number: `+49${area}${local}` }, ...(r() < 0.25 ? [{ type: 'mobile' as const, number: `+49151555${String(Math.floor(r() * 99999)).padStart(5, '0')}` }] : [])],
      emails: [{ type: 'office', email: `info@${slug}-${citySlug}.example` }],
      custom: { contact_role: ['Decision Maker'] },
      sort: 0,
      created_at: lead.created_at,
    };
    contacts.push(mainContact);
    if (r() < 0.32) {
      contacts.push({
        id: `c0000000-0000-4000-8000-${String(leadNo * 10 + 1).padStart(12, '0')}`,
        lead_id: id,
        name: `${pick(FEMALE)} ${pick(LAST)}`,
        title: pick(['Filialleitung', 'PTA', 'Apothekerin', 'PKA']),
        phones: r() < 0.6 ? [{ type: 'direct', number: `+49${area}${local}1` }] : [],
        emails: [],
        custom: { contact_role: [pick(['Gatekeeper', 'Point of Contact'])] },
        sort: 1,
        created_at: lead.created_at,
      });
    }

    // Anrufverlauf der letzten vier Wochen
    const zip2 = zip.startsWith('2');
    const nCalls = !contacted ? 0 : status === S.wv ? 1 + Math.floor(r() * 4) : status === S.neu ? 1 : 1 + Math.floor(r() * 3);
    const callUser = owner && owner !== U.lea ? owner : pick(callers);
    for (let k = 0; k < nCalls; k++) {
      const last = k === nCalls - 1;
      const daysAgo = zip2 && status !== S.setting ? 8 + Math.floor(r() * 18) : Math.floor(r() * 26);
      const when = at(daysAgo, 8.5 + r() * 9.2);
      if (when > now) continue;
      let outcome: string;
      if (last && (status === S.setting || status === S.closing || status === S.kunde)) outcome = 'setting_gelegt';
      else if (last && (status === S.kpk || (status === S.wv && r() < 0.45))) outcome = 'entscheider_gesprochen';
      else outcome = 'nicht_erreicht';
      const connected = outcome !== 'nicht_erreicht';
      const gatekeeper = !connected && r() < 0.35;
      const duration = connected ? 70 + Math.floor(r() * 260) : gatekeeper ? 25 + Math.floor(r() * 30) : 0;
      const callId = `ca000000-0000-4000-8000-${String(leadNo * 100 + k).padStart(12, '0')}`;
      const recorded = (connected || gatekeeper) && r() < 0.85;
      let scriptKey: string | null = null;
      if (recorded) {
        if (outcome === 'setting_gelegt') scriptKey = custom.interesse === 'Mitarbeitergewinnung' ? 'setting_mg' : 'setting_kg';
        else if (outcome === 'entscheider_gesprochen') scriptKey = r() < 0.5 ? 'eg_zeit' : 'eg_agentur';
        else scriptKey = 'gatekeeper';
      }
      const seed = leadNo * 31 + k;
      const names = { agent: firstName(callUser), kunde: `${female ? 'Frau' : 'Herr'} ${ownerLast}` };
      const recSeconds = scriptKey ? scriptDurationSeconds(scriptKey, names, seed) : null;
      if (scriptKey) callScripts[callId] = { key: scriptKey, seed };
      calls.push({
        id: callId,
        lead_id: id,
        contact_id: mainContact.id,
        user_id: callUser,
        direction: 'outbound',
        from_number: '+4930555000',
        to_number: mainContact.phones[0].number,
        status: duration > 0 ? 'completed' : pick(['no-answer', 'busy', 'no-answer']),
        outcome,
        note: outcome === 'entscheider_gesprochen' ? pick(['Will Unterlagen per Mail, Rückruf in 3 Wochen.', 'Hat Agentur, Vertrag bis März.', 'Umbau bis Jahresende, im Januar wieder anrufen.']) : gatekeeper ? 'Chef erst ab 14 Uhr da.' : null,
        started_at: iso(when),
        answered_at: duration > 0 ? iso(new Date(when.getTime() + 8000)) : null,
        ended_at: iso(new Date(when.getTime() + 8000 + (recSeconds ?? duration) * 1000)),
        duration: recSeconds ?? duration,
        conference_name: null,
        recording_status: scriptKey ? 'ready' : 'none',
        recording_path: scriptKey ? `demo/${scriptKey}/${callId}.wav` : null,
        recording_duration: recSeconds,
        recording_format: scriptKey ? 'wav' : null,
        recording_channels: scriptKey ? 2 : null,
        agent_channel: scriptKey ? 1 : null,
        extra_recordings: [],
        talk_agent_ms: null,
        talk_customer_ms: null,
        quality: duration > 0 ? { mos: Math.round((3.9 + r() * 0.5) * 10) / 10, jitter: Math.round(3 + r() * 12), rtt: Math.round(28 + r() * 40), packetLoss: Math.round(r() * 8) / 10, codec: 'opus', edge: 'frankfurt' } : null,
        transcript_status: scriptKey ? 'ready' : 'none',
        monitors: [],
        is_voicemail: false,
        voicemail_drop_id: null,
        dialer_session: null,
        created_at: iso(when),
      });
      if (outcome === 'setting_gelegt') lead.opener_id = callUser;
    }

    if (r() < 0.4) {
      notes.push({
        id: `40000000-0000-4000-8000-${String(leadNo).padStart(12, '0')}`,
        lead_id: id,
        contact_id: null,
        user_id: owner ?? U.mia,
        body: pick(NOTES),
        mentions: [],
        pinned: r() < 0.2,
        created_at: iso(at(Math.floor(r() * 12), 10 + r() * 6)),
        updated_at: iso(now),
      });
    }

    // Wiedervorlage-Formular + Aufgabe
    if (status === S.wv) {
      const due = new Date(weekday(addDays(today, Math.floor(r() * 7) - 2), 1).getTime() + (9 + Math.floor(r() * 8)) * 3_600_000);
      const grund = pick(['Nicht erreicht', 'Gatekeeper blockt', 'Zu früh — später nochmal', 'Angebot liegt vor', 'Urlaub / abwesend']);
      const user = callUser;
      const actAt = at(1 + Math.floor(r() * 6), 11 + r() * 5);
      activities.push({
        id: `ad000000-0000-4000-8000-${String(leadNo).padStart(12, '0')}`,
        type_id: AT.wv,
        lead_id: id,
        contact_id: mainContact.id,
        user_id: user,
        call_id: null,
        data: { datum_uhrzeit: iso(due), grund, notiz: grund === 'Gatekeeper blockt' ? 'Vor 9 Uhr direkt Chefin probieren' : '' },
        status: 'published',
        created_at: iso(actAt),
        updated_at: iso(actAt),
      });
      tasks.push({
        id: `7a000000-0000-4000-8000-${String(leadNo).padStart(12, '0')}`,
        lead_id: id,
        contact_id: mainContact.id,
        assigned_to: user,
        created_by: user,
        type: 'call',
        title: 'Wiedervorlage / Follow-Up',
        note: `Grund: ${grund}`,
        due_at: iso(due),
        done: false,
        done_at: null,
        done_by: null,
        call_id: null,
        created_at: iso(actAt),
      });
    }

    // Setting / Closing / Kunde: Formular, Termin, Opportunity
    if (status === S.setting || status === S.closing || status === S.kunde) {
      const mg = custom.interesse === 'Mitarbeitergewinnung';
      custom.setting_art = mg ? 'Mitarbeitergewinnung' : 'Kundengewinnung';
      const upcoming = status === S.setting;
      const start = upcoming
        ? new Date(weekday(addDays(today, Math.floor(r() * 7)), 1).getTime() + (9 + Math.floor(r() * 8)) * 3_600_000)
        : at(5 + Math.floor(r() * 12), 10 + Math.floor(r() * 6));
      if (upcoming) custom.setting_termin = iso(start);
      const setter = lead.opener_id ?? callUser;
      meetings.push({
        id: `3e000000-0000-4000-8000-${String(leadNo).padStart(12, '0')}`,
        lead_id: id,
        contact_id: mainContact.id,
        source: r() < 0.75 ? 'calendly' : 'google',
        external_id: `demo-${leadNo}`,
        calendar_id: null,
        title: upcoming ? 'Setting Apotheke (20 Min.)' : 'Closing (45 Min.)',
        description: null,
        location: 'Google Meet',
        join_url: 'https://meet.google.com/demo-link',
        starts_at: iso(start),
        ends_at: iso(new Date(start.getTime() + (upcoming ? 20 : 45) * 60_000)),
        host_user_id: U.lea,
        host_email: 'lea@vertrieb.example',
        host_name: 'Lea Hoffmann',
        set_by: setter,
        invitee_name: mainContact.name,
        invitee_email: mainContact.emails[0]?.email ?? null,
        invitee_phone: null,
        status: upcoming ? 'scheduled' : 'completed',
        outcome_note: upcoming ? null : 'Sehr interessiert, Angebot raus.',
        created_at: iso(addDays(start, -3)),
      });
      if (!lead.opener_id) lead.opener_id = setter;
      const sum = pick([3500, 4200, 5600, 7000]);
      const bafa = NEW_STATES.includes(state) ? Math.min(2800, Math.round(sum * 0.8)) : Math.min(1750, Math.round(sum * 0.5));
      const formAt = at(Math.floor(2 + r() * 10), 15);
      activities.push({
        id: `ae000000-0000-4000-8000-${String(leadNo).padStart(12, '0')}`,
        type_id: mg ? AT.mg : AT.kg,
        lead_id: id,
        contact_id: mainContact.id,
        user_id: U.lea,
        call_id: null,
        data: mg
          ? {
            mitarbeiteranzahl: String(6 + Math.floor(r() * 14)),
            offene_stellen: pick(['1 PTA', '1 PTA, 1 PKA', '1 Apotheker/in']),
            dringlichkeit: 6 + Math.floor(r() * 5),
            suche_seit: pick(['6 Monate', 'über 1 Jahr', '3 Monate']),
            bisher_probiert: pick(['Stellenbörsen', 'Personalvermittler', 'Zeitung / Print']),
            bafa_besprochen: pick(['Ja', 'Später klären']),
            naechster_schritt: 'Angebot zusenden',
            entscheider: mainContact.name,
          }
          : {
            apothekentyp: pick(['klassische Apotheke', 'Landapotheke', 'Center-/Einkaufszentrum', 'Ärztehaus']),
            otc_entwicklung: pick(['wandert ab', 'konstant', 'wandert ab']),
            marketing_massnahmen: [pick(['Flyer', 'Internetauftritt / Website', 'Google SEO']), pick(['nichts', 'Social Media organisch', 'Print / Zeitung'])],
            warum_nicht_mehr: [pick(['keine Zeit', 'kennt sich nicht aus', 'kein Budget'])],
            ziel: pick(['OTC-Umsatz zurückholen', 'Wachstum / Neukunden', 'Sichtbarkeit / Bekanntheit']),
            dringlichkeit: 5 + Math.floor(r() * 5),
            angebotssumme: String(sum),
            bafa_foerderung: String(bafa),
            eigenanteil: String(sum - bafa),
            entscheider: mainContact.name,
            einwaende: pick(['Eigenanteil zu hoch?', 'Hat schon Agentur', 'Keine Zeit für Content']),
            naechster_schritt: upcoming ? 'Setting durchführen' : 'Angebot nachfassen',
          },
        status: 'published',
        created_at: iso(formAt),
        updated_at: iso(formAt),
      });
      const st = status === S.kunde ? O.cGewonnen : status === S.closing ? pick([O.cClosing, O.cAngebot]) : pick([O.cSetting, O.cDurch]);
      opportunities.push({
        id: `0e000000-0000-4000-8000-${String(leadNo).padStart(12, '0')}`,
        lead_id: id,
        contact_id: mainContact.id,
        user_id: U.lea,
        status_id: st,
        value: sum,
        value_period: 'one_time',
        confidence: st === O.cGewonnen ? 100 : st === O.cAngebot ? 60 : st === O.cClosing ? 50 : 30,
        expected_close: addDays(today, 7 + Math.floor(r() * 30)).toISOString().slice(0, 10),
        note: null,
        custom: {},
        closed_at: st === O.cGewonnen ? iso(at(Math.floor(r() * 9), 16)) : null,
        created_at: iso(addDays(now, -10)),
        updated_at: iso(now),
      });
      if (r() < 0.5) {
        const sst = status === S.kunde ? O.sKunde : status === S.closing ? O.sClosing : O.sTerminiert;
        opportunities.push({
          id: `0e000000-0000-4000-8000-${String(leadNo + 500).padStart(12, '0')}`,
          lead_id: id,
          contact_id: mainContact.id,
          user_id: U.lea,
          status_id: sst,
          value: sum,
          value_period: 'one_time',
          confidence: sst === O.sKunde ? 100 : 40,
          expected_close: null,
          note: null,
          custom: {},
          closed_at: sst === O.sKunde ? iso(at(Math.floor(r() * 9), 16)) : null,
          created_at: iso(addDays(now, -12)),
          updated_at: iso(now),
        });
      }
    }

    // Info-Mails nach Entscheider-Gesprächen
    const eg = calls.filter((c) => c.lead_id === id && c.outcome === 'entscheider_gesprochen');
    if (eg.length && r() < 0.6) {
      const c = eg[eg.length - 1];
      const sentAt = new Date(new Date(c.started_at).getTime() + 6 * 60_000);
      emails.push({
        id: `e1000000-0000-4000-8000-${String(leadNo).padStart(12, '0')}`,
        lead_id: id,
        contact_id: mainContact.id,
        user_id: c.user_id,
        account_id: null,
        direction: 'outbound',
        status: 'sent',
        from_address: `${firstName(c.user_id!).toLowerCase()}@vertrieb.example`,
        to_address: mainContact.emails[0].email,
        subject: 'Wie besprochen: mehr Kunden für Ihre Apotheke – kurze Übersicht',
        body: `<p>Guten Tag ${mainContact.name},</p><p>danke für das kurze Gespräch eben. Wie versprochen die wichtigsten Punkte …</p><p>Beste Grüße<br>Salus Digital</p>`,
        is_html: true,
        template_id: TPL.kg,
        sent_at: iso(sentAt),
        opens: r() < 0.6 ? 1 + Math.floor(r() * 3) : 0,
        created_at: iso(sentAt),
      });
    }
  }

  // Eine Antwort per E-Mail und zwei SMS-Verläufe
  const replyLead = emails[0]?.lead_id;
  if (replyLead) {
    const replyAt = new Date(new Date(emails[0].created_at).getTime() + 3 * 3_600_000);
    emails.push({
      id: 'e1000000-0000-4000-8000-000000009001',
      lead_id: replyLead,
      contact_id: emails[0].contact_id,
      user_id: emails[0].user_id,
      account_id: null,
      direction: 'inbound',
      status: 'received',
      from_address: emails[0].to_address,
      to_address: emails[0].from_address ?? null,
      subject: 'AW: Wie besprochen: mehr Kunden für Ihre Apotheke – kurze Übersicht',
      body: 'Danke für die Infos. Rufen Sie mich gern nächste Woche Dienstag nach 15 Uhr an.\n\nViele Grüße',
      is_html: false,
      sent_at: iso(replyAt),
      opens: 0,
      created_at: iso(replyAt),
    });
  }
  const smsLead = leads.find((l) => l.status_id === S.setting);
  if (smsLead) {
    const c = contacts.find((x) => x.lead_id === smsLead.id)!;
    const t0 = at(1, 16.2);
    sms.push(
      { id: '5e000000-0000-4000-8000-000000000001', lead_id: smsLead.id, contact_id: c.id, user_id: smsLead.opener_id ?? null, direction: 'outbound', from_number: '+4930555000', to_number: c.phones[0].number, body: `Guten Tag ${c.name}, hier ist Salus Digital. Kurze Erinnerung an unser Setting morgen. Der Link kommt per E-Mail. Viele Grüße`, status: 'delivered', send_at: null, error: null, created_at: iso(t0) },
      { id: '5e000000-0000-4000-8000-000000000002', lead_id: smsLead.id, contact_id: c.id, user_id: null, direction: 'inbound', from_number: c.phones[0].number, to_number: '+4930555000', body: 'Danke, passt. Bis morgen!', status: 'received', send_at: null, error: null, created_at: iso(new Date(t0.getTime() + 12 * 60_000)) },
    );
  }

  // Kommentare (Coaching an Aufnahmen) und Benachrichtigungen
  const comments: Comment[] = [];
  const notifications: AppNotification[] = [];
  const recordedSettings = calls.filter((c) => c.recording_path && c.outcome === 'setting_gelegt').slice(0, 3);
  recordedSettings.forEach((c, i) => {
    const cAt = new Date(new Date(c.started_at).getTime() + (2 + i) * 3_600_000);
    const comment: Comment = {
      id: `c1000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
      lead_id: c.lead_id!,
      target_kind: 'call',
      target_id: c.id,
      user_id: U.alex,
      body: [
        'Starke Einwandbehandlung beim Eigenanteil – genau so! @Lea Hoffmann bitte fürs Setting im Kopf behalten.',
        'Hier etwas schneller zum Termin kommen, die Inhaberin war schon ab Minute 1 offen.',
        'Super Frage nach dem Personal-Thema 👍',
      ][i],
      at_ms: [42000, 18000, 25000][i],
      mentions: i === 0 ? [U.lea] : [],
      created_at: iso(cAt),
      updated_at: iso(cAt),
    };
    comments.push(comment);
    const leadName = leads.find((l) => l.id === c.lead_id)?.name ?? '';
    if (c.user_id && c.user_id !== U.alex) {
      notifications.push({ id: `0b000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`, user_id: c.user_id, kind: 'comment', lead_id: c.lead_id, ref_kind: 'comment', ref_id: comment.id, actor_id: U.alex, title: `Kommentar bei ${leadName}`, body: comment.body, created_at: comment.created_at, read_at: null, done_at: null, snoozed_until: null });
    }
    if (i === 0) {
      notifications.push({ id: '0b000000-0000-4000-8000-000000000099', user_id: U.lea, kind: 'mention', lead_id: c.lead_id, ref_kind: 'comment', ref_id: comment.id, actor_id: U.alex, title: `Erwähnt bei ${leadName}`, body: comment.body, created_at: comment.created_at, read_at: null, done_at: null, snoozed_until: null });
    }
  });
  // Erwähnung in einer Notiz für Alex (Admin-Demo)
  const noteLead = leads.find((l) => l.status_id === S.closing) ?? leads[0];
  const mentionNote: Note = {
    id: '40000000-0000-4000-8000-000000009001',
    lead_id: noteLead.id,
    contact_id: null,
    user_id: U.lea,
    body: '@Alex Brandt Angebot ist raus, Inhaber will mit dem Steuerberater sprechen. Kannst du am Freitag kurz drüberschauen?',
    mentions: [U.alex],
    pinned: false,
    created_at: iso(at(0, 9.5)),
    updated_at: iso(at(0, 9.5)),
  };
  notes.push(mentionNote);
  notifications.push({ id: '0b000000-0000-4000-8000-000000000101', user_id: U.alex, kind: 'mention', lead_id: noteLead.id, ref_kind: 'note', ref_id: mentionNote.id, actor_id: U.lea, title: `Erwähnt bei ${noteLead.name}`, body: mentionNote.body, created_at: mentionNote.created_at, read_at: null, done_at: null, snoozed_until: null });
  const assigned = leads.filter((l) => l.owner_id === U.mia).slice(0, 2);
  assigned.forEach((l, i) => notifications.push({ id: `0b000000-0000-4000-8000-00000000020${i}`, user_id: U.mia, kind: 'assigned', lead_id: l.id, ref_kind: 'lead', ref_id: l.id, actor_id: U.alex, title: `Dir zugewiesen: ${l.name}`, body: '', created_at: iso(at(1 + i, 8.2)), read_at: i ? iso(now) : null, done_at: null, snoozed_until: null }));

  // Verpasster Anruf mit Mailbox-Nachricht heute
  const missedLead = leads.find((l) => l.status_id === S.wv && l.owner_id === U.mia) ?? leads[3];
  const missedContact = contacts.find((c) => c.lead_id === missedLead.id)!;
  const missedAt = at(0, 8.75);
  const missedId = 'ca000000-0000-4000-8000-000000099001';
  calls.push({
    id: missedId, lead_id: missedLead.id, contact_id: missedContact.id, user_id: null, direction: 'inbound', from_number: missedContact.phones[0].number, to_number: '+4930555000',
    status: 'no-answer', outcome: null, note: null, started_at: iso(missedAt), answered_at: null, ended_at: iso(new Date(missedAt.getTime() + 40_000)), duration: 0,
    recording_status: 'ready', recording_path: `demo/voicemail/${missedId}.wav`, recording_duration: 9, recording_format: 'wav', recording_channels: 1, agent_channel: null, extra_recordings: [],
    talk_agent_ms: null, talk_customer_ms: null, quality: null, transcript_status: 'none', monitors: [], is_voicemail: true, voicemail_drop_id: null, dialer_session: null, created_at: iso(missedAt),
  });
  tasks.push({ id: '7a000000-0000-4000-8000-000000099001', lead_id: missedLead.id, contact_id: missedContact.id, assigned_to: missedLead.owner_id, created_by: null, type: 'voicemail', title: `Mailbox-Nachricht von ${missedLead.name}`, note: null, due_at: iso(missedAt), done: false, done_at: null, done_by: null, call_id: missedId, created_at: iso(missedAt) });

  // Eine Aufnahme, deren Speichern fehlschlug – zeigt „Erneut holen“ (liegt ja noch bei Twilio)
  const failedRec = calls
    .filter((c) => callScripts[c.id] && c.outcome === 'entscheider_gesprochen' && !comments.some((m) => m.target_id === c.id))
    .sort((a, b) => b.started_at.localeCompare(a.started_at))[0];
  if (failedRec) {
    Object.assign(failedRec, {
      recording_status: 'failed',
      recording_path: null,
      transcript_status: 'none',
      recording_attempts: 4,
      recording_error: 'Speicher war kurz nicht erreichbar (503).',
    });
  }

  // Smart Views wie in Close (Filter aus den Namen abgeleitet)
  const sv = (n: number, name: string, filters: SmartView['filters'], sort: SmartView['sort'], pinned: boolean, description = 'Aus Close übernommen – Filter bitte prüfen.'): SmartView => ({
    id: `5f000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    name,
    description,
    kind: 'lead',
    filters,
    sort,
    columns: [],
    shared: true,
    pinned,
    position: n * 10,
    created_by: null,
    created_at: BUILTIN_DATE,
  });
  const notLocked = { field: 'custom:gesperrt_bis' as const, op: 'past_or_empty' };
  const neuWv = { field: 'status' as const, op: 'in', value: ['@Neu', '@Wiedervorlage'] };
  const smartViews: SmartView[] = [
    sv(1, 'Kaltakquise 80 % Förderung (ohne PLZ 9)', { match: 'all', conditions: [{ field: 'custom:bafa_foerdersatz', op: 'equals', value: '80 % (max. 2.800 €)' }, { field: 'zip', op: 'not_starts_with', value: '9' }, neuWv, notLocked] }, { field: 'last_call_at', dir: 'asc' }, true),
    sv(2, 'Kaltakquise Baden-Württemberg: Neu/Wiedervorlage (30 Tage kein Kontakt)', { match: 'all', conditions: [{ field: 'custom:bundesland', op: 'equals', value: 'Baden-Württemberg' }, neuWv, { field: 'last_call', op: 'older_than_days', value: 30 }, notLocked] }, { field: 'last_call_at', dir: 'asc' }, true),
    sv(3, 'Kaltakquise PLZ 2: 2. Durchlauf (>7 Tage kein Anruf)', { match: 'all', conditions: [{ field: 'zip', op: 'starts_with', value: '2' }, neuWv, { field: 'call_count', op: 'gte', value: 1 }, { field: 'last_call', op: 'older_than_days', value: 7 }, notLocked] }, { field: 'last_call_at', dir: 'asc' }, true),
    sv(4, 'Kaltakquise PLZ 2: offen (Neu/Wiedervorlage)', { match: 'all', conditions: [{ field: 'zip', op: 'starts_with', value: '2' }, neuWv, notLocked] }, { field: 'last_call_at', dir: 'asc' }, true),
    sv(5, 'Region: Grenzregion Schweiz (KN/WT/LÖ)', { match: 'all', conditions: [{ field: 'zip', op: 'starts_with', value: '782,783,784,795,796,797,798' }] }, { field: 'name', dir: 'asc' }, true, 'Aus Close übernommen – PLZ-Bereiche der Landkreise Konstanz, Waldshut und Lörrach (ungefähr), bitte prüfen.'),
    sv(6, 'Kaltakquise PLZ 9: geprüft & nie kontaktiert', { match: 'all', conditions: [{ field: 'zip', op: 'starts_with', value: '9' }, { field: 'custom:lead_geprueft', op: 'equals', value: 'JA' }, { field: 'last_call', op: 'never' }] }, { field: 'created_at', dir: 'asc' }, true),
    sv(11, 'Dialer: Neu', { match: 'all', conditions: [{ field: 'status', op: 'in', value: ['@Neu'] }, notLocked] }, { field: 'created_at', dir: 'asc' }, false),
    sv(12, 'Dialer: Wiedervorlage heute', { match: 'all', conditions: [{ field: 'status', op: 'in', value: ['@Wiedervorlage'] }, { field: 'next_task', op: 'due' }] }, { field: 'next_task_due', dir: 'asc' }, false),
    sv(13, 'Dialer: Wiedervorlage (>3 Tage kein Anruf)', { match: 'all', conditions: [{ field: 'status', op: 'in', value: ['@Wiedervorlage'] }, { field: 'last_call', op: 'older_than_days', value: 3 }, notLocked] }, { field: 'last_call_at', dir: 'asc' }, false),
    sv(14, 'Region: PLZ 9 (Franken/Oberpfalz)', { match: 'all', conditions: [{ field: 'zip', op: 'starts_with', value: '9' }] }, { field: 'name', dir: 'asc' }, false),
    sv(15, 'Prüfen A: Inhaber fehlt (im Call erfragen)', { match: 'all', conditions: [{ field: 'custom:inhaber', op: 'empty' }] }, { field: 'name', dir: 'asc' }, false),
    sv(16, 'Prüfen B: Zuordnung unklar (Recherche nötig)', { match: 'all', conditions: [{ field: 'custom:manuell_pruefen', op: 'equals', value: 'Ja' }] }, { field: 'name', dir: 'asc' }, false),
    sv(17, 'Prüfen: alle offenen Fälle (A+B)', { match: 'any', conditions: [{ field: 'custom:inhaber', op: 'empty' }, { field: 'custom:manuell_pruefen', op: 'equals', value: 'Ja' }] }, { field: 'name', dir: 'asc' }, false),
    sv(18, 'Ungeprüft (Inhaber offen)', { match: 'any', conditions: [{ field: 'custom:inhaber_verifikation', op: 'equals', value: 'Ungeprüft' }, { field: 'custom:inhaber_verifikation', op: 'empty' }] }, { field: 'name', dir: 'asc' }, false),
    sv(19, 'Geprüft', { match: 'all', conditions: [{ field: 'custom:lead_geprueft', op: 'equals', value: 'JA' }] }, { field: 'name', dir: 'asc' }, false),
    sv(20, 'Inhaber-Abweichungen (Impressum ≠ CRM)', { match: 'all', conditions: [{ field: 'custom:inhaber_verifikation', op: 'equals', value: 'Abweichung gefunden' }] }, { field: 'name', dir: 'asc' }, false),
    sv(21, 'Apotheken: Neue Bundesländer', { match: 'all', conditions: [{ field: 'custom:bundesland', op: 'in', value: NEW_STATES }] }, { field: 'name', dir: 'asc' }, false),
    sv(22, 'Kunden', { match: 'all', conditions: [{ field: 'status', op: 'in', value: ['@Kunde'] }] }, { field: 'name', dir: 'asc' }, false, 'Aus Close übernommen.'),
    sv(23, 'Nachfassen: Settings ohne Anruf (7 Tage)', { match: 'all', conditions: [{ field: 'status', op: 'in', value: ['@Setting vereinbart'] }, { field: 'last_call', op: 'older_than_days', value: 7 }] }, { field: 'last_call_at', dir: 'asc' }, false),
    sv(24, 'Setting-Leads (Notizen seit Dez 2025)', { match: 'all', conditions: [{ field: 'custom:bestand_setting_notizen', op: 'equals', value: 'Ja' }] }, { field: 'name', dir: 'asc' }, false),
  ];

  const templates: EmailTemplate[] = [
    {
      id: TPL.kg, name: 'Cold Call: Infos Kundengewinnung', kind: 'email', is_html: true, shared: true, created_by: null, created_at: BUILTIN_DATE,
      subject: 'Wie besprochen: mehr Kunden für Ihre Apotheke – kurze Übersicht',
      body: '<p>Guten Tag {{ contact.name }},</p><p>danke für das kurze Gespräch eben. Wie versprochen die wichtigsten Punkte, wie wir Apotheken bei der Kundengewinnung unterstützen – in 30 Sekunden gelesen:</p><p><strong>1. Ihre Apotheke wird lokal zur ersten Wahl:</strong> Wir sorgen dafür, dass Menschen in Ihrem Umkreis Sie zuerst finden – bei Google und auf Social Media, dort wo sich heute nahezu jeder befindet.<br><strong>2. Messbar statt Bauchgefühl:</strong> Sie sehen schwarz auf weiß, wie viele Neukunden über die Kampagnen kommen.<br><strong>3. Staatlich gefördert:</strong> Als BAFA-gelistetes Unternehmen können wir einen Großteil der Kosten über Fördermittel abdecken – was genau bei Ihnen möglich ist, klären wir in 15 Minuten.</p><p>Hier der Link zu unserer Infoseite: <a href="https://www.apokunden.de" rel="noopener noreferrer nofollow">www.apokunden.de</a></p><p>Wann passt es Ihnen am besten für ein kurzes Gespräch (15 Minuten)? Antworten Sie einfach mit Tag und Uhrzeit – ich versuche mich nach Ihnen zu richten. Dann zeige ich Ihnen an Beispielen aus anderen Apotheken, wie das konkret aussieht.</p><p>Beste Grüße<br>Salus Digital GmbH</p>',
    },
    {
      id: TPL.mg, name: 'Cold Call: Infos Mitarbeitergewinnung', kind: 'email', is_html: true, shared: true, created_by: null, created_at: BUILTIN_DATE,
      subject: 'Wie besprochen: Personal für Ihre Apotheke – kurze Übersicht',
      body: '<p>Guten Tag {{ contact.name }},</p><p>danke für das kurze Gespräch eben. Wie versprochen die wichtigsten Punkte, wie wir Apotheken bei der Mitarbeitergewinnung unterstützen – in 30 Sekunden gelesen:</p><p><strong>1. Sichtbar, wo Ihre künftigen Mitarbeiter wirklich sind:</strong> Wir machen Ihre Apotheke regional auf Social Media als Arbeitgeber sichtbar – statt auf Stellenbörsen zu warten, auf denen sich nur meldet, wer aktiv sucht.<br><strong>2. Bewerbungen kommen zu Ihnen:</strong> Interessierte PTA, PKA und Apotheker melden sich direkt bei Ihnen – ohne Umwege, ohne Vermittlungsprovision pro Kopf.<br><strong>3. Staatlich gefördert:</strong> Als BAFA-gelistetes Beratungsunternehmen können wir einen Großteil der Kosten über Fördermittel abdecken – was genau bei Ihnen möglich ist, klären wir in 15 Minuten.</p><p>Hier noch der Link zu unserer Webseite: www.salus-digital.de</p><p>Wann passt es Ihnen am besten für ein kurzes Gespräch (15 Minuten)? Antworten Sie einfach mit Tag und Uhrzeit – ich versuche mich nach Ihnen zu richten. Dann zeige ich Ihnen an Beispielen aus anderen Apotheken, wie das konkret aussieht.</p><p>Beste Grüße</p><p><br>Salus Digital GmbH</p><p><em>PS: Wenn gerade keine Stelle offen ist, lohnt sich das Gespräch trotzdem – die Apotheken, die zuerst sichtbar sind, bekommen die Bewerbungen, wenn es ernst wird.</em></p>',
    },
    {
      id: TPL.sms, name: 'Setting-Erinnerung', kind: 'sms', is_html: false, shared: true, created_by: null, created_at: BUILTIN_DATE, subject: '',
      body: 'Guten Tag {{ contact.name }}, hier ist {{ user.first_name }} von Salus Digital. Kurze Erinnerung an unser Gespräch. Der Link kommt per E-Mail. Viele Grüße',
    },
  ];

  const drops: VoicemailDrop[] = [
    { id: 'd0000000-0000-4000-8000-000000000001', user_id: U.alex, name: 'Standard – bitte Rückruf', storage_path: 'demo/drop1.wav', duration: 6, shared: true, created_at: iso(now) },
  ];

  const weekdays = { mon: [['08:00', '18:00']], tue: [['08:00', '18:00']], wed: [['08:00', '18:00']], thu: [['08:00', '18:00']], fri: [['08:00', '16:00']] } as PhoneNumberRow['business_hours'];
  const numbers: PhoneNumberRow[] = [
    {
      number: '+4930555000', label: 'Zentrale (Team)', twilio_sid: null, sms_capable: false, members: [], group_id: null, ring_mode: 'simultaneous', ring_timeout: 25,
      route_to_owner: true, available_to_all: true, forward_to: null, forward_mode: 'never', business_hours: weekdays, outside_hours_action: 'voicemail', greeting_text: null, greeting_path: null,
      ivr: { greeting: 'Willkommen bei Salus Digital. Für Kundengewinnung drücken Sie die 1, für Mitarbeitergewinnung die 2.', options: [{ digit: '1', label: 'Kundengewinnung', action: 'group', target: groups[1].id }, { digit: '2', label: 'Mitarbeitergewinnung', action: 'group', target: groups[1].id }], timeout_action: 'ring' },
      record_inbound: null,
    },
    {
      number: '+4930555010', label: 'Alex direkt', twilio_sid: null, sms_capable: true, members: [U.alex], group_id: null, ring_mode: 'simultaneous', ring_timeout: 25,
      route_to_owner: false, available_to_all: false, forward_to: null, forward_mode: 'never', business_hours: null, outside_hours_action: 'voicemail', greeting_text: null, greeting_path: null, ivr: null, record_inbound: null,
    },
    {
      number: '+4930555011', label: 'Mia direkt', twilio_sid: null, sms_capable: true, members: [U.mia], group_id: null, ring_mode: 'simultaneous', ring_timeout: 20,
      route_to_owner: false, available_to_all: false, forward_to: null, forward_mode: 'never', business_hours: null, outside_hours_action: 'voicemail', greeting_text: null, greeting_path: null, ivr: null, record_inbound: null,
    },
    {
      number: '+4930555012', label: 'Opener-Team', twilio_sid: null, sms_capable: true, members: [], group_id: groups[0].id, ring_mode: 'round_robin', ring_timeout: 20,
      route_to_owner: true, available_to_all: true, forward_to: null, forward_mode: 'never', business_hours: weekdays, outside_hours_action: 'voicemail', greeting_text: null, greeting_path: null, ivr: null, record_inbound: null,
    },
  ];

  const workflows: Workflow[] = [
    {
      id: W.info, name: 'Nach Gespräch: Infos Kundengewinnung', description: 'Wenn der Entscheider erreicht wurde, aber noch kein Termin steht: Info-Mail und zwei Tage später nachfassen.',
      status: 'active', trigger: { type: 'call_outcome', value: 'entscheider_gesprochen', filters: {} },
      steps: [
        { id: 's1', type: 'email', wait: { amount: 5, unit: 'minutes' }, config: { template_id: TPL.kg } },
        { id: 's2', type: 'call', wait: { amount: 2, unit: 'days' }, config: { title: 'Nachfassen: Infos angekommen?' } },
        { id: 's3', type: 'call', wait: { amount: 5, unit: 'days' }, config: { title: 'Letzter Versuch: Termin anbieten' } },
      ],
      goal: { type: 'meeting', value: null }, send_window: { days: [1, 2, 3, 4, 5], from: '08:00', to: '18:00' }, allow_reenroll: false, stop_on_reply: true,
      sender_mode: 'owner', sender_user: null, created_by: U.alex, created_at: iso(addDays(now, -30)), updated_at: iso(addDays(now, -2)),
    },
    {
      id: W.setting, name: 'Setting gebucht: Bestätigung & Erinnerung', description: 'Bestätigung per E-Mail sofort, SMS-Erinnerung am Vortag.',
      status: 'active', trigger: { type: 'meeting_booked', value: null, filters: {} },
      steps: [
        { id: 's1', type: 'sms', wait: { amount: 0, unit: 'minutes' }, config: { template_id: TPL.sms } },
        { id: 's2', type: 'task', wait: { amount: 1, unit: 'days' }, config: { title: 'Setting vorbereiten: Formular ansehen' } },
      ],
      goal: { type: 'none', value: null }, send_window: { days: [1, 2, 3, 4, 5], from: '08:00', to: '19:00' }, allow_reenroll: true, stop_on_reply: false,
      sender_mode: 'owner', sender_user: null, created_by: U.alex, created_at: iso(addDays(now, -25)), updated_at: iso(addDays(now, -5)),
    },
    {
      id: W.wv, name: 'Wiedervorlage-Sequenz (3 Anrufe)', description: 'Für Leads, die mehrfach nicht erreicht wurden.',
      status: 'draft', trigger: { type: 'manual', value: null, filters: {} },
      steps: [
        { id: 's1', type: 'call', wait: { amount: 0, unit: 'minutes' }, config: { title: '1. Versuch' } },
        { id: 's2', type: 'call', wait: { amount: 2, unit: 'days' }, config: { title: '2. Versuch (anderer Tageszeit)' } },
        { id: 's3', type: 'email', wait: { amount: 2, unit: 'days' }, config: { template_id: TPL.kg } },
        { id: 's4', type: 'call', wait: { amount: 3, unit: 'days' }, config: { title: '3. Versuch' } },
        { id: 's5', type: 'update_lead', wait: { amount: 1, unit: 'days' }, config: { status_id: S.kpk } },
      ],
      goal: { type: 'status', value: S.setting }, send_window: { days: [1, 2, 3, 4, 5], from: '08:00', to: '18:00' }, allow_reenroll: false, stop_on_reply: true,
      sender_mode: 'owner', sender_user: null, created_by: U.alex, created_at: iso(addDays(now, -3)), updated_at: iso(addDays(now, -3)),
    },
  ];

  const runs: WorkflowRun[] = [];
  const egLeads = [...new Set(calls.filter((c) => c.outcome === 'entscheider_gesprochen').map((c) => c.lead_id!))].slice(0, 9);
  egLeads.forEach((leadId, i) => {
    const started = at(1 + i, 12);
    const done = i % 3 === 2;
    runs.push({
      id: `b1000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
      workflow_id: W.info,
      lead_id: leadId,
      contact_id: null,
      status: done ? 'goal_met' : 'active',
      step_index: done ? 2 : 1 + (i % 2),
      next_at: done ? null : iso(addDays(now, 1 + (i % 3))),
      started_by: null,
      started_at: iso(started),
      ended_at: done ? iso(addDays(started, 2)) : null,
      end_reason: done ? 'Ziel erreicht' : null,
      log: [{ at: iso(new Date(started.getTime() + 5 * 60_000)), step: 0, result: 'E-Mail „Cold Call: Infos Kundengewinnung“ gesendet' }],
    });
  });

  return {
    version: DEMO_VERSION,
    profiles,
    roles,
    groups,
    groupMembers,
    org,
    statuses,
    outcomes,
    pipelines,
    oppStatuses,
    customFields,
    activityTypes,
    integrationLinks,
    leads,
    contacts,
    calls,
    notes,
    emails,
    sms,
    tasks,
    meetings,
    opportunities,
    activities,
    comments,
    notifications,
    events,
    smartViews,
    templates,
    drops,
    numbers,
    workflows,
    runs,
    emailAccounts: [],
    dismissed: [],
    callScripts,
  };
}

export const DEMO_SCRIPT_KEYS = DEMO_SCRIPTS.map((s) => s.key);
