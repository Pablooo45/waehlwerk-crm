// Smart-View-Filter: Definitionen, Beschreibung und Auswertung im Browser (Demo).
// Die Supabase-Variante übersetzt dieselben Bedingungen in Datenbank-Abfragen (store/pgFilter.ts).

import { resolveStatusIds } from '../../supabase/functions/_shared/filtering.ts';
import type { Condition, CustomField, FilterSet, Profile, RefData } from './types.ts';

export { daysBoundary, matchesCondition, matchesFilter, resolveStatusIds, todayEnd, zipPrefixes } from '../../supabase/functions/_shared/filtering.ts';

export type OpKind =
  | 'none'
  | 'number'
  | 'text'
  | 'multi-status'
  | 'multi-user'
  | 'multi-outcome'
  | 'choice'
  | 'multi-choice';

export interface OpDef {
  op: string;
  label: string;
  input: OpKind;
}

export interface FieldDef {
  field: string;
  label: string;
  group: string;
  ops: OpDef[];
}

const daysOps: OpDef[] = [
  { op: 'never', label: 'noch nie', input: 'none' },
  { op: 'within_days', label: 'in den letzten … Tagen (0 = heute)', input: 'number' },
  { op: 'older_than_days', label: 'nicht in den letzten … Tagen', input: 'number' },
];

export const FIELD_DEFS: FieldDef[] = [
  {
    field: 'status',
    label: 'Status',
    group: 'Lead',
    ops: [
      { op: 'in', label: 'ist', input: 'multi-status' },
      { op: 'not_in', label: 'ist nicht', input: 'multi-status' },
    ],
  },
  {
    field: 'owner',
    label: 'Zuständig',
    group: 'Lead',
    ops: [
      { op: 'me', label: 'bin ich', input: 'none' },
      { op: 'in', label: 'ist', input: 'multi-user' },
      { op: 'none', label: 'niemand', input: 'none' },
    ],
  },
  {
    field: 'opener',
    label: 'Opener',
    group: 'Lead',
    ops: [
      { op: 'me', label: 'bin ich', input: 'none' },
      { op: 'in', label: 'ist', input: 'multi-user' },
      { op: 'none', label: 'noch keiner', input: 'none' },
    ],
  },
  { field: 'name', label: 'Firmenname', group: 'Lead', ops: [{ op: 'contains', label: 'enthält', input: 'text' }] },
  {
    field: 'city',
    label: 'Ort',
    group: 'Adresse',
    ops: [
      { op: 'contains', label: 'enthält', input: 'text' },
      { op: 'equals', label: 'ist genau', input: 'text' },
      { op: 'empty', label: 'ist leer', input: 'none' },
    ],
  },
  {
    field: 'zip',
    label: 'PLZ',
    group: 'Adresse',
    ops: [
      { op: 'starts_with', label: 'beginnt mit (mehrere mit Komma)', input: 'text' },
      { op: 'not_starts_with', label: 'beginnt nicht mit', input: 'text' },
    ],
  },
  {
    field: 'state',
    label: 'Bundesland (Adresse)',
    group: 'Adresse',
    ops: [
      { op: 'equals', label: 'ist', input: 'text' },
      { op: 'empty', label: 'ist leer', input: 'none' },
    ],
  },
  {
    field: 'source',
    label: 'Quelle',
    group: 'Lead',
    ops: [
      { op: 'equals', label: 'ist', input: 'text' },
      { op: 'contains', label: 'enthält', input: 'text' },
    ],
  },
  { field: 'last_call', label: 'Zuletzt angerufen', group: 'Aktivität', ops: daysOps },
  {
    field: 'last_outcome',
    label: 'Letztes Ergebnis',
    group: 'Aktivität',
    ops: [
      { op: 'in', label: 'ist', input: 'multi-outcome' },
      { op: 'not_in', label: 'ist nicht', input: 'multi-outcome' },
    ],
  },
  { field: 'reached', label: 'Entscheider erreicht', group: 'Aktivität', ops: daysOps },
  { field: 'last_activity', label: 'Letzte Aktivität', group: 'Aktivität', ops: daysOps },
  {
    field: 'call_count',
    label: 'Anzahl Anrufe',
    group: 'Aktivität',
    ops: [
      { op: 'lt', label: 'weniger als', input: 'number' },
      { op: 'gte', label: 'mindestens', input: 'number' },
    ],
  },
  {
    field: 'next_task',
    label: 'Aufgabe',
    group: 'Aktivität',
    ops: [
      { op: 'due', label: 'fällig bis heute', input: 'none' },
      { op: 'overdue', label: 'überfällig', input: 'none' },
      { op: 'any', label: 'offen vorhanden', input: 'none' },
      { op: 'none', label: 'keine offene', input: 'none' },
    ],
  },
  {
    field: 'meeting',
    label: 'Termin',
    group: 'Aktivität',
    ops: [
      { op: 'upcoming', label: 'steht an', input: 'none' },
      { op: 'none', label: 'keiner geplant', input: 'none' },
    ],
  },
  {
    field: 'created',
    label: 'Angelegt',
    group: 'Lead',
    ops: [
      { op: 'within_days', label: 'in den letzten … Tagen', input: 'number' },
      { op: 'older_than_days', label: 'vor mehr als … Tagen', input: 'number' },
    ],
  },
  {
    field: 'do_not_call',
    label: 'Nicht anrufen',
    group: 'Lead',
    ops: [
      { op: 'is_true', label: 'ja', input: 'none' },
      { op: 'is_false', label: 'nein', input: 'none' },
    ],
  },
];

