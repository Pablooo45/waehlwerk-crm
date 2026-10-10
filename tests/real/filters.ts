// Smart-View-Filter: Datenbank und JavaScript müssen dasselbe Ergebnis liefern.
// Vergleicht für jedes Feld und jede Bedingung die Anzahl aus PostgREST (pgFilter.ts, echte Leadliste)
// mit derselben Logik in JavaScript (filtering.ts – Demo-Modus und Workflow-Bedingungen).
//
// Läuft gegen die lokale Umgebung:  scripts/local-stack.sh start
//   SERVICE_KEY=$(scripts/local-stack.sh keys | sed -n 's/^SERVICE=//p') deno run -A tests/real/filters.ts

import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
import { matchesFilter } from '../../supabase/functions/_shared/filtering.ts';
import { customFieldDef, FIELD_DEFS, type FieldDef } from '../../src/lib/filters.ts';
import { filterExpr } from '../../src/lib/store/pgFilter.ts';
import type { Condition, CustomField, FilterSet, LeadStatus } from '../../src/lib/types.ts';

const GW = Deno.env.get('GATEWAY_URL') ?? 'http://127.0.0.1:54321';
const KEY = Deno.env.get('SERVICE_KEY');
if (!KEY) {
  console.error('SERVICE_KEY fehlt (scripts/local-stack.sh keys)');
  Deno.exit(2);
}
const sb = createClient(GW, KEY, { auth: { persistSession: false } });

