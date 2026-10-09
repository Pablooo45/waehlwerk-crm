// Smart-View-Filter auswerten – gemeinsam für Browser (Demo) und Server (Workflows: „Bedingung prüfen“).
// Keine Deno- oder Browser-spezifischen Aufrufe hier.

export interface FilterCondition {
  field: string;
  op: string;
  value?: unknown;
}

export interface FilterSetLike {
  match?: 'all' | 'any';
  conditions: FilterCondition[];
}

export interface LeadLike {
  status_id: string | null;
  owner_id: string | null;
  opener_id: string | null;
  name: string;
  address_city: string | null;
  address_zip: string | null;
  address_state: string | null;
  source: string | null;
  last_call_at: string | null;
  last_connected_at: string | null;
  last_activity_at: string | null;
  created_at: string;
  last_call_outcome: string | null;
  call_count: number;
  next_task_due: string | null;
  next_meeting_at: string | null;
  do_not_call: boolean;
  custom: Record<string, unknown>;
}

export interface MatchRef {
  statuses: { id: string; label: string }[];
  me: { id: string };
  customFields?: { key: string; type: string }[];
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// "@Termin gelegt" → ID des Status
export function resolveStatusIds(values: unknown, statuses: { id: string; label: string }[]): string[] {
  const arr = Array.isArray(values) ? values : values ? [values] : [];
  return arr
    .map((v) => {
      const s = String(v);
      if (s.startsWith('@')) return statuses.find((st) => st.label === s.slice(1))?.id;
      return s;
    })
    .filter((x): x is string => !!x);
}

export function zipPrefixes(value: unknown): string[] {
  return String(value ?? '')
    .split(/[\s,;]+/)
    .map((p) => p.replace(/\D/g, ''))
    .filter(Boolean);
}

// ---- Zeitgrenzen (gleich in Demo und Datenbank) ----

export function daysBoundary(n: number, now = new Date()): Date {
  return startOfDay(addDays(now, -Math.max(0, n)));
}

export function todayEnd(now = new Date()): Date {
  return endOfDay(now);
}

// ---- Auswertung ----

function dateOf(v: string | null | undefined): number | null {
  if (!v) return null;
  const t = new Date(v).getTime();
  return isNaN(t) ? null : t;
}

function textOf(v: unknown): string {
  return v == null ? '' : String(v).toLowerCase();
}

function isEmpty(v: unknown): boolean {
  return v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length);
}

