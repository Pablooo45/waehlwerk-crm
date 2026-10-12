// Smart Views aus Close übersetzen: Close-Abfrage („s_query“ der Advanced-Filtering-Schnittstelle) → unsere Filter.
// Übersetzt wird, was sich eindeutig abbilden lässt (Status, eigene Felder, Zuständige/Opener, PLZ/Ort/Bundesland,
// Anrufe, letzte Aktivität, Anlagedatum, Aufgaben). Alles andere landet als lesbarer Hinweis in „missing“ –
// die Smart View wird trotzdem angelegt und zeigt den Hinweis in ihrer Beschreibung.

export interface Cond {
  field: string;
  op: string;
  value?: unknown;
}

export interface CloseViewMaps {
  status: Map<string, string>; // Close-Status-ID → unsere Status-ID
  user: Map<string, string>; // Close-Nutzer-ID → unsere Profil-ID
  field: Map<string, string>; // Close-Feld-ID → unser Feldschlüssel oder „@owner“/„@opener“
  fieldType: Map<string, string>; // unser Feldschlüssel → Feldtyp
  fieldName: Map<string, string>; // Close-Feld-ID → Name (für Hinweise)
}

export interface ConvertResult {
  filters: { match: 'all' | 'any'; conditions: Cond[]; q?: string };
  missing: string[];
}

type Node = Record<string, unknown>;

const isObj = (v: unknown): v is Node => !!v && typeof v === 'object' && !Array.isArray(v);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));

// Felder, die Close an Leads und Adressen kennt → unsere Filterfelder
const REGULAR: Record<string, string> = {
  status_id: 'status',
  status: 'status',
  lead_status_id: 'status',
  status_label: 'status',
  display_name: 'name',
  name: 'name',
  date_created: 'created',
  created: 'created',
  num_calls: 'call_count',
  call_count: 'call_count',
  calls: 'call_count',
  last_call_date: 'last_call',
  last_call_created: 'last_call',
  date_last_call: 'last_call',
  last_called: 'last_call',
  latest_call_date: 'last_call',
  last_communication_date: 'last_activity',
  latest_communication_date: 'last_activity',
  last_activity_date: 'last_activity',
  date_last_communication: 'last_activity',
  zipcode: 'zip',
  postal_code: 'zip',
  city: 'city',
  state: 'state',
};

const ACTIVITY_DATES = new Set(['last_call', 'last_activity', 'created', 'reached']);

// ---------------------------------------------------------------------------
// Zeitpunkte: „vor 30 Tagen“, „jetzt“, „heute“ → Tage relativ zu heute (negativ = Vergangenheit)
// ---------------------------------------------------------------------------
function offsetDays(o: unknown): number | null {
  if (typeof o === 'number') return o;
  if (!isObj(o)) return null;
  const n = (k: string) => Number(o[k] ?? 0) || 0;
  const days = n('days') + n('weeks') * 7 + n('months') * 30 + n('years') * 365 + n('hours') / 24 + n('minutes') / 1440;
  return Math.round(days);
}

export function momentDays(m: unknown): number | null {
  if (!isObj(m)) return null;
  const type = str(m.type);
  if (['now', 'start_of_day', 'end_of_day', 'today', 'start_of_today'].includes(type)) return 0;
  if (type === 'offset' || type === 'relative' || type === 'offset_from_now' || 'direction' in m) {
    let d: number | null = null;
    if (isObj(m.offset) || typeof m.offset === 'number') d = offsetDays(m.offset);
    else if (typeof m.value === 'number') {
      const unit = str(m.unit || 'days');
      d = m.value * (unit.startsWith('week') ? 7 : unit.startsWith('month') ? 30 : unit.startsWith('year') ? 365 : 1);
    }
    if (d == null) return null;
    const base = isObj(m.moment) ? momentDays(m.moment) : 0;
    if (base == null) return null;
    return base + (str(m.direction) === 'future' ? d : -d);
  }
  return null;
}

interface Range {
  from: number | null | undefined; // undefined = nicht lesbar, null = offen
  to: number | null | undefined;
}

function rangeOf(c: Node): Range {
  const read = (k: string): number | null | undefined => (c[k] == null ? null : momentDays(c[k]) ?? undefined);
  const from = c.on_or_after !== undefined ? read('on_or_after') : c.after !== undefined ? read('after') : null;
  const to = c.before !== undefined ? read('before') : c.on_or_before !== undefined ? read('on_or_before') : null;
  return { from, to };
}

