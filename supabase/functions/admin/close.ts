// Umzug aus Close über die Close-Schnittstelle – in Etappen, jederzeit fortsetzbar, ohne Doppelungen.
//
// Etappen (jede Anfrage verarbeitet ein Stück und liefert einen „cursor“ für das nächste):
//   config        Status, Pipelines, Ergebnisse, Felder, Formulare, Vorlagen, Smart-View-Namen, Nutzer-Zuordnung
//   leads         Leads mit Kontakten, Adressen, Feldern, Zuständigen
//   opportunities Opportunities mit Phase, Wert, Zuständigen
//   activities    Anrufe, Notizen, E-Mails, SMS, Termine, Formulare, Statuswechsel (rückwärts in 14-Tage-Fenstern)
//   tasks         offene Aufgaben
//   recordings    Gesprächsaufnahmen herunterladen (MP3) und in den eigenen Speicher legen
//
// Übernommene Einträge werden in import_map vermerkt; ein erneuter Lauf ergänzt nur Neues.
// Importiert wird über import_rows: dabei laufen keine Workflows an und niemand wird benachrichtigt.

import { check, type SupabaseRepo } from '../_shared/db.ts';
import { HttpError } from '../_shared/http.ts';
import { htmlToText, parseAddressList } from '../_shared/mime.ts';
import { normalizePhone } from '../_shared/phone.ts';

const BASE = 'https://api.close.com/api/v1';

export class CloseError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export class CloseClient {
  constructor(private readonly key: string, private readonly fetchFn: typeof fetch = fetch) {}

  get auth(): string {
    return 'Basic ' + btoa(`${this.key}:`);
  }