const EMPTY_OPS: OpDef[] = [
  { op: 'empty', label: 'ist leer', input: 'none' },
  { op: 'not_empty', label: 'ist ausgefüllt', input: 'none' },
];

export function customFieldDef(cf: CustomField): FieldDef {
  const field = `custom:${cf.key}`;
  const base = { field, label: cf.label, group: 'Eigene Felder' };
  switch (cf.type) {
    case 'checkbox':
      return {
        ...base,
        ops: [
          { op: 'is_true', label: 'ja', input: 'none' },
          { op: 'is_false', label: 'nein / leer', input: 'none' },
        ],
      };
    case 'number':
      return {
        ...base,
        ops: [
          { op: 'gte', label: 'mindestens', input: 'number' },
          { op: 'lt', label: 'weniger als', input: 'number' },
          ...EMPTY_OPS,
        ],
      };
    case 'choice':
      return {
        ...base,
        ops: [
          { op: 'equals', label: 'ist', input: 'choice' },
          { op: 'in', label: 'ist einer von', input: 'multi-choice' },
          { op: 'not_equals', label: 'ist nicht', input: 'choice' },
          ...EMPTY_OPS,
        ],
      };
    case 'multichoice':
      return { ...base, ops: [{ op: 'contains', label: 'enthält', input: 'choice' }, ...EMPTY_OPS] };
    case 'date':
    case 'datetime':
      return {
        ...base,
        ops: [
          { op: 'past_or_empty', label: 'vorbei oder leer', input: 'none' },
          { op: 'future', label: 'heute oder später', input: 'none' },
          { op: 'within_next_days', label: 'in den nächsten … Tagen', input: 'number' },
          { op: 'within_days', label: 'in den letzten … Tagen', input: 'number' },
          ...EMPTY_OPS,
        ],
      };
    case 'user':
      return {
        ...base,
        ops: [
          { op: 'me', label: 'bin ich', input: 'none' },
          { op: 'in', label: 'ist', input: 'multi-user' },
          ...EMPTY_OPS,
        ],
      };
    default:
      return {
        ...base,
        ops: [
          { op: 'contains', label: 'enthält', input: 'text' },
          { op: 'equals', label: 'ist genau', input: 'text' },
          ...EMPTY_OPS,
        ],
      };
  }
}

export function leadFields(customFields: CustomField[]): CustomField[] {
  return customFields.filter((f) => f.entity === 'lead');
}

export function allFieldDefs(customFields: CustomField[]): FieldDef[] {
  return [...FIELD_DEFS, ...leadFields(customFields).map(customFieldDef)];
}

export function describeCondition(c: Condition, ref: Pick<RefData, 'statuses' | 'profiles' | 'outcomes' | 'customFields' | 'me'>): string {
  const def = allFieldDefs(ref.customFields).find((f) => f.field === c.field);
  if (!def) return 'Unbekannter Filter';
  const op = def.ops.find((o) => o.op === c.op);
  if (!op) return def.label;
  let value = '';
  if (op.input === 'multi-status') {
    value = resolveStatusIds(c.value, ref.statuses)
      .map((id) => ref.statuses.find((s) => s.id === id)?.label ?? '?')
      .join(', ');
  } else if (op.input === 'multi-user') {
    value = ((c.value as string[]) ?? []).map((id) => userName(ref.profiles, id)).join(', ');
  } else if (op.input === 'multi-outcome') {
    value = ((c.value as string[]) ?? []).map((k) => ref.outcomes.find((o) => o.key === k)?.label ?? k).join(', ');
  } else if (op.input === 'multi-choice') {
    value = ((c.value as string[]) ?? []).join(', ');
  } else if (op.input === 'number') {
    const n = Number(c.value ?? 0);
    if (op.label.includes('…')) return `${def.label} ${op.label.replace('…', String(n))}`.replace(' (0 = heute)', '');
    value = String(n);
  } else if (op.input === 'text' || op.input === 'choice') {
    value = `„${String(c.value ?? '')}“`;
  }
  if (c.field === 'last_call' && c.op === 'within_days' && Number(c.value) === 0) return 'Heute angerufen';
  const opLabel = op.label.replace(' (mehrere mit Komma)', '');
  return [def.label, opLabel, value].filter(Boolean).join(' ');
}

export function userName(profiles: Profile[], id: string | null | undefined): string {
  if (!id) return 'niemand';
  const p = profiles.find((x) => x.id === id);
  return p ? p.full_name || p.email : 'Unbekannt';
}

export function searchTerms(q: string | undefined): string[] {
  return (q ?? '')
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => /[\p{L}\p{N}]/u.test(t))
    .map((t) => (/^[+0-9()/-]+$/.test(t) && t.replace(/\D/g, '').length >= 3 ? t.replace(/\D/g, '') : t));
}

export function emptyFilter(): FilterSet {
  return { q: '', match: 'all', conditions: [] };
}

export function isEmptyFilter(f: FilterSet | null | undefined): boolean {
  return !f || (!f.q?.trim() && !(f.conditions ?? []).length);
}