// ---------------------------------------------------------------------------
// Übersetzung
// ---------------------------------------------------------------------------
export function convertCloseQuery(query: unknown, maps: CloseViewMaps): ConvertResult {
  const missing: string[] = [];
  const out: ConvertResult = { filters: { match: 'all', conditions: [] }, missing };
  if (!isObj(query)) {
    missing.push('keine lesbare Abfrage');
    return out;
  }

  // oberste Ebene: „und“ ausflachen, Objekt-Typ ignorieren
  const flatten = (n: Node): Node[] => {
    if (str(n.type) === 'and' && !n.negate) return arr(n.queries).filter(isObj).flatMap(flatten);
    if (str(n.type) === 'object_type') return [];
    return [n];
  };
  let items = flatten(query);
  // nur eine „oder“-Gruppe: „eine der Bedingungen“
  if (items.length === 1 && str(items[0].type) === 'or' && !items[0].negate && !samefieldOr(items[0])) {
    const subs = arr(items[0].queries).filter(isObj).flatMap(flatten);
    const conds: Cond[] = [];
    let ok = true;
    for (const s of subs) {
      const r = translate(s, false, maps, missing, out);
      if (r && r.length === 1) conds.push(r[0]);
      else {
        ok = false;
        if (r && r.length > 1) missing.push(`Gruppe mit mehreren Bedingungen innerhalb von „eine der Bedingungen“`);
      }
    }
    if (ok) {
      out.filters = { ...out.filters, match: 'any', conditions: conds };
      return out;
    }
    items = [];
  }
  for (const n of items) {
    const r = translate(n, false, maps, missing, out);
    if (r) out.filters.conditions.push(...r);
  }
  return out;
}

// „oder“ über dasselbe Feld (z. B. Status A oder B) lässt sich zu einer Bedingung zusammenfassen
function samefieldOr(n: Node): boolean {
  const subs = arr(n.queries).filter(isObj);
  if (subs.length < 2 || !subs.every((s) => str(s.type) === 'field_condition' && !s.negate)) return false;
  const keys = subs.map((s) => JSON.stringify(s.field));
  return keys.every((k) => k === keys[0]);
}

function fieldLabel(field: Node, maps: CloseViewMaps): string {
  if (str(field.type) === 'custom_field') return `Feld „${maps.fieldName.get(str(field.custom_field_id)) ?? str(field.custom_field_id)}“`;
  return `„${str(field.field_name) || 'unbekanntes Feld'}“`;
}

function translate(n: Node, neg: boolean, maps: CloseViewMaps, missing: string[], out: ConvertResult): Cond[] | null {
  if (n.negate === true) neg = !neg;
  const type = str(n.type);
  switch (type) {
    case 'not':
      return isObj(n.query) ? translate(n.query, !neg, maps, missing, out) : null;
    case 'and': {
      const subs = arr(n.queries).filter(isObj);
      if (!neg) {
        const all: Cond[] = [];
        for (const s of subs) {
          const r = translate(s, false, maps, missing, out);
          if (r) all.push(...r);
        }
        return all;
      }
      if (subs.length === 1) return translate(subs[0], true, maps, missing, out);
      missing.push('„nicht alle von“ mit mehreren Bedingungen');
      return null;
    }
    case 'or':
      return translateOr(n, neg, maps, missing, out);
    case 'field_condition':
      return translateField(n, neg, maps, missing);
    case 'has_related':
      return translateRelated(n, neg, maps, missing);
    case 'text': {
      const v = str(n.value).trim();
      if (v && !neg && !out.filters.q) {
        out.filters.q = v;
        return [];
      }
      missing.push(`Textsuche „${v}“${neg ? ' (ausgeschlossen)' : ''}`);
      return null;
    }
    case 'saved_search':
    case 'smart_view':
      missing.push('Verweis auf eine andere Smart View');
      return null;
    case 'object_type':
      return [];
    default:
      missing.push(`Bedingung vom Typ „${type || '?'}“`);
      return null;
  }
}