export function matchesCondition(lead: LeadLike, c: FilterCondition, ref: MatchRef, now = new Date()): boolean {
  const n = Number(c.value ?? 0);
  const days = (col: string | null) => {
    const t = dateOf(col);
    if (c.op === 'never') return t === null;
    if (c.op === 'within_days') return t !== null && t >= daysBoundary(n, now).getTime();
    if (c.op === 'older_than_days') return t === null || t < daysBoundary(n, now).getTime();
    return true;
  };
  const users = (col: string | null) => {
    if (c.op === 'me') return col === ref.me.id;
    if (c.op === 'none' || c.op === 'empty') return !col;
    if (c.op === 'not_empty') return !!col;
    if (c.op === 'in') return ((c.value as string[]) ?? []).includes(col ?? '');
    return true;
  };
  switch (c.field) {
    case 'status': {
      const ids = resolveStatusIds(c.value, ref.statuses);
      const hit = ids.includes(lead.status_id ?? '');
      return c.op === 'not_in' ? !hit : hit;
    }
    case 'owner':
      return users(lead.owner_id);
    case 'opener':
      return users(lead.opener_id);
    case 'name':
      return textOf(lead.name).includes(textOf(c.value));
    case 'city':
      if (c.op === 'empty') return !lead.address_city;
      if (c.op === 'equals') return textOf(lead.address_city) === textOf(c.value);
      return textOf(lead.address_city).includes(textOf(c.value));
    case 'zip': {
      const prefixes = zipPrefixes(c.value);
      if (!prefixes.length) return true;
      const hit = prefixes.some((p) => (lead.address_zip ?? '').startsWith(p));
      return c.op === 'not_starts_with' ? !hit : hit;
    }
    case 'state':
      if (c.op === 'empty') return !lead.address_state;
      return textOf(lead.address_state) === textOf(c.value);
    case 'source':
      if (c.op === 'equals') return textOf(lead.source) === textOf(c.value);
      return textOf(lead.source).includes(textOf(c.value));
    case 'last_call':
      return days(lead.last_call_at);
    case 'reached':
      return days(lead.last_connected_at);
    case 'last_activity':
      return days(lead.last_activity_at);
    case 'created':
      return days(lead.created_at);
    case 'last_outcome': {
      const hit = ((c.value as string[]) ?? []).includes(lead.last_call_outcome ?? '');
      return c.op === 'not_in' ? !hit : hit;
    }
    case 'call_count':
      return c.op === 'lt' ? lead.call_count < n : lead.call_count >= n;
    case 'next_task': {
      const t = dateOf(lead.next_task_due);
      if (c.op === 'none') return t === null;
      if (c.op === 'any') return t !== null;
      if (c.op === 'overdue') return t !== null && t < now.getTime();
      return t !== null && t <= todayEnd(now).getTime();
    }
    case 'meeting': {
      const t = dateOf(lead.next_meeting_at);
      const upcoming = t !== null && t > now.getTime();
      return c.op === 'upcoming' ? upcoming : !upcoming;
    }
    case 'do_not_call':
      return c.op === 'is_true' ? !!lead.do_not_call : !lead.do_not_call;
    default: {
      if (!c.field.startsWith('custom:')) return true;
      const key = c.field.slice(7);
      const cf = ref.customFields?.find((f) => f.key === key);
      const v = lead.custom?.[key];
      const empty = isEmpty(v);
      if (cf?.type === 'user') return users(empty ? null : String(v));
      if (cf?.type === 'date' || cf?.type === 'datetime') {
        const isDate = cf.type === 'date';
        const today = isoDay(now);
        const str = empty ? '' : String(v);
        const cmp = (bound: string) => (isDate ? str.slice(0, 10).localeCompare(bound) : new Date(str).getTime() - new Date(bound).getTime());
        switch (c.op) {
          case 'past_or_empty':
            return empty || cmp(isDate ? today : now.toISOString()) < 0;
          case 'future':
            return !empty && cmp(isDate ? today : now.toISOString()) >= 0;
          case 'within_next_days':
            return !empty && cmp(isDate ? today : now.toISOString()) >= 0 && cmp(isDate ? isoDay(addDays(now, n)) : addDays(now, n).toISOString()) <= 0;
          case 'within_days':
            return !empty && cmp(isDate ? isoDay(addDays(now, -n)) : daysBoundary(n, now).toISOString()) >= 0 && cmp(isDate ? today : now.toISOString()) <= 0;
          case 'empty':
            return empty;
          case 'not_empty':
            return !empty;
          default:
            return true;
        }
      }
      switch (c.op) {
        case 'empty':
          return empty;
        case 'not_empty':
          return !empty;
        case 'is_true':
          return v === true || v === 'true';
        case 'is_false':
          return !(v === true || v === 'true');
        case 'gte':
          return !empty && Number(v) >= n;
        case 'lt':
          return !empty && Number(v) < n;
        case 'equals':
          return textOf(v) === textOf(c.value);
        case 'not_equals':
          return textOf(v) !== textOf(c.value);
        case 'in':
          return ((c.value as string[]) ?? []).map(textOf).includes(textOf(v));
        default:
          if (Array.isArray(v)) return v.map(textOf).includes(textOf(c.value));
          return textOf(v).includes(textOf(c.value));
      }
    }
  }
}

export function matchesFilter(lead: LeadLike, filter: FilterSetLike, ref: MatchRef, now = new Date()): boolean {
  const conds = filter.conditions ?? [];
  if (!conds.length) return true;
  return filter.match === 'any'
    ? conds.some((c) => matchesCondition(lead, c, ref, now))
    : conds.every((c) => matchesCondition(lead, c, ref, now));
}

