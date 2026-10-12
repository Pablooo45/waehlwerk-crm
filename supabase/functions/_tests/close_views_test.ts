// Smart Views aus Close: Abfragen wie die des Teams (Bundesland, Status, PLZ-Bereiche, Anrufe, „Gesperrt bis“)
// werden in eigene Filter übersetzt; was nicht geht, steht als Hinweis in der Beschreibung.

import { type CloseViewMaps, convertCloseQuery, convertCloseSort, momentDays, viewDescription } from '../admin/close_views.ts';
import { assert, assertEquals } from '../_shared/test_utils.ts';

const maps: CloseViewMaps = {
  status: new Map([['stat_neu', 'st-neu'], ['stat_wv', 'st-wv'], ['stat_kunde', 'st-kunde']]),
  user: new Map([['user_mia', 'p-mia']]),
  field: new Map([
    ['cf_bl', 'bundesland'],
    ['cf_lock', 'gesperrt_bis'],
    ['cf_geprueft', 'lead_geprueft'],
    ['cf_inhaber', 'inhaber'],
    ['cf_manuell', 'manuell_pruefen'],
    ['cf_owner', '@owner'],
    ['cf_filialen', 'anzahl_filialen'],
  ]),
  fieldType: new Map([
    ['bundesland', 'choice'],
    ['gesperrt_bis', 'date'],
    ['lead_geprueft', 'choice'],
    ['inhaber', 'text'],
    ['manuell_pruefen', 'choice'],
    ['anzahl_filialen', 'number'],
  ]),
  fieldName: new Map([['cf_alt', 'Altes Feld']]),
};

const lead = { type: 'object_type', object_type: 'lead' };
const cf = (id: string, condition: unknown, negate = false) => ({ type: 'field_condition', negate, field: { type: 'custom_field', custom_field_id: id }, condition });
const reg = (name: string, condition: unknown, negate = false, object_type = 'lead') => ({ type: 'field_condition', negate, field: { type: 'regular_field', object_type, field_name: name }, condition });
const daysAgo = (days: number) => ({ type: 'offset', direction: 'past', moment: { type: 'now' }, offset: { days } });
const notLocked = { type: 'or', queries: [cf('cf_lock', { type: 'exists' }, true), cf('cf_lock', { type: 'moment_range', on_or_after: null, before: { type: 'now' } })] };
const statusNeuWv = reg('status_id', { type: 'reference', reference_type: 'status.lead', object_ids: ['stat_neu', 'stat_wv'] });

Deno.test('Close-Smart-View: Bundesland, Status, 30 Tage kein Anruf, nicht gesperrt', () => {
  const q = {
    type: 'and',
    queries: [
      lead,
      cf('cf_bl', { type: 'term', values: ['Baden-Württemberg'] }),
      statusNeuWv,
      {
        type: 'has_related', negate: true, this_object_type: 'lead', related_object_type: 'call',
        related_query: { type: 'and', queries: [reg('date_created', { type: 'moment_range', on_or_after: daysAgo(30), before: null }, false, 'call')] },
      },
      notLocked,
    ],
  };
  const r = convertCloseQuery(q, maps);
  assertEquals(r.missing, []);
  assertEquals(r.filters, {
    match: 'all',
    conditions: [
      { field: 'custom:bundesland', op: 'equals', value: 'Baden-Württemberg' },
      { field: 'status', op: 'in', value: ['st-neu', 'st-wv'] },
      { field: 'last_call', op: 'older_than_days', value: 30 },
      { field: 'custom:gesperrt_bis', op: 'past_or_empty' },
    ],
  });
});

Deno.test('Close-Smart-View: PLZ-Bereiche, mindestens ein Anruf, älter als 7 Tage', () => {
  const zip = (v: string) => ({ type: 'has_related', related_object_type: 'address', related_query: reg('zipcode', { type: 'text', mode: 'beginning_of_words', value: v }, false, 'address') });
  const q = {
    type: 'and',
    queries: [
      lead,
      { type: 'or', queries: [reg('addresses.zipcode', { type: 'text', mode: 'beginning_of_words', value: '782' }), reg('addresses.zipcode', { type: 'text', mode: 'beginning_of_words', value: '783' })] },
      reg('num_calls', { type: 'number_range', gte: 1 }),
      reg('last_call_date', { type: 'moment_range', on_or_after: null, before: daysAgo(7) }),
      zip('9'),
    ],
  };
  const r = convertCloseQuery(q, maps);
  assertEquals(r.missing, []);
  assertEquals(r.filters.conditions, [
    { field: 'zip', op: 'starts_with', value: '782,783' },
    { field: 'call_count', op: 'gte', value: 1 },
    { field: 'last_call', op: 'older_than_days', value: 7 },
    { field: 'zip', op: 'starts_with', value: '9' },
  ]);
});