function translateOr(n: Node, neg: boolean, maps: CloseViewMaps, missing: string[], out: ConvertResult): Cond[] | null {
  const subs = arr(n.queries).filter(isObj);
  if (neg) {
    // nicht (A oder B) = nicht A und nicht B
    const all: Cond[] = [];
    for (const s of subs) {
      const r = translate(s, true, maps, missing, out);
      if (r) all.push(...r);
    }
    return all;
  }
  // „Datum vorbei oder leer“: (Feld fehlt) oder (Feld vor heute)
  if (subs.length === 2) {
    const empty = subs.find((s) => str(s.type) === 'field_condition' && s.negate === true && isObj(s.condition) && str(s.condition.type) === 'exists');
    const past = subs.find((s) => s !== empty && str(s.type) === 'field_condition' && !s.negate && isObj(s.condition) && str(s.condition.type) === 'moment_range');
    if (empty && past && JSON.stringify(empty.field) === JSON.stringify(past.field)) {
      const r = rangeOf(past.condition as Node);
      const target = targetOf(empty.field as Node, maps);
      if (target && r.from === null && r.to !== undefined && r.to !== null && r.to <= 1) return [{ field: target.field, op: 'past_or_empty' }];
    }
  }
  // gleiche Felder zusammenfassen: Status A oder B, PLZ 782 oder 783 …
  if (samefieldOr(n)) {
    const parts = subs.map((s) => translateField(s, false, maps, []) ?? []);
    if (parts.every((p) => p.length === 1)) {
      const conds = parts.map((p) => p[0]);
      const first = conds[0];
      if (conds.every((c) => c.field === first.field && c.op === first.op)) {
        if (first.op === 'in') return [{ ...first, value: [...new Set(conds.flatMap((c) => arr(c.value)))] }];
        if (first.op === 'starts_with') return [{ ...first, value: [...new Set(conds.flatMap((c) => str(c.value).split(',')))].join(',') }];
      }
      if (conds.every((c) => c.field === first.field && (c.op === 'equals' || c.op === 'in'))) {
        return [{ field: first.field, op: 'in', value: [...new Set(conds.flatMap((c) => (c.op === 'in' ? arr(c.value) : [c.value])))] }];
      }
    }
  }
  missing.push('„eine der Bedingungen“ innerhalb einer Gruppe');
  return null;
}

interface Target {
  field: string; // unser Filterfeld
  kind: 'status' | 'user' | 'choice' | 'multichoice' | 'number' | 'date' | 'checkbox' | 'text' | 'zip' | 'activity' | 'count';
}

function targetOf(field: Node, maps: CloseViewMaps): Target | null {
  if (str(field.type) === 'custom_field') {
    const key = maps.field.get(str(field.custom_field_id));
    if (!key) return null;
    if (key === '@owner') return { field: 'owner', kind: 'user' };
    if (key === '@opener') return { field: 'opener', kind: 'user' };
    const t = maps.fieldType.get(key) ?? 'text';
    const kind = t === 'choice' ? 'choice' : t === 'multichoice' ? 'multichoice' : t === 'number' ? 'number' : t === 'date' || t === 'datetime' ? 'date'
      : t === 'checkbox' ? 'checkbox' : t === 'user' ? 'user' : 'text';
    return { field: `custom:${key}`, kind };
  }
  const name = str(field.field_name).replace(/^addresses?\./, '').replace(/^address_/, '');
  const f = REGULAR[name];
  if (!f) return null;
  if (f === 'status') return { field: f, kind: 'status' };
  if (f === 'zip') return { field: f, kind: 'zip' };
  if (f === 'call_count') return { field: f, kind: 'count' };
  if (ACTIVITY_DATES.has(f)) return { field: f, kind: 'activity' };
  return { field: f, kind: 'text' };
}