function must<T>(res: { data: T; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data;
}

// ---------- Testfelder für fehlende Typen ----------
const extra = [
  { key: 'ft_haken', label: 'Test Haken', type: 'checkbox', choices: [] },
  { key: 'ft_mehrfach', label: 'Test Mehrfach', type: 'multichoice', choices: ['Rot', 'Grün', 'Blau'] },
  { key: 'ft_person', label: 'Test Person', type: 'user', choices: [] },
];
for (const f of extra) {
  must(await sb.from('custom_fields').upsert({ ...f, entity: 'lead', sort: 900, always_show: false, show_in_list: false, restricted: false, description: '' }, { onConflict: 'key' }), 'Feld');
}

const statuses = must(await sb.from('lead_statuses').select('*').order('sort'), 'Status') as LeadStatus[];
const customFields = (must(await sb.from('custom_fields').select('*').eq('entity', 'lead'), 'Felder') as CustomField[]);
const profiles = must(await sb.from('profiles').select('id, email'), 'Profile') as { id: string; email: string }[];
const outcomes = (must(await sb.from('call_outcomes').select('key'), 'Ergebnisse') as { key: string }[]).map((o) => o.key);
const me = profiles.find((p) => p.email === 'admin@waehlwerk.test')!;
const users = profiles.map((p) => p.id);

// ---------- Testdaten: 400 Leads mit verschiedenen Werten ----------
let seed = 42;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = <T>(xs: T[]): T => xs[Math.floor(rnd() * xs.length)];
const maybe = <T>(v: T, p = 0.5): T | null => (rnd() < p ? v : null);
const daysAgo = (d: number) => new Date(Date.now() - d * 86400_000 - rnd() * 3600_000).toISOString();
const daysAhead = (d: number) => new Date(Date.now() + d * 86400_000 + rnd() * 3600_000).toISOString();
const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

must(await sb.from('leads').delete().like('name', 'Filtertest %'), 'Aufräumen');
const rows = [];
for (let i = 0; i < 400; i++) {
  const custom: Record<string, unknown> = {};
  for (const f of customFields) {
    if (rnd() < 0.35) continue; // leer
    switch (f.type) {
      case 'number': custom[f.key] = Math.floor(rnd() * 10); break;
      case 'choice': if (f.choices.length) custom[f.key] = pick(f.choices); break;
      case 'multichoice': if (f.choices.length) custom[f.key] = f.choices.filter(() => rnd() < 0.5); break;
      case 'checkbox': custom[f.key] = rnd() < 0.5; break;
      case 'date': custom[f.key] = isoDay(new Date(Date.now() + Math.floor(rnd() * 60 - 30) * 86400_000)); break;
      case 'datetime': custom[f.key] = new Date(Date.now() + Math.floor(rnd() * 60 - 30) * 86400_000).toISOString(); break;
      case 'user': custom[f.key] = pick(users); break;
      default: custom[f.key] = pick(['Dr. Müller', 'Schmidt OHG', 'müller & söhne', '']);
    }
  }
  rows.push({
    name: `Filtertest ${i} ${pick(['Adler', 'Bären', 'Löwen', 'Stern'])}-Apotheke`,
    status_id: maybe(pick(statuses).id, 0.9),
    owner_id: maybe(pick(users), 0.7),
    opener_id: maybe(pick(users), 0.4),
    address_city: maybe(pick(['Köln', 'Bonn', 'Frankfurt am Main', 'Bad Homburg']), 0.8),
    address_zip: maybe(pick(['50667', '53111', '60311', '61348', '90402', '20095']), 0.85),
    address_state: maybe(pick(['Hessen', 'Bayern', 'Nordrhein-Westfalen']), 0.6),
    source: maybe(pick(['Close', 'Messe Expopharm', 'Empfehlung']), 0.6),
    last_call_at: maybe(daysAgo(Math.floor(rnd() * 40)), 0.6),
    last_call_outcome: maybe(pick(outcomes), 0.5),
    last_connected_at: maybe(daysAgo(Math.floor(rnd() * 40)), 0.3),
    last_activity_at: maybe(daysAgo(Math.floor(rnd() * 40)), 0.7),
    call_count: Math.floor(rnd() * 6),
    next_task_due: maybe(rnd() < 0.5 ? daysAgo(Math.floor(rnd() * 5)) : daysAhead(Math.floor(rnd() * 5)), 0.5),
    next_meeting_at: maybe(rnd() < 0.5 ? daysAhead(Math.floor(rnd() * 10)) : daysAgo(Math.floor(rnd() * 10)), 0.3),
    created_at: daysAgo(Math.floor(rnd() * 60)),
    do_not_call: rnd() < 0.15,
    custom,
  });
}
must(await sb.from('leads').insert(rows), 'Testleads');

// gespeicherte Werte zurücklesen (Trigger können Felder anpassen)
const leads = [];
for (let off = 0; ; off += 1000) {
  const part = must(await sb.from('leads').select('*').like('name', 'Filtertest %').order('id').range(off, off + 999), 'Leads') as Record<string, unknown>[];
  leads.push(...part);
  if (part.length < 1000) break;
}

// ---------- Bedingungen erzeugen ----------
function values(def: FieldDef, input: string, field: string): unknown[] {
  const cf = field.startsWith('custom:') ? customFields.find((f) => `custom:${f.key}` === field) : undefined;
  switch (input) {
    case 'none': return [undefined];
    case 'number': return [0, 1, 3, 7, 30];
    case 'multi-status': return [[statuses[0].id], [statuses[1].id, statuses[2].id], [`@${statuses[1].label}`]];
    case 'multi-user': return [[me.id], users];
    case 'multi-outcome': return [[outcomes[0]], outcomes.slice(0, 2)];
    case 'choice': return (cf?.choices ?? []).slice(0, 2);
    case 'multi-choice': return [(cf?.choices ?? []).slice(0, 2)];
    case 'text':
      if (def.field === 'zip') return ['50', '5,6', '61348', ' 9 '];
      if (def.field === 'city' || def.field === 'name') return ['köln', 'Bad', 'Apotheke', 'Frankfurt am Main'];
      if (def.field === 'state') return ['Hessen', 'hessen'];
      if (def.field === 'source') return ['Close', 'messe'];
      return ['müller', 'Schmidt OHG', 'x'];
    default: return [undefined];
  }
}

const defs: FieldDef[] = [...FIELD_DEFS, ...customFields.map((f) => customFieldDef(f))];
const filters: { label: string; filter: FilterSet }[] = [];
for (const def of defs) {
  for (const op of def.ops) {
    for (const v of values(def, op.input, def.field)) {
      const c: Condition = { field: def.field, op: op.op, value: v } as Condition;
      filters.push({ label: `${def.field} ${op.op} ${JSON.stringify(v ?? null)}`, filter: { match: 'all', conditions: [c] } });
    }
  }
}
// Kombinationen
const s0 = { field: 'status', op: 'in', value: [statuses[0].id] } as Condition;
const o0 = { field: 'owner', op: 'me' } as Condition;
const c0 = { field: 'last_call', op: 'older_than_days', value: 7 } as Condition;
filters.push({ label: 'alle: Status + ich + 7 Tage', filter: { match: 'all', conditions: [s0, o0, c0] } });
filters.push({ label: 'eine: Status + ich + 7 Tage', filter: { match: 'any', conditions: [s0, o0, c0] } });

// ---------- vergleichen ----------
const ref = { statuses, me, customFields };
const now = new Date();
const ids = new Set(leads.map((l) => l.id as string));
let bad = 0;
for (const { label, filter } of filters) {
  const js = leads.filter((l) => matchesFilter(l as never, filter, ref, now)).length;
  const expr = filterExpr(filter, { me: me.id, statuses, customFields, now });
  let q = sb.from('leads').select('id').like('name', 'Filtertest %');
  if (expr) q = q.or(expr);
  const res = await q.limit(5000);
  if (res.error) {
    bad++;
    console.log(`FEHLER  ${label}: Datenbank meldet ${res.error.message}`);
    continue;
  }
  const db = (res.data as { id: string }[]).filter((r) => ids.has(r.id)).length;
  if (db !== js) {
    bad++;
    console.log(`ANDERS  ${label}: Datenbank ${db}, JavaScript ${js}  (${expr})`);
  }
}
must(await sb.from('leads').delete().like('name', 'Filtertest %'), 'Aufräumen');
console.log(`${filters.length} Filter verglichen, ${bad} Abweichungen`);
Deno.exit(bad ? 1 : 0);