Deno.test('Close-Smart-View: geprüft & nie angerufen, PLZ nicht 9', () => {
  const q = {
    type: 'and',
    queries: [
      lead,
      cf('cf_geprueft', { type: 'term', values: ['JA'] }),
      { type: 'has_related', negate: true, this_object_type: 'lead', related_object_type: 'call' },
      { type: 'not', query: reg('zipcode', { type: 'text', mode: 'beginning_of_words', value: '9' }, false, 'address') },
    ],
  };
  const r = convertCloseQuery(q, maps);
  assertEquals(r.missing, []);
  assertEquals(r.filters.conditions, [
    { field: 'custom:lead_geprueft', op: 'equals', value: 'JA' },
    { field: 'last_call', op: 'never' },
    { field: 'zip', op: 'not_starts_with', value: '9' },
  ]);
});

Deno.test('Close-Smart-View: „eine der Bedingungen“ oben wird „Match any“', () => {
  const q = { type: 'and', queries: [lead, { type: 'or', queries: [cf('cf_inhaber', { type: 'exists' }, true), cf('cf_manuell', { type: 'term', values: ['Ja'] })] }] };
  const r = convertCloseQuery(q, maps);
  assertEquals(r.missing, []);
  assertEquals(r.filters, { match: 'any', conditions: [{ field: 'custom:inhaber', op: 'empty' }, { field: 'custom:manuell_pruefen', op: 'equals', value: 'Ja' }] });
});

Deno.test('Close-Smart-View: Zuständig bin ich, Zahl zwischen, Status nicht Kunde, Textsuche', () => {
  const q = {
    type: 'and',
    queries: [
      cf('cf_owner', { type: 'current_user' }),
      cf('cf_filialen', { type: 'number_range', gt: 1, lte: 5 }),
      reg('status_id', { type: 'reference', reference_type: 'status.lead', object_ids: ['stat_kunde'] }, true),
      { type: 'text', mode: 'phrase', value: 'Apotheke am Markt' },
      reg('date_created', { type: 'moment_range', on_or_after: daysAgo(14), before: null }),
    ],
  };
  const r = convertCloseQuery(q, maps);
  assertEquals(r.missing, []);
  assertEquals(r.filters.q, 'Apotheke am Markt');
  assertEquals(r.filters.conditions, [
    { field: 'owner', op: 'me' },
    { field: 'custom:anzahl_filialen', op: 'gte', value: 2 },
    { field: 'custom:anzahl_filialen', op: 'lt', value: 6 },
    { field: 'status', op: 'not_in', value: ['st-kunde'] },
    { field: 'created', op: 'within_days', value: 14 },
  ]);
});

Deno.test('Close-Smart-View: Unübersetzbares wird benannt, der Rest bleibt', () => {
  const q = {
    type: 'and',
    queries: [
      statusNeuWv,
      cf('cf_alt', { type: 'term', values: ['x'] }),
      reg('date_created', { type: 'moment_range', on_or_after: { type: 'fixed_local_date', value: '2026-01-01' }, before: null }),
      { type: 'saved_search', saved_search_id: 'save_x' },
      reg('lead_source_magic', { type: 'exists' }),
      { type: 'or', queries: [statusNeuWv, { type: 'and', queries: [cf('cf_geprueft', { type: 'term', values: ['JA'] }), reg('num_calls', { type: 'number_range', gte: 3 })] }] },
    ],
  };
  const r = convertCloseQuery(q, maps);
  assertEquals(r.filters.conditions, [{ field: 'status', op: 'in', value: ['st-neu', 'st-wv'] }]);
  assertEquals(r.missing.length, 5);
  assert(r.missing[0].includes('Altes Feld'), r.missing[0]);
  const d = viewDescription(r.missing);
  assert(d.startsWith('Aus Close übernommen – nicht übersetzt:') && d.endsWith('Bitte die Filter prüfen.'), d);
  assertEquals(viewDescription([]), 'Aus Close übernommen.');
  assertEquals(convertCloseQuery(null, maps).missing, ['keine lesbare Abfrage']);
});

Deno.test('Close-Smart-View: Datumsangaben und Sortierung', () => {
  assertEquals(momentDays({ type: 'now' }), 0);
  assertEquals(momentDays(daysAgo(30)), -30);
  assertEquals(momentDays({ type: 'offset', direction: 'future', moment: { type: 'start_of_day' }, offset: { weeks: 2 } }), 14);
  assertEquals(momentDays({ type: 'fixed_local_date', value: '2026-01-01' }), null);
  // eigenes Datumsfeld: in den nächsten 7 Tagen
  const r = convertCloseQuery(cf('cf_lock', { type: 'moment_range', on_or_after: { type: 'start_of_day' }, before: { type: 'offset', direction: 'future', offset: { days: 7 } } }), maps);
  assertEquals(r.filters.conditions, [{ field: 'custom:gesperrt_bis', op: 'within_next_days', value: 7 }]);
  assertEquals(convertCloseSort([{ direction: 'desc', field: { type: 'regular_field', object_type: 'lead', field_name: 'date_created' } }]), { field: 'created_at', dir: 'desc' });
  assertEquals(convertCloseSort([{ direction: 'asc', field: { type: 'custom_field', custom_field_id: 'cf_x' } }]), null);
});