function translateField(n: Node, neg: boolean, maps: CloseViewMaps, missing: string[]): Cond[] | null {
  const field = isObj(n.field) ? n.field : {};
  const c = isObj(n.condition) ? n.condition : {};
  const ct = str(c.type);
  const target = targetOf(field, maps);
  const label = fieldLabel(field, maps);
  const fail = (why = '') => {
    missing.push(`${label}${why ? ` (${why})` : ''}`);
    return null;
  };
  if (!target) return fail(str(field.type) === 'custom_field' ? 'Feld nicht übernommen' : 'Feld gibt es hier nicht');
  const { field: f, kind } = target;

  switch (ct) {
    case 'reference': {
      const ids = arr(c.object_ids).map(str);
      if (kind === 'status') {
        const local = ids.map((id) => maps.status.get(id)).filter((x): x is string => !!x);
        if (local.length !== ids.length) return fail('Status nicht übernommen');
        return [{ field: f, op: neg ? 'not_in' : 'in', value: local }];
      }
      if (kind === 'user') {
        const local = ids.map((id) => maps.user.get(id)).filter((x): x is string => !!x);
        if (neg || local.length !== ids.length) return fail(neg ? '„ist nicht“ bei Personen' : 'Person nicht zugeordnet');
        return [{ field: f, op: 'in', value: local }];
      }
      return fail('Verweis');
    }
    case 'current_user':
      if (kind === 'user' && !neg) return [{ field: f, op: 'me' }];
      return fail('„bin ich“');
    case 'term': {
      const values = arr(c.values).map(str).filter((v) => v !== '');
      if (!values.length) return fail('ohne Wert');
      if (kind === 'zip') return [{ field: f, op: neg ? 'not_starts_with' : 'starts_with', value: values.join(',') }];
      if (kind === 'choice') {
        if (values.length === 1) return [{ field: f, op: neg ? 'not_equals' : 'equals', value: values[0] }];
        if (!neg) return [{ field: f, op: 'in', value: values }];
        return values.map((v) => ({ field: f, op: 'not_equals', value: v }));
      }
      if (kind === 'multichoice' && values.length === 1 && !neg) return [{ field: f, op: 'contains', value: values[0] }];
      if (kind === 'checkbox' && values.length === 1) {
        const yes = /^(true|ja|yes|1)$/i.test(values[0]);
        return [{ field: f, op: yes !== neg ? 'is_true' : 'is_false' }];
      }
      if (kind === 'text' && values.length === 1 && !neg) return [{ field: f, op: f === 'name' ? 'contains' : 'equals', value: values[0] }];
      if (kind === 'number' && values.length === 1 && !neg && Number.isFinite(Number(values[0]))) {
        const v = Number(values[0]);
        return [{ field: f, op: 'gte', value: v }, { field: f, op: 'lt', value: v + 1 }];
      }
      return fail(neg ? '„ist nicht“' : 'mehrere Werte');
    }
    case 'text': {
      const v = str(c.value).trim();
      if (!v) return fail('ohne Wert');
      const mode = str(c.mode);
      if (kind === 'zip') return [{ field: f, op: neg ? 'not_starts_with' : 'starts_with', value: v.replace(/\*+$/, '') }];
      if (neg) return fail('„enthält nicht“');
      if (kind === 'text' || kind === 'choice') return [{ field: f, op: mode === 'phrase' && f !== 'name' && kind === 'choice' ? 'equals' : 'contains', value: v }];
      return fail('Textsuche');
    }
    case 'exists': {
      if (kind === 'activity') {
        if (f === 'last_call') return neg ? [{ field: 'last_call', op: 'never' }] : [{ field: 'call_count', op: 'gte', value: 1 }];
        return neg ? [{ field: f, op: 'never' }] : fail('„vorhanden“');
      }
      if (kind === 'count') return [{ field: f, op: neg ? 'lt' : 'gte', value: 1 }];
      if (kind === 'user') return neg ? [{ field: f, op: f.startsWith('custom:') ? 'empty' : 'none' }] : f.startsWith('custom:') ? [{ field: f, op: 'not_empty' }] : fail('„vorhanden“');
      if (kind === 'zip' || f === 'city' || f === 'state') return neg ? [{ field: f, op: 'empty' }] : fail('„vorhanden“');
      if (kind === 'status') return neg ? fail('„ohne Status“') : [];
      if (f.startsWith('custom:')) return [{ field: f, op: neg ? 'empty' : 'not_empty' }];
      return fail('„vorhanden“');
    }
    case 'number_range': {
      if (kind !== 'count' && kind !== 'number') return fail('Zahlenbereich');
      const out: Cond[] = [];
      const num = (k: string) => (c[k] == null ? null : Number(c[k]));
      const gte = num('gte') ?? (num('gt') != null ? num('gt')! + 1 : null);
      const lt = num('lt') ?? (num('lte') != null ? num('lte')! + 1 : null);
      if (gte == null && lt == null) return fail('Zahlenbereich ohne Grenzen');
      if (neg) {
        if (gte != null && lt != null) return fail('„nicht zwischen“');
        return gte != null ? [{ field: f, op: 'lt', value: gte }] : [{ field: f, op: 'gte', value: lt }];
      }
      if (gte != null) out.push({ field: f, op: 'gte', value: gte });
      if (lt != null) out.push({ field: f, op: 'lt', value: lt });
      return out;
    }
    case 'moment_range': {
      const r = rangeOf(c);
      if (r.from === undefined || r.to === undefined) return fail('feste oder unbekannte Datumsangabe');
      if (kind === 'activity') {
        // in den letzten N Tagen: ab „vor N Tagen“ bis offen (oder bis jetzt)
        if (r.from !== null && r.from <= 0 && (r.to === null || r.to >= 0)) {
          const n = -r.from;
          return [{ field: f, op: neg ? 'older_than_days' : 'within_days', value: n }];
        }
        // älter als N Tage: bis „vor N Tagen“
        if (r.from === null && r.to !== null && r.to <= 0) {
          const n = -r.to;
          return [{ field: f, op: neg ? 'within_days' : 'older_than_days', value: n }];
        }
        return fail('Zeitraum');
      }
      if (kind === 'date') {
        if (neg) return fail('„nicht im Zeitraum“');
        if (r.from !== null && r.from >= 0 && r.from <= 1 && r.to !== null && r.to > 0) return [{ field: f, op: 'within_next_days', value: r.to }];
        if (r.from !== null && r.from >= 0 && r.from <= 1 && r.to === null) return [{ field: f, op: 'future' }];
        if (r.from !== null && r.from < 0 && (r.to === null || (r.to >= 0 && r.to <= 1))) return [{ field: f, op: 'within_days', value: -r.from }];
        return fail('Zeitraum');
      }
      return fail('Zeitraum');
    }
    case 'boolean': {
      const v = c.value === true || str(c.value) === 'true';
      if (kind === 'checkbox') return [{ field: f, op: v !== neg ? 'is_true' : 'is_false' }];
      return fail('ja/nein');
    }
    default:
      return fail(`Bedingung „${ct || '?'}“`);
  }
}