  async request<T>(method: 'GET' | 'POST', path: string, query?: Record<string, string | number | undefined>, body?: unknown): Promise<T> {
    const url = new URL(path.startsWith('http') ? path : `${BASE}${path}`);
    for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined && v !== '') url.searchParams.set(k, String(v));
    for (let attempt = 0; attempt < 4; attempt++) {
      const res = await this.fetchFn(url, {
        method,
        headers: { Authorization: this.auth, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (res.status === 429) {
        // Close drosselt: so lange warten, wie verlangt (höchstens 10 s)
        const wait = Math.min(10, Number(res.headers.get('retry-after')) || 2 ** attempt);
        await res.body?.cancel();
        await new Promise((r) => setTimeout(r, wait * 1000));
        continue;
      }
      const text = await res.text();
      if (res.status === 401 || res.status === 403) throw new CloseError(res.status, 'Close lehnt den API-Schlüssel ab. Bitte in Close einen neuen Schlüssel anlegen.');
      if (!res.ok) throw new CloseError(res.status, `Close ${res.status}: ${text.slice(0, 200)}`);
      return (text ? JSON.parse(text) : {}) as T;
    }
    throw new CloseError(429, 'Close drosselt gerade die Anfragen – bitte in einer Minute fortsetzen.');
  }

  get<T>(path: string, query?: Record<string, string | number | undefined>) {
    return this.request<T>('GET', path, query);
  }

  // Alle Seiten einer kleinen Liste (Einstellungen)
  async all<T>(path: string, query: Record<string, string | number | undefined> = {}): Promise<T[]> {
    const out: T[] = [];
    for (let skip = 0; skip < 5000; skip += 100) {
      const page = await this.get<{ data?: T[]; has_more?: boolean }>(path, { ...query, _skip: skip, _limit: 100 });
      out.push(...(page.data ?? []));
      if (!page.has_more) break;
    }
    return out;
  }
}

interface Page<T> {
  data: T[];
  has_more: boolean;
  total_results?: number;
}

export async function closeClient(repo: SupabaseRepo): Promise<CloseClient> {
  const key = await repo.secret('CLOSE_API_KEY');
  if (!key) throw new HttpError(409, 'Bitte zuerst den Close-API-Schlüssel eintragen.');
  return new CloseClient(key);
}

// ---------------------------------------------------------------------------
// Hilfen
// ---------------------------------------------------------------------------
export function slugKey(label: string, taken: Set<string>): string {
  const base = label
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40) || 'feld';
  let key = /^[a-z]/.test(base) ? base : `f_${base}`;
  for (let i = 2; taken.has(key); i++) key = `${base.slice(0, 36)}_${i}`;
  taken.add(key);
  return key;
}

const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();

async function mapOf(repo: SupabaseRepo, kind: string, ids?: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (ids && !ids.length) return out;
  if (ids) {
    for (let i = 0; i < ids.length; i += 200) {
      const res = await repo.db.from('import_map').select('external_id, local_id').eq('source', 'close').eq('kind', kind).in('external_id', ids.slice(i, i + 200));
      (check(res, 'Zuordnung') as { external_id: string; local_id: string }[]).forEach((r) => out.set(r.external_id, r.local_id));
    }
    return out;
  }
  for (let from = 0; ; from += 1000) {
    const res = await repo.db.from('import_map').select('external_id, local_id').eq('source', 'close').eq('kind', kind).range(from, from + 999);
    const rows = check(res, 'Zuordnung') as { external_id: string; local_id: string }[];
    rows.forEach((r) => out.set(r.external_id, r.local_id));
    if (rows.length < 1000) break;
  }
  return out;
}

async function remember(repo: SupabaseRepo, kind: string, pairs: [string, string][]) {
  if (!pairs.length) return;
  const rows = pairs.map(([external_id, local_id]) => ({ source: 'close', kind, external_id, local_id }));
  check(await repo.db.from('import_map').upsert(rows, { onConflict: 'source,kind,external_id' }), 'Zuordnung');
}

async function importRows(repo: SupabaseRepo, table: string, rows: Record<string, unknown>[], kind: string | null): Promise<number> {
  let n = 0;
  for (let i = 0; i < rows.length; i += 200) {
    const res = await repo.db.rpc('import_rows', { p_table: table, p_rows: rows.slice(i, i + 200), p_kind: kind });
    n += Number(check(res, `Import ${table}`) ?? 0);
  }
  return n;
}

// Close-Feldtypen → unsere Feldtypen
function fieldType(t: string, multiple: boolean): string {
  switch (t) {
    case 'number':
      return 'number';
    case 'date':
      return 'date';
    case 'datetime':
      return 'datetime';
    case 'choices':
      return multiple ? 'multichoice' : 'choice';
    case 'user':
      return 'user';
    case 'textarea':
      return 'textarea';
    case 'url':
      return 'url';
    case 'checkbox':
    case 'boolean':
      return 'checkbox';
    default:
      return 'text';
  }
}

interface CloseField {
  id: string;
  name: string;
  type: string;
  choices?: string[];
  accepts_multiple_values?: boolean;
  description?: string;
  custom_activity_type_id?: string;
  required?: boolean;
}

interface Maps {
  user: Map<string, string>;
  leadStatus: Map<string, string>;
  oppStatus: Map<string, string>;
  outcome: Map<string, string>;
  cfLead: Map<string, string>;
  cfContact: Map<string, string>;
  cfOpp: Map<string, string>;
  cfActivity: Map<string, string>;
  activityType: Map<string, string>;
  fieldTypes: Map<string, string>; // unser Schlüssel → Typ (für Umwandlung)
}

async function loadMaps(repo: SupabaseRepo): Promise<Maps> {
  const [user, leadStatus, oppStatus, outcome, cfLead, cfContact, cfOpp, cfActivity, activityType, fields] = await Promise.all([
    mapOf(repo, 'user'),
    mapOf(repo, 'lead_status'),
    mapOf(repo, 'opp_status'),
    mapOf(repo, 'outcome'),
    mapOf(repo, 'cf_lead'),
    mapOf(repo, 'cf_contact'),
    mapOf(repo, 'cf_opportunity'),
    mapOf(repo, 'cf_activity'),
    mapOf(repo, 'activity_type'),
    repo.db.from('custom_fields').select('key, type'),
  ]);
  return {
    user,
    leadStatus,
    oppStatus,
    outcome,
    cfLead,
    cfContact,
    cfOpp,
    cfActivity,
    activityType,
    fieldTypes: new Map((check(fields, 'Felder') as { key: string; type: string }[]).map((f) => [f.key, f.type])),
  };
}

// Feldwert aus Close in unser Format
function convertValue(v: unknown, type: string | undefined, users: Map<string, string>): unknown {
  if (v === null || v === undefined || v === '') return null;
  switch (type) {
    case 'number': {
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    }
    case 'multichoice':
      return Array.isArray(v) ? v.map(String) : [String(v)];
    case 'checkbox':
      return v === true || v === 'true' || v === 'yes' || v === 'Ja';
    case 'user':
      return users.get(String(Array.isArray(v) ? v[0] : v)) ?? null;
    case 'date':
      return String(v).slice(0, 10);
    default:
      return Array.isArray(v) ? v.map(String).join(', ') : String(v);
  }
}

function customOf(obj: Record<string, unknown>, map: Map<string, string>, maps: Maps): { custom: Record<string, unknown>; owner: string | null; opener: string | null } {
  const custom: Record<string, unknown> = {};
  let owner: string | null = null;
  let opener: string | null = null;
  for (const [k, v] of Object.entries(obj)) {
    if (!k.startsWith('custom.')) continue;
    const local = map.get(k.slice(7));
    if (!local) continue;
    if (local === '@owner' || local === '@opener') {
      const u = maps.user.get(String(Array.isArray(v) ? v[0] : v)) ?? null;
      if (local === '@owner') owner = u;
      else opener = u;
      continue;
    }
    const val = convertValue(v, maps.fieldTypes.get(local), maps.user);
    if (val !== null && !(Array.isArray(val) && !val.length)) custom[local] = val;
  }
  return { custom, owner, opener };
}

// ---------------------------------------------------------------------------
// Verbinden
// ---------------------------------------------------------------------------
export async function closeConnect(repo: SupabaseRepo, key: string, fetchFn?: typeof fetch) {
  key = key.trim();
  if (key.length < 20) throw new HttpError(400, 'Bitte den kompletten API-Schlüssel aus Close einfügen.');
  const close = new CloseClient(key, fetchFn);
  const me = await close.get<{ organizations?: { id: string; name: string }[] }>('/me/');
  const org = me.organizations?.[0];
  if (!org) throw new HttpError(400, 'Zu diesem Schlüssel gehört keine Close-Organisation.');
  await repo.setSecret('CLOSE_API_KEY', key);
  const count = async (path: string) => {
    try {
      const r = await close.get<Page<unknown>>(path, { _limit: 0 });
      return r.total_results ?? 0;
    } catch {
      return 0;
    }
  };
  const [leads, contacts, opportunities, activities, users] = await Promise.all([
    count('/lead/'),
    count('/contact/'),
    count('/opportunity/'),
    count('/activity/'),
    close.all<{ id: string; first_name?: string; last_name?: string; email: string }>('/user/'),
  ]);
  const profiles = check(await repo.db.from('profiles').select('id, email'), 'Team') as { id: string; email: string }[];
  const byEmail = new Map(profiles.map((p) => [norm(p.email), p.id]));
  const pairs: [string, string][] = [];
  const list = users.map((u) => {
    const match = byEmail.get(norm(u.email)) ?? null;
    if (match) pairs.push([u.id, match]);
    return { id: u.id, name: [u.first_name, u.last_name].filter(Boolean).join(' '), email: u.email, match };
  });
  await remember(repo, 'user', pairs);
  await repo.log('admin', 'info', `Close verbunden: ${org.name}`, { leads, users: users.length });
  return { organization: org.name, counts: { leads, contacts, opportunities, activities }, users: list };
}

// ---------------------------------------------------------------------------
// Etappen
// ---------------------------------------------------------------------------
export interface StageResult {
  done: boolean;
  cursor?: string | null;
  processed?: number;
  total?: number;
  imported?: Record<string, number>;
  warnings?: string[];
}

export async function closeImport(repo: SupabaseRepo, stage: string, cursor: string | null, fetchFn?: typeof fetch): Promise<StageResult> {
  const key = await repo.secret('CLOSE_API_KEY');
  if (!key) throw new HttpError(409, 'Bitte zuerst den Close-API-Schlüssel eintragen.');
  const close = new CloseClient(key, fetchFn);
  switch (stage) {
    case 'config':
      return importConfig(repo, close);
    case 'leads':
      return importLeads(repo, close, Number(cursor) || 0);
    case 'opportunities':
      return importOpportunities(repo, close, Number(cursor) || 0);
    case 'activities':
      return importActivities(repo, close, cursor);
    case 'tasks':
      return importTasks(repo, close, Number(cursor) || 0);
    case 'recordings':
      return importRecordings(repo, close);
    default:
      throw new HttpError(400, `Unbekannte Etappe: ${stage}`);
  }
}

// ---------- Einstellungen ----------
async function importConfig(repo: SupabaseRepo, close: CloseClient): Promise<StageResult> {
  const warnings: string[] = [];
  const imported: Record<string, number> = {};
  const db = repo.db;

  // Nutzer (nochmals, falls inzwischen Zugänge angelegt wurden)
  const users = await close.all<{ id: string; email: string; first_name?: string; last_name?: string }>('/user/');
  const profiles = check(await db.from('profiles').select('id, email'), 'Team') as { id: string; email: string }[];
  const byEmail = new Map(profiles.map((p) => [norm(p.email), p.id]));
  const userPairs: [string, string][] = [];
  for (const u of users) {
    const id = byEmail.get(norm(u.email));
    if (id) userPairs.push([u.id, id]);
    else warnings.push(`Close-Nutzer ${u.email} hat noch keinen Zugang – seine Leads/Aktivitäten werden ohne Person übernommen (vorher unter Team anlegen).`);
  }
  await remember(repo, 'user', userPairs);

  // Lead-Status
  const statuses = await close.all<{ id: string; label: string }>('/status/lead/');
  const ours = check(await db.from('lead_statuses').select('id, label, sort'), 'Status') as { id: string; label: string; sort: number }[];
  const statusPairs: [string, string][] = [];
  let sort = Math.max(0, ...ours.map((s) => s.sort));
  for (const s of statuses) {
    let hit = ours.find((o) => norm(o.label) === norm(s.label));
    if (!hit) {
      sort += 10;
      hit = check(await db.from('lead_statuses').insert({ label: s.label, sort }).select('id, label, sort').single(), 'Status') as typeof ours[number];
      ours.push(hit);
      imported.statuses = (imported.statuses ?? 0) + 1;
    }
    statusPairs.push([s.id, hit.id]);
  }
  await remember(repo, 'lead_status', statusPairs);

  // Pipelines und Opportunity-Status
  const pipelines = await close.all<{ id: string; name: string; statuses: { id: string; label: string; type: string }[] }>('/pipeline/');
  const ourPipes = check(await db.from('pipelines').select('id, name'), 'Pipelines') as { id: string; name: string }[];
  const ourOpp = check(await db.from('opportunity_statuses').select('id, label, pipeline_id'), 'Phasen') as { id: string; label: string; pipeline_id: string }[];
  const pipePairs: [string, string][] = [];
  const oppPairs: [string, string][] = [];
  for (const p of pipelines) {
    let pipe = ourPipes.find((o) => norm(o.name) === norm(p.name));
    if (!pipe) {
      pipe = check(await db.from('pipelines').insert({ name: p.name, sort: 100 + ourPipes.length * 10 }).select('id, name').single(), 'Pipeline') as typeof ourPipes[number];
      ourPipes.push(pipe);
      imported.pipelines = (imported.pipelines ?? 0) + 1;
    }
    pipePairs.push([p.id, pipe.id]);
    let i = 0;
    for (const st of p.statuses ?? []) {
      i++;
      let hit = ourOpp.find((o) => o.pipeline_id === pipe!.id && norm(o.label) === norm(st.label));
      if (!hit) {
        const kind = st.type === 'won' ? 'won' : st.type === 'lost' ? 'lost' : 'open';
        hit = check(
          await db.from('opportunity_statuses').insert({ pipeline_id: pipe.id, label: st.label, kind, sort: i * 10 }).select('id, label, pipeline_id').single(),
          'Phase',
        ) as typeof ourOpp[number];
        ourOpp.push(hit);
        imported.opportunity_statuses = (imported.opportunity_statuses ?? 0) + 1;
      }
      oppPairs.push([st.id, hit.id]);
    }
  }
  await remember(repo, 'pipeline', pipePairs);
  await remember(repo, 'opp_status', oppPairs);

  // Anruf-Ergebnisse (Close „Outcomes“)
  try {
    const outcomes = await close.all<{ id: string; name: string; applies_to?: string[] }>('/outcome/');
    const ourOut = check(await db.from('call_outcomes').select('key, label'), 'Ergebnisse') as { key: string; label: string }[];
    const taken = new Set(ourOut.map((o) => o.key));
    const pairs: [string, string][] = [];
    for (const o of outcomes) {
      if (o.applies_to && !o.applies_to.some((a) => /call/i.test(a))) continue;
      let hit = ourOut.find((x) => norm(x.label) === norm(o.name));
      if (!hit) {
        const key = slugKey(o.name, taken);
        check(await db.from('call_outcomes').insert({ key, label: o.name, sort: 100 + ourOut.length * 10 }), 'Ergebnis');
        hit = { key, label: o.name };
        ourOut.push(hit);
        imported.outcomes = (imported.outcomes ?? 0) + 1;
      }
      pairs.push([o.id, hit.key]);
    }
    await remember(repo, 'outcome', pairs);
  } catch (e) {
    warnings.push(`Anruf-Ergebnisse nicht gelesen: ${e instanceof Error ? e.message : e}`);
  }

  // Eigene Felder
  const ourFields = check(await db.from('custom_fields').select('key, label, entity'), 'Felder') as { key: string; label: string; entity: string }[];
  const taken = new Set(ourFields.map((f) => f.key));
  for (const [entity, kind] of [['lead', 'cf_lead'], ['contact', 'cf_contact'], ['opportunity', 'cf_opportunity']] as const) {
    let list: CloseField[] = [];
    try {
      list = await close.all<CloseField>(`/custom_field/${entity}/`);
    } catch (e) {
      warnings.push(`Felder (${entity}) nicht gelesen: ${e instanceof Error ? e.message : e}`);
      continue;
    }
    const pairs: [string, string][] = [];
    for (const f of list) {
      // Zuständige Person / Opener sind bei uns feste Felder
      if (entity === 'lead' && f.type === 'user' && /owner|zust[äa]ndig|verantwortlich|inhaber.*(vertrieb|crm)|closer/i.test(f.name)) {
        pairs.push([f.id, '@owner']);
        continue;
      }
      if (entity === 'lead' && f.type === 'user' && /opener|setter/i.test(f.name)) {
        pairs.push([f.id, '@opener']);
        continue;
      }
      let hit = ourFields.find((o) => o.entity === entity && norm(o.label) === norm(f.name));
      if (!hit) {
        const key = slugKey(f.name, taken);
        check(
          await db.from('custom_fields').insert({
            key,
            entity,
            label: f.name,
            description: f.description ?? '',
            type: fieldType(f.type, !!f.accepts_multiple_values),
            choices: f.choices ?? [],
            sort: 200 + ourFields.length,
          }),
          'Feld',
        );
        hit = { key, label: f.name, entity };
        ourFields.push(hit);
        imported.fields = (imported.fields ?? 0) + 1;
      }
      pairs.push([f.id, hit.key]);
    }
    await remember(repo, kind, pairs);
  }

  // Formulare (Custom Activities) mit ihren Feldern
  try {
    const types = await close.all<{ id: string; name: string; description?: string }>('/custom_activity/');
    const actFields = await close.all<CloseField>('/custom_field/activity/');
    const ourTypes = check(await db.from('activity_types').select('id, name, fields'), 'Formulare') as { id: string; name: string; fields: { key: string; label: string }[] }[];
    const typePairs: [string, string][] = [];
    const fieldPairs: [string, string][] = [];
    for (const t of types) {
      const fields = actFields.filter((f) => f.custom_activity_type_id === t.id);
      let hit = ourTypes.find((o) => norm(o.name) === norm(t.name));
      if (!hit) {
        const keys = new Set<string>();
        const defs = fields.map((f) => ({
          key: slugKey(f.name, keys),
          label: f.name,
          type: fieldType(f.type, !!f.accepts_multiple_values),
          choices: f.choices ?? [],
          required: !!f.required,
          description: f.description ?? '',
        }));
        hit = check(
          await db.from('activity_types').insert({ name: t.name, description: t.description ?? '', fields: defs, sort: 100 + ourTypes.length * 10 }).select('id, name, fields').single(),
          'Formular',
        ) as typeof ourTypes[number];
        ourTypes.push(hit);
        imported.activity_types = (imported.activity_types ?? 0) + 1;
      }
      typePairs.push([t.id, hit.id]);
      for (const f of fields) {
        const local = (hit.fields ?? []).find((x) => norm(x.label) === norm(f.name));
        if (local) fieldPairs.push([f.id, local.key]);
        else warnings.push(`Formular „${t.name}“: Feld „${f.name}“ gibt es hier nicht – Werte werden nicht übernommen.`);
      }
    }
    await remember(repo, 'activity_type', typePairs);
    await remember(repo, 'cf_activity', fieldPairs);
  } catch (e) {
    warnings.push(`Formulare nicht gelesen: ${e instanceof Error ? e.message : e}`);
  }

  // Vorlagen (E-Mail und SMS)
  const ourTpl = check(await db.from('email_templates').select('name, kind'), 'Vorlagen') as { name: string; kind: string }[];
  const tplRows: Record<string, unknown>[] = [];
  try {
    for (const t of await close.all<{ id: string; name: string; subject: string; body: string; is_shared?: boolean }>('/email_template/')) {
      if (ourTpl.some((o) => o.kind === 'email' && norm(o.name) === norm(t.name))) continue;
      tplRows.push({ name: t.name, kind: 'email', subject: t.subject ?? '', body: t.body ?? '', is_html: /<[a-z][\s\S]*>/i.test(t.body ?? ''), shared: t.is_shared !== false });
    }
    for (const t of await close.all<{ id: string; name: string; text: string; is_shared?: boolean }>('/sms_template/')) {
      if (ourTpl.some((o) => o.kind === 'sms' && norm(o.name) === norm(t.name))) continue;
      tplRows.push({ name: t.name, kind: 'sms', subject: '', body: t.text ?? '', is_html: false, shared: t.is_shared !== false });
    }
    if (tplRows.length) check(await db.from('email_templates').insert(tplRows), 'Vorlagen');
    imported.templates = tplRows.length;
  } catch (e) {
    warnings.push(`Vorlagen nicht gelesen: ${e instanceof Error ? e.message : e}`);
  }

  // Smart Views: Namen übernehmen; Filter lassen sich nicht 1:1 übersetzen
  try {
    const views = await close.all<{ id: string; name: string }>('/saved_search/');
    const ourViews = check(await db.from('smart_views').select('name'), 'Smart Views') as { name: string }[];
    const missing = views.filter((v) => !ourViews.some((o) => norm(o.name) === norm(v.name)));
    if (missing.length) {
      check(
        await db.from('smart_views').insert(missing.map((v, i) => ({
          name: v.name,
          description: 'Aus Close übernommen – bitte die Filter nachbauen (Close gibt sie nicht in lesbarer Form heraus).',
          filters: { match: 'all', conditions: [] },
          sort: { field: 'name', dir: 'asc' },
          shared: true,
          position: 500 + i,
        }))),
        'Smart Views',
      );
    }
    imported.smart_views = missing.length;
  } catch (e) {
    warnings.push(`Smart Views nicht gelesen: ${e instanceof Error ? e.message : e}`);
  }

  return { done: true, imported, warnings };
}

// ---------- Leads ----------
interface CloseContact {
  id: string;
  name?: string;
  display_name?: string;
  title?: string;
  phones?: { phone: string; type?: string }[];
  emails?: { email: string; type?: string }[];
  date_created?: string;
  [k: string]: unknown;
}

interface CloseLead {
  id: string;
  name?: string;
  display_name?: string;
  status_id?: string;
  description?: string;
  url?: string;
  addresses?: { address_1?: string; address_2?: string; city?: string; state?: string; zipcode?: string; country?: string }[];
  contacts?: CloseContact[];
  date_created?: string;
  created_by?: string;
  [k: string]: unknown;
}

const LEAD_PAGES_PER_CALL = 2;

async function importLeads(repo: SupabaseRepo, close: CloseClient, skip: number): Promise<StageResult> {
  const maps = await loadMaps(repo);
  const warnings: string[] = [];
  let processed = 0;
  let total: number | undefined;
  let created = 0;
  let hasMore = true;
  for (let p = 0; p < LEAD_PAGES_PER_CALL && hasMore; p++) {
    let page: Page<CloseLead>;
    try {
      page = await close.get<Page<CloseLead>>('/lead/', { _skip: skip, _limit: 100 });
    } catch (e) {
      if (e instanceof CloseError && e.status === 400 && skip > 0) {
        warnings.push(`Close liefert über die Schnittstelle nur die ersten ${skip} Leads am Stück. Den Rest bitte per CSV-Export aus Close und „Importieren“ übernehmen.`);
        return { done: true, processed, warnings };
      }
      throw e;
    }
    total = page.total_results ?? total;
    hasMore = page.has_more;
    const list = page.data ?? [];
    skip += list.length;
    processed += list.length;
    const known = await mapOf(repo, 'lead', list.map((l) => l.id));
    const leads: Record<string, unknown>[] = [];
    const contacts: Record<string, unknown>[] = [];
    for (const l of list) {
      if (known.has(l.id)) continue;
      const id = crypto.randomUUID();
      const a = l.addresses?.[0];
      const { custom, owner, opener } = customOf(l, maps.cfLead, maps);
      leads.push({
        id,
        name: (l.display_name || l.name || '').trim() || '(ohne Name)',
        status_id: (l.status_id && maps.leadStatus.get(l.status_id)) ?? null,
        owner_id: owner,
        opener_id: opener,
        url: l.url || null,
        description: l.description || null,
        address_street: [a?.address_1, a?.address_2].filter(Boolean).join(', ') || null,
        address_zip: a?.zipcode || null,
        address_city: a?.city || null,
        address_state: a?.state || null,
        address_country: a?.country || 'DE',
        source: 'Close',
        custom,
        created_at: l.date_created ?? new Date().toISOString(),
        created_by: (l.created_by && maps.user.get(l.created_by)) ?? null,
        _ext: l.id,
      });
      (l.contacts ?? []).forEach((c, i) => {
        contacts.push({
          id: crypto.randomUUID(),
          lead_id: id,
          name: (c.name || c.display_name || '').trim(),
          title: c.title || null,
          phones: (c.phones ?? []).filter((x) => x.phone).map((x) => ({ type: x.type || 'office', number: normalizePhone(x.phone) ?? x.phone })),
          emails: (c.emails ?? []).filter((x) => x.email).map((x) => ({ type: x.type || 'office', email: x.email.toLowerCase() })),
          custom: customOf(c, maps.cfContact, maps).custom,
          sort: i,
          created_at: c.date_created ?? l.date_created ?? new Date().toISOString(),
          _ext: c.id,
        });
      });
    }
    created += await importRows(repo, 'leads', leads, 'lead');
    await importRows(repo, 'contacts', contacts, 'contact');
  }
  return { done: !hasMore, cursor: String(skip), processed, total, imported: { leads: created } , warnings };
}

// ---------- Opportunities ----------
interface CloseOpp {
  id: string;
  lead_id: string;
  contact_id?: string | null;
  user_id?: string | null;
  status_id: string;
  value?: number | null;
  value_period?: string;
  confidence?: number | null;
  note?: string | null;
  date_created?: string;
  date_won?: string | null;
  date_lost?: string | null;
  [k: string]: unknown;
}

async function importOpportunities(repo: SupabaseRepo, close: CloseClient, skip: number): Promise<StageResult> {
  const maps = await loadMaps(repo);
  const page = await close.get<Page<CloseOpp>>('/opportunity/', { _skip: skip, _limit: 100 });
  const list = page.data ?? [];
  const [known, leads, contacts] = await Promise.all([
    mapOf(repo, 'opportunity', list.map((o) => o.id)),
    mapOf(repo, 'lead', list.map((o) => o.lead_id)),
    mapOf(repo, 'contact', list.map((o) => o.contact_id).filter(Boolean) as string[]),
  ]);
  let noLead = 0;
  const rows: Record<string, unknown>[] = [];
  for (const o of list) {
    if (known.has(o.id)) continue;
    const leadId = leads.get(o.lead_id);
    if (!leadId) {
      noLead++;
      continue;
    }
    rows.push({
      id: crypto.randomUUID(),
      lead_id: leadId,
      contact_id: (o.contact_id && contacts.get(o.contact_id)) ?? null,
      user_id: (o.user_id && maps.user.get(o.user_id)) ?? null,
      status_id: maps.oppStatus.get(o.status_id) ?? null,
      // Close speichert Werte in Cent
      value: Math.round(Number(o.value ?? 0)) / 100,
      value_period: ['one_time', 'monthly', 'annual'].includes(String(o.value_period)) ? o.value_period : 'one_time',
      confidence: Math.max(0, Math.min(100, Number(o.confidence ?? 50))),
      note: o.note || null,
      custom: customOf(o, maps.cfOpp, maps).custom,
      created_at: o.date_created ?? new Date().toISOString(),
      closed_at: o.date_won ?? o.date_lost ?? null,
      _ext: o.id,
    });
  }
  const n = await importRows(repo, 'opportunities', rows, 'opportunity');
  return {
    done: !page.has_more,
    cursor: String(skip + list.length),
    processed: list.length,
    total: page.total_results,
    imported: { opportunities: n },
    warnings: noLead ? [`${noLead} Opportunities ohne übernommenen Lead übersprungen (zuerst „Leads“ übernehmen).`] : [],
  };
}

// ---------- Aktivitäten ----------
interface CloseActivity {
  id: string;
  _type: string;
  lead_id?: string | null;
  contact_id?: string | null;
  user_id?: string | null;
  date_created: string;
  activity_at?: string | null;
  [k: string]: unknown;
}

interface ActCursor {
  before: string;
  skip: number;
  min: string;
}

const WINDOW_DAYS = 14;

async function importActivities(repo: SupabaseRepo, close: CloseClient, raw: string | null): Promise<StageResult> {
  let cur: ActCursor;
  if (raw) cur = JSON.parse(raw);
  else {
    // Untergrenze: Gründung der Close-Organisation
    const me = await close.get<{ organizations?: { id: string }[] }>('/me/');
    const orgId = me.organizations?.[0]?.id;
    const org = orgId ? await close.get<{ date_created?: string }>(`/organization/${orgId}/`) : {};
    cur = { before: new Date(Date.now() + 60_000).toISOString(), skip: 0, min: org.date_created ?? '2012-01-01T00:00:00Z' };
  }
  const maps = await loadMaps(repo);
  const imported: Record<string, number> = {};
  const warnings: string[] = [];
  let processed = 0;
  const touched = new Set<string>();
  const deadline = Date.now() + 25_000;

  for (let pages = 0; pages < 4 && Date.now() < deadline; pages++) {
    const before = new Date(cur.before);
    if (before.getTime() <= Date.parse(cur.min)) return { done: true, processed, imported, warnings };
    const after = new Date(before.getTime() - WINDOW_DAYS * 86_400_000);
    const page = await close.get<Page<CloseActivity>>('/activity/', {
      date_created__gte: after.toISOString(),
      date_created__lt: before.toISOString(),
      _skip: cur.skip,
      _limit: 100,
    });
    const list = page.data ?? [];
    processed += list.length;
    const res = await importActivityPage(repo, maps, list);
    res.leads.forEach((l) => touched.add(l));
    for (const [k, v] of Object.entries(res.counts)) imported[k] = (imported[k] ?? 0) + v;
    if (page.has_more && list.length) cur = { ...cur, skip: cur.skip + list.length };
    else cur = { ...cur, before: after.toISOString(), skip: 0 };
  }
  if (touched.size) await repo.db.rpc('import_refresh_leads', { p_leads: [...touched] });
  return { done: false, cursor: JSON.stringify(cur), processed, imported, warnings };
}

export async function importActivityPage(repo: SupabaseRepo, maps: Maps, list: CloseActivity[]) {
  const counts: Record<string, number> = {};
  const [known, leads, contacts] = await Promise.all([
    mapOf(repo, 'activity', list.map((a) => a.id)),
    mapOf(repo, 'lead', [...new Set(list.map((a) => a.lead_id).filter(Boolean) as string[])]),
    mapOf(repo, 'contact', [...new Set(list.map((a) => a.contact_id).filter(Boolean) as string[])]),
  ]);
  const rows: Record<string, Record<string, unknown>[]> = {};
  const queue: { kind: string; ref: string; url: string }[] = [];
  const touched = new Set<string>();
  const add = (table: string, row: Record<string, unknown>) => (rows[table] ??= []).push(row);

  for (const a of list) {
    if (known.has(a.id)) continue;
    const leadId = a.lead_id ? leads.get(a.lead_id) : null;
    if (!leadId) {
      counts.ohne_lead = (counts.ohne_lead ?? 0) + 1;
      continue;
    }
    const userId = (a.user_id && maps.user.get(a.user_id)) ?? null;
    const contactId = (a.contact_id && contacts.get(a.contact_id)) ?? null;
    const at = (a.activity_at as string) || a.date_created;
    const id = crypto.randomUUID();
    const type = a._type;
    touched.add(leadId);

    if (type === 'Call') {
      const inbound = /^in/i.test(String(a.direction ?? ''));
      const duration = Math.max(0, Math.round(Number(a.duration ?? 0)));
      const local = normalizePhone(String(a.local_phone ?? '')) ?? null;
      const remote = normalizePhone(String(a.remote_phone ?? a.phone ?? '')) ?? null;
      const answered = duration > 0 && !/no-answer|busy|blocked|error|vm-/.test(String(a.disposition ?? ''));
      const recording = String(a.recording_url ?? a.voicemail_url ?? '');
      add('calls', {
        id,
        lead_id: leadId,
        contact_id: contactId,
        user_id: userId,
        direction: inbound ? 'inbound' : 'outbound',
        from_number: inbound ? remote : local,
        to_number: inbound ? local : remote,
        status: answered ? 'completed' : duration === 0 && inbound ? 'no-answer' : 'completed',
        outcome: (a.outcome_id && maps.outcome.get(String(a.outcome_id))) ?? null,
        note: String(a.note ?? '').trim() || null,
        started_at: at,
        answered_at: answered ? at : null,
        ended_at: new Date(Date.parse(at) + duration * 1000).toISOString(),
        duration,
        is_voicemail: !!a.voicemail_url,
        _ext: a.id,
      });
      if (/^https?:\/\//.test(recording)) queue.push({ kind: 'recording', ref: id, url: recording });
      counts.calls = (counts.calls ?? 0) + 1;
    } else if (type === 'Note') {
      const body = String(a.note ?? '').trim() || htmlToText(String(a.note_html ?? ''));
      if (!body) continue;
      add('notes', { id, lead_id: leadId, contact_id: contactId, user_id: userId, body, created_at: a.date_created, updated_at: a.date_created, _ext: a.id });
      counts.notes = (counts.notes ?? 0) + 1;
    } else if (type === 'Email') {
      const inbound = /^in/i.test(String(a.direction ?? ''));
      const status = String(a.status ?? '');
      const html = String(a.body_html ?? '');
      const sender = parseAddressList(String(a.sender ?? ''))[0]?.email ?? null;
      const list = (v: unknown) => (Array.isArray(v) ? v.map((x) => parseAddressList(String(x))[0]?.email ?? String(x)).join(', ') : null) || null;
      add('emails', {
        id,
        lead_id: leadId,
        contact_id: contactId,
        user_id: userId,
        direction: inbound ? 'inbound' : 'outbound',
        status: inbound ? 'received' : ['sent', 'outbox'].includes(status) ? 'sent' : status === 'draft' ? 'draft' : 'logged',
        from_address: sender,
        to_address: list(a.to),
        cc: list(a.cc),
        bcc: list(a.bcc),
        subject: String(a.subject ?? '') || '(ohne Betreff)',
        body: html || String(a.body_text ?? ''),
        is_html: !!html,
        attachments: (Array.isArray(a.attachments) ? a.attachments : []).map((x: { filename?: string; size?: number }) => ({ name: x.filename ?? 'Anhang', size: x.size ?? 0, path: '' })),
        message_id: typeof a.message_id === 'string' ? a.message_id.replace(/^<|>$/g, '') : null,
        sent_at: (a.date_sent as string) || a.date_created,
        created_at: a.date_created,
        _ext: a.id,
      });
      counts.emails = (counts.emails ?? 0) + 1;
    } else if (type === 'SMS') {
      const inbound = /^in/i.test(String(a.direction ?? ''));
      const local = normalizePhone(String(a.local_phone ?? '')) ?? null;
      const remote = normalizePhone(String(a.remote_phone ?? '')) ?? null;
      add('sms_messages', {
        id,
        lead_id: leadId,
        contact_id: contactId,
        user_id: userId,
        direction: inbound ? 'inbound' : 'outbound',
        from_number: inbound ? remote : local,
        to_number: inbound ? local : remote,
        body: String(a.text ?? ''),
        status: inbound ? 'received' : 'sent',
        created_at: a.date_created,
        _ext: a.id,
      });
      counts.sms = (counts.sms ?? 0) + 1;
    } else if (type === 'LeadStatusChange') {
      add('lead_events', {
        id,
        lead_id: leadId,
        user_id: userId,
        type: 'status',
        data: {
          from: (a.old_status_id && maps.leadStatus.get(String(a.old_status_id))) ?? null,
          to: (a.new_status_id && maps.leadStatus.get(String(a.new_status_id))) ?? null,
          from_label: a.old_status_label ?? null,
          to_label: a.new_status_label ?? null,
        },
        created_at: a.date_created,
        _ext: a.id,
      });
      counts.status = (counts.status ?? 0) + 1;
    } else if (type === 'Meeting') {
      const starts = String(a.starts_at ?? at);
      const canceled = /cancel/i.test(String(a.status ?? ''));
      add('meetings', {
        id,
        lead_id: leadId,
        contact_id: contactId,
        source: 'crm',
        external_id: `close:${a.id}`,
        title: String(a.title ?? '') || 'Termin',
        location: (a.location as string) || null,
        starts_at: starts,
        ends_at: (a.ends_at as string) || null,
        host_user_id: userId,
        set_by: userId,
        status: canceled ? 'canceled' : Date.parse(starts) < Date.now() ? 'completed' : 'scheduled',
        created_at: a.date_created,
        updated_at: a.date_created,
        _ext: a.id,
      });
      counts.meetings = (counts.meetings ?? 0) + 1;
    } else if (type === 'CustomActivity' || String(a.custom_activity_type_id ?? '').startsWith('actitype_')) {
      const typeId = maps.activityType.get(String(a.custom_activity_type_id ?? ''));
      if (!typeId) {
        counts.formular_unbekannt = (counts.formular_unbekannt ?? 0) + 1;
        continue;
      }
      const data: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(a)) {
        if (!k.startsWith('custom.')) continue;
        const key = maps.cfActivity.get(k.slice(7));
        if (key && v !== null && v !== '') data[key] = Array.isArray(v) ? v.map((x) => maps.user.get(String(x)) ?? String(x)) : maps.user.get(String(v)) ?? v;
      }
      add('custom_activities', {
        id,
        type_id: typeId,
        lead_id: leadId,
        contact_id: contactId,
        user_id: userId,
        data,
        status: a.status === 'draft' ? 'draft' : 'published',
        created_at: a.date_created,
        updated_at: a.date_created,
        _ext: a.id,
      });
      counts.forms = (counts.forms ?? 0) + 1;
    } else {
      counts.uebersprungen = (counts.uebersprungen ?? 0) + 1;
    }
  }
  for (const [table, list] of Object.entries(rows)) await importRows(repo, table, list, 'activity');
  if (queue.length) {
    check(await repo.db.from('import_queue').upsert(queue, { onConflict: 'kind,ref', ignoreDuplicates: true }), 'Aufnahmen vormerken');
  }
  return { counts, leads: touched };
}

// ---------- Aufgaben ----------
async function importTasks(repo: SupabaseRepo, close: CloseClient, skip: number): Promise<StageResult> {
  const maps = await loadMaps(repo);
  const page = await close.get<Page<{ id: string; lead_id?: string; contact_id?: string; assigned_to?: string; text?: string; date?: string; due_date?: string; date_created?: string; is_complete?: boolean }>>(
    '/task/',
    { _skip: skip, _limit: 100, is_complete: 'false' },
  );
  const list = page.data ?? [];
  const [known, leads] = await Promise.all([
    mapOf(repo, 'task', list.map((t) => t.id)),
    mapOf(repo, 'lead', list.map((t) => t.lead_id).filter(Boolean) as string[]),
  ]);
  const rows: Record<string, unknown>[] = [];
  for (const t of list) {
    if (known.has(t.id) || t.is_complete) continue;
    const leadId = t.lead_id ? leads.get(t.lead_id) ?? null : null;
    if (t.lead_id && !leadId) continue;
    const due = t.due_date ?? t.date ?? null;
    rows.push({
      id: crypto.randomUUID(),
      lead_id: leadId,
      assigned_to: (t.assigned_to && maps.user.get(t.assigned_to)) ?? null,
      type: /anruf|call|rückruf/i.test(t.text ?? '') ? 'call' : 'todo',
      title: (t.text ?? '').trim().slice(0, 300) || 'Aufgabe aus Close',
      // reine Datumsangabe → 9 Uhr deutscher Zeit
      due_at: due ? (due.length <= 10 ? `${due}T07:00:00Z` : due) : null,
      created_at: t.date_created ?? new Date().toISOString(),
      _ext: t.id,
    });
  }
  const n = await importRows(repo, 'tasks', rows, 'task');
  if (rows.length) {
    const ids = [...new Set(rows.map((r) => r.lead_id).filter(Boolean) as string[])];
    await repo.db.rpc('import_refresh_leads', { p_leads: ids });
  }
  return { done: !page.has_more, cursor: String(skip + list.length), processed: list.length, total: page.total_results, imported: { tasks: n } };
}

// ---------- Aufnahmen ----------
async function importRecordings(repo: SupabaseRepo, close: CloseClient): Promise<StageResult> {
  const rows = check(
    await repo.db.from('import_queue').select('kind, ref, url, attempts').eq('kind', 'recording').eq('done', false).lt('attempts', 3).order('created_at').limit(6),
    'Aufnahmen',
  ) as { kind: string; ref: string; url: string; attempts: number }[];
  const total = Number((await repo.db.from('import_queue').select('ref', { count: 'exact', head: true }).eq('kind', 'recording').eq('done', false).lt('attempts', 3)).count ?? 0);
  let n = 0;
  const warnings: string[] = [];
  const deadline = Date.now() + 40_000;
  for (const r of rows) {
    if (Date.now() > deadline) break;
    try {
      const res = await fetch(r.url, { headers: { Authorization: close.auth } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const bytes = new Uint8Array(await res.arrayBuffer());
      const type = res.headers.get('content-type') ?? 'audio/mpeg';
      const ext = /wav/i.test(type) ? 'wav' : 'mp3';
      const call = check(await repo.db.from('calls').select('id, started_at').eq('id', r.ref).maybeSingle(), 'Anruf') as { id: string; started_at: string } | null;
      if (!call) {
        await repo.db.from('import_queue').update({ done: true, error: 'Anruf gelöscht' }).eq('kind', 'recording').eq('ref', r.ref);
        continue;
      }
      const d = new Date(call.started_at);
      const path = `close/${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${call.id}-close.${ext}`;
      await repo.upload('recordings', path, bytes, ext === 'wav' ? 'audio/wav' : 'audio/mpeg');
      check(
        await repo.db.from('calls').update({
          recording_status: 'ready',
          recording_path: path,
          recording_format: ext,
          recording_channels: 1,
          recording_bytes: bytes.length,
        }).eq('id', call.id),
        'Anruf',
      );
      await repo.db.from('import_queue').update({ done: true, error: null }).eq('kind', 'recording').eq('ref', r.ref);
      n++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await repo.db.from('import_queue').update({ attempts: r.attempts + 1, error: msg.slice(0, 300) }).eq('kind', 'recording').eq('ref', r.ref);
      if (r.attempts + 1 >= 3) warnings.push(`Aufnahme nicht ladbar (${msg}) – Anruf ${r.ref}`);
    }
  }
  const left = Math.max(0, total - n);
  return { done: left === 0 || rows.length === 0, cursor: 'next', processed: n, total: left + n, imported: { recordings: n }, warnings };
}