// Bedingungen an verknüpften Objekten: Anrufe, Adressen, Aufgaben
function translateRelated(n: Node, neg: boolean, maps: CloseViewMaps, missing: string[]): Cond[] | null {
  const rel = str(n.related_object_type);
  const inner = isObj(n.related_query) ? n.related_query : null;
  const conds = inner ? (str(inner.type) === 'and' && !inner.negate ? arr(inner.queries).filter(isObj) : [inner]) : [];
  const fieldConds = conds.filter((q) => str(q.type) === 'field_condition');
  if (rel === 'address' || rel === 'addresses') {
    const all: Cond[] = [];
    for (const q of conds) {
      const r = translate(q, neg, maps, missing, { filters: { match: 'all', conditions: [] }, missing });
      if (!r) return null;
      all.push(...r);
    }
    return all;
  }
  if (rel === 'call') {
    if (!conds.length || conds.every((q) => str(q.type) === 'object_type')) {
      return neg ? [{ field: 'last_call', op: 'never' }] : [{ field: 'call_count', op: 'gte', value: 1 }];
    }
    if (fieldConds.length === 1 && conds.length === 1) {
      const q = fieldConds[0];
      const fname = isObj(q.field) ? str(q.field.field_name) : '';
      const c = isObj(q.condition) ? q.condition : {};
      if (['date_created', 'activity_at', 'date'].includes(fname) && str(c.type) === 'moment_range') {
        const r = rangeOf(c);
        const innerNeg = q.negate === true;
        if (r.from !== null && r.from !== undefined && r.from <= 0 && (r.to === null || (r.to !== undefined && r.to >= 0))) {
          // „hat einen Anruf in den letzten N Tagen“ bzw. verneint „keinen Anruf in den letzten N Tagen“
          return [{ field: 'last_call', op: neg !== innerNeg ? 'older_than_days' : 'within_days', value: -r.from }];
        }
      }
    }
    missing.push('Bedingung an Anrufen');
    return null;
  }
  if (rel === 'task') {
    const done = fieldConds.find((q) => isObj(q.field) && /is_complete|status/.test(str(q.field.field_name)));
    if (done && conds.length <= 2) return [{ field: 'next_task', op: neg ? 'none' : 'any' }];
    missing.push('Bedingung an Aufgaben');
    return null;
  }
  missing.push(`Bedingung an verknüpften ${rel || 'Objekten'}`);
  return null;
}

// Sortierung aus Close → unsere Sortierung
export function convertCloseSort(sort: unknown): { field: string; dir: 'asc' | 'desc' } | null {
  const first = arr(sort).find(isObj);
  if (!first) return null;
  const f = isObj(first.field) ? first.field : {};
  const dir = str(first.direction).toLowerCase() === 'desc' ? 'desc' : 'asc';
  const map: Record<string, string> = {
    date_created: 'created_at',
    display_name: 'name',
    name: 'name',
    date_updated: 'updated_at',
    num_calls: 'call_count',
    last_call_date: 'last_call_at',
    last_call_created: 'last_call_at',
    last_communication_date: 'last_activity_at',
    latest_communication_date: 'last_activity_at',
  };
  const field = map[str(f.field_name)];
  return field ? { field, dir } : null;
}

// Hinweistext für die Beschreibung der übernommenen Smart View
export function viewDescription(missing: string[]): string {
  if (!missing.length) return 'Aus Close übernommen.';
  const uniq = [...new Set(missing)];
  const list = uniq.slice(0, 6).join('; ') + (uniq.length > 6 ? ` und ${uniq.length - 6} weitere` : '');
  return `Aus Close übernommen – nicht übersetzt: ${list}. Bitte die Filter prüfen.`;
}
