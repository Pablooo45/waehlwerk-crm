// Berichte wie in Close: Übersicht, Vergleich im Team, Statuswechsel, Opportunity-Funnel, beste Anrufzeiten, Formular-Auswertung.

import { ArrowDown, ArrowUp, Download, Table2 } from 'lucide-react';
import { type ReactNode, useMemo, useState } from 'react';
import { useApp } from '../../app/context.tsx';
import { useAsync, useLookups } from '../../app/hooks.ts';
import { navigate, routeHref } from '../../app/router.ts';
import { downloadText, toCsv } from '../../lib/csv.ts';
import { addDays, isoDay, rangePresets } from '../../lib/dates.ts';
import { formatMoney, formatNumber, formatPercent, formatTalkTime } from '../../lib/format.ts';
import type { ActivityRow, CallHourRow, DailyRow, ID } from '../../lib/types.ts';
import { Avatar, cx, Empty, Loading, Tabs, useUi } from '../../ui/ui.tsx';
import { functionLabel } from '../settings/Team.tsx';
import { BarList, type ColumnDatum, StackedColumns } from './charts.tsx';

type Tab = 'overview' | 'compare' | 'status' | 'funnel' | 'hours' | 'forms';
const TABS: { value: Tab; label: string }[] = [
  { value: 'overview', label: 'Übersicht' },
  { value: 'compare', label: 'Team-Vergleich' },
  { value: 'status', label: 'Statuswechsel' },
  { value: 'funnel', label: 'Opportunity-Funnel' },
  { value: 'hours', label: 'Beste Anrufzeiten' },
  { value: 'forms', label: 'Eigene Aktivitäten' },
];

export default function ReportsPage({ tab: tabParam }: { tab: string | null }) {
  const { ref, me, can } = useApp();
  const tab: Tab = (TABS.find((t) => t.value === tabParam)?.value ?? 'overview') as Tab;
  const presets = rangePresets();
  const [range, setRange] = useState('week');
  const [scope, setScope] = useState<string>(can('view_team_reports') ? 'all' : `u:${me.id}`);
  const preset = presets.find((p) => p.key === range) ?? presets[2];
  const team = can('view_team_reports');

  // Auswahl → Liste von Personen (null = alle)
  const users: ID[] | null = useMemo(() => {
    if (!team) return [me.id];
    if (scope === 'all') return null;
    if (scope.startsWith('g:')) return ref.groupMembers.filter((m) => m.group_id === scope.slice(2)).map((m) => m.user_id);
    if (scope.startsWith('f:')) return ref.profiles.filter((p) => p.team_function === scope.slice(2)).map((p) => p.id);
    return [scope.slice(2)];
  }, [scope, team, me.id, ref.groupMembers, ref.profiles]);

  const functions = [...new Set(ref.profiles.filter((p) => p.active).map((p) => p.team_function))];

  return (
    <div className="page reports-page">
      <div className="page-head">
        <h1>Berichte</h1>
      </div>
      <Tabs value={tab} onChange={(t) => navigate(routeHref({ name: 'reports', tab: t === 'overview' ? null : t }))} tabs={TABS} />
      <div className="filterbar mt-12">
        <select className="select" style={{ width: 'auto' }} value={range} onChange={(e) => setRange(e.target.value)} aria-label="Zeitraum">
          {presets.map((p) => (
            <option key={p.key} value={p.key}>{p.label}</option>
          ))}
        </select>
        {team ? (
          <select className="select" style={{ width: 'auto' }} value={scope} onChange={(e) => setScope(e.target.value)} aria-label="Wer">
            <option value="all">Ganzes Team</option>
            {ref.groups.length ? (
              <optgroup label="Gruppen">
                {ref.groups.map((g) => <option key={g.id} value={`g:${g.id}`}>{g.name}</option>)}
              </optgroup>
            ) : null}
            <optgroup label="Funktion">
              {functions.map((f) => <option key={f} value={`f:${f}`}>{functionLabel(f)}</option>)}
            </optgroup>
            <optgroup label="Person">
              {ref.profiles.filter((p) => p.active).map((p) => <option key={p.id} value={`u:${p.id}`}>{p.full_name || p.email}</option>)}
            </optgroup>
          </select>
        ) : (
          <span className="small muted">Deine Zahlen. Team-Zahlen sieht, wer das Recht „Team-Berichte sehen“ hat.</span>
        )}
      </div>
      {tab === 'overview' ? <Overview from={preset.from} to={preset.to} users={users} /> : null}
      {tab === 'compare' ? <Compare from={preset.from} to={preset.to} users={users} label={preset.label} /> : null}
      {tab === 'status' ? <StatusChanges from={preset.from} to={preset.to} users={users} /> : null}
      {tab === 'funnel' ? <Funnel from={preset.from} to={preset.to} users={users} /> : null}
      {tab === 'hours' ? <CallHours from={preset.from} to={preset.to} users={users} /> : null}
      {tab === 'forms' ? <FormValues from={preset.from} to={preset.to} users={users} /> : null}
    </div>
  );
}

interface RangeProps {
  from: Date;
  to: Date;
  users: ID[] | null;
}

function sumRows(rows: ActivityRow[]) {
  return rows.reduce(
    (s, r) => ({
      dials: s.dials + r.dials,
      reached: s.reached + r.reached,
      meetings: s.meetings + r.meetings_logged,
      booked: s.booked + r.meetings_booked,
      held: s.held + r.meetings_held,
      talk: s.talk + r.talk_seconds,
      won: s.won + r.deals_won,
      value: s.value + r.won_value,
    }),
    { dials: 0, reached: 0, meetings: 0, booked: 0, held: 0, talk: 0, won: 0, value: 0 },
  );
}

// ---------- Übersicht ----------
function Overview({ from, to, users }: RangeProps) {
  const { store } = useApp();
  const { profileById, outcomeByKey, statusById } = useLookups();
  const [table, setTable] = useState(false);
  const single = users?.length === 1 ? users[0] : null;
  const q = useAsync(
    async () => {
      const [activity, daily, outcomes, statuses] = await Promise.all([
        store.reportActivity(from, to, users),
        store.reportDaily(from, to, single, users),
        store.reportOutcomes(from, to, single, users),
        store.reportStatusCounts(),
      ]);
      return { activity, daily, outcomes, statuses };
    },
    [store, from.getTime(), to.getTime(), JSON.stringify(users)],
    ['calls', 'meetings', 'opportunities'],
  );
  const rows = (q.data?.activity ?? []).filter((r) => r.dials || r.meetings_booked || r.deals_won || r.notes || r.emails || r.sms || r.forms);
  const sum = sumRows(q.data?.activity ?? []);

  const columns: ColumnDatum[] = useMemo(() => {
    const byDay = new Map((q.data?.daily ?? []).map((d: DailyRow) => [d.day, d]));
    const out: ColumnDatum[] = [];
    const end = to.getTime() > Date.now() ? new Date() : addDays(to, -1);
    for (let d = new Date(from); d <= end; d = addDays(d, 1)) {
      const key = isoDay(d);
      const row = byDay.get(key);
      const weekend = d.getDay() === 0 || d.getDay() === 6;
      if (weekend && !row) continue;
      out.push({
        key,
        label: `${d.getDate()}.${d.getMonth() + 1}.`,
        title: d.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' }),
        primary: row?.reached ?? 0,
        rest: Math.max(0, (row?.dials ?? 0) - (row?.reached ?? 0)),
        extra: [
          { label: 'Termine gelegt', value: formatNumber(row?.meetings ?? 0) },
          { label: 'Gesprächszeit', value: formatTalkTime(row?.talk_seconds ?? 0) },
        ],
      });
    }
    return out;
  }, [q.data, from, to]);

  const maxDials = Math.max(1, ...rows.map((r) => r.dials));
  if (q.loading && !q.data) return <Loading />;
  if (q.error) return <div className="callout err">{q.error}</div>;

  return (
    <div style={{ opacity: q.loading ? 0.6 : 1 }}>
      <div className="kpis">
        <div className="kpi"><div className="v">{formatNumber(sum.dials)}</div><div className="k">Anwahlversuche</div></div>
        <div className="kpi"><div className="v">{formatNumber(sum.reached)}</div><div className="k">Entscheider erreicht, {formatPercent(sum.reached, sum.dials)}</div></div>
        <div className="kpi"><div className="v">{formatNumber(sum.meetings)}</div><div className="k">Termine gelegt, {formatPercent(sum.meetings, sum.reached)} der Erreichten</div></div>
        <div className="kpi"><div className="v">{formatNumber(sum.held)}</div><div className="k">Termine stattgefunden, von {formatNumber(sum.booked)} gebuchten</div></div>
        <div className="kpi"><div className="v">{formatTalkTime(sum.talk)}</div><div className="k">Gesprächszeit</div></div>
        <div className="kpi"><div className="v">{formatNumber(sum.won)}</div><div className="k">Abschlüsse, {formatMoney(sum.value)}</div></div>
      </div>

      <div className="report-grid">
        <div className="panel">
          <div className="panel-head">
            <h2>Anwahlen pro Tag</h2>
            <button type="button" className="btn small ghost" onClick={() => setTable(!table)} aria-pressed={table}>
              <Table2 /> {table ? 'Diagramm' : 'Tabelle'}
            </button>
          </div>
          <div className="panel-body">
            {!columns.length ? (
              <p className="muted small">Keine Anrufe in diesem Zeitraum.</p>
            ) : table ? (
              <div className="table-wrap" style={{ border: 0 }}>
                <table className="table">
                  <thead><tr><th>Tag</th><th>Anwahlen</th><th>Erreicht</th><th>Termine</th></tr></thead>
                  <tbody>
                    {columns.map((c) => (
                      <tr key={c.key}>
                        <td>{c.title}</td>
                        <td className="num">{c.primary + c.rest}</td>
                        <td className="num">{c.primary}</td>
                        <td className="num">{c.extra?.[0]?.value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <StackedColumns data={columns} primaryLabel="Entscheider erreicht" restLabel="Nicht erreicht" />
            )}
          </div>
        </div>
        <div className="panel">
          <div className="panel-head"><h2>Ergebnisse der Anrufe</h2></div>
          <div className="panel-body">
            {(q.data?.outcomes ?? []).length ? (
              <BarList
                rows={(q.data?.outcomes ?? []).map((o) => ({
                  key: o.outcome,
                  label: o.outcome === '_none' ? 'Ohne Ergebnis' : outcomeByKey.get(o.outcome)?.label ?? o.outcome,
                  color: o.outcome === '_none' ? 'var(--line-strong)' : outcomeByKey.get(o.outcome)?.color,
                  value: o.cnt,
                }))}
              />
            ) : (
              <p className="muted small">Noch keine Anrufe.</p>
            )}
          </div>
        </div>
      </div>

      <div className="panel" style={{ marginBottom: 16 }}>
        <div className="panel-head"><h2>Team</h2></div>
        <p className="small muted" style={{ padding: '0 14px 10px' }}>
          „Termine gelegt“ zählt Anrufe mit diesem Ergebnis, „gebucht“ die echten Termine im Kalender mit dieser Person als Opener. Abschlüsse zählen für die zuständige Person der Opportunity.
        </p>
        {!rows.length ? (
          <p className="muted small" style={{ padding: '0 14px 14px' }}>Keine Aktivität in diesem Zeitraum.</p>
        ) : (
          <div className="table-wrap" style={{ border: 0, borderTop: '1px solid var(--line)', borderRadius: 0 }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Person</th>
                  <th>Anwahlen</th>
                  <th>Erreicht</th>
                  <th className="hide-mobile">Quote</th>
                  <th>Termine gelegt</th>
                  <th className="hide-mobile">gebucht</th>
                  <th className="hide-mobile">stattgefunden</th>
                  <th className="hide-mobile">Gesprächszeit</th>
                  <th>Abschlüsse</th>
                  <th className="hide-mobile">Wert</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const p = profileById.get(r.user_id);
                  return (
                    <tr key={r.user_id}>
                      <td>
                        <span className="row">
                          <Avatar name={p?.full_name ?? '?'} color={p?.color} />
                          <span>
                            <strong>{p?.full_name || p?.email || 'Unbekannt'}</strong>
                            <span className="xs muted"> {p ? functionLabel(p.team_function) : ''}</span>
                          </span>
                        </span>
                      </td>
                      <td className="num" style={{ minWidth: 120 }}>
                        <span className="row viz">
                          <span style={{ width: 34 }}>{formatNumber(r.dials)}</span>
                          <span className="bar-track grow">
                            <div style={{ width: `${(r.dials / maxDials) * 100}%`, background: 'var(--viz-bar)', borderRadius: '0 4px 4px 0' }} />
                          </span>
                        </span>
                      </td>
                      <td className="num">{formatNumber(r.reached)}</td>
                      <td className="num hide-mobile">{formatPercent(r.reached, r.dials)}</td>
                      <td className="num">{formatNumber(r.meetings_logged)}</td>
                      <td className="num hide-mobile">{formatNumber(r.meetings_booked)}</td>
                      <td className="num hide-mobile">{formatNumber(r.meetings_held)}</td>
                      <td className="num hide-mobile">{formatTalkTime(r.talk_seconds)}</td>
                      <td className="num">{formatNumber(r.deals_won)}</td>
                      <td className="num hide-mobile">{formatMoney(r.won_value)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2>Leads nach Status</h2>
          <span className="small muted">alle sichtbaren Leads, unabhängig vom Zeitraum</span>
        </div>
        <div className="panel-body">
          <BarList
            rows={[...(q.data?.statuses ?? [])]
              .sort((a, b) => (statusById.get(a.status_id ?? '')?.sort ?? 999) - (statusById.get(b.status_id ?? '')?.sort ?? 999))
              .map((s) => ({
                key: s.status_id ?? 'none',
                label: s.status_id ? statusById.get(s.status_id)?.label ?? 'Unbekannt' : 'Ohne Status',
                color: s.status_id ? statusById.get(s.status_id)?.color : 'var(--line-strong)',
                value: s.cnt,
              }))}
          />
        </div>
      </div>
    </div>
  );
}

// ---------- Team-Vergleich ----------
type Metric = { key: keyof ActivityRow | 'quote'; label: string; short?: string; fmt?: (r: ActivityRow) => string; value: (r: ActivityRow) => number };

const METRICS: Metric[] = [
  { key: 'dials', label: 'Anwahlen', value: (r) => r.dials },
  { key: 'reached', label: 'Entscheider erreicht', short: 'Erreicht', value: (r) => r.reached },
  { key: 'quote', label: 'Erreichbarkeit', short: 'Quote', value: (r) => (r.dials ? r.reached / r.dials : 0), fmt: (r) => formatPercent(r.reached, r.dials) },
  { key: 'meetings_logged', label: 'Termine gelegt', short: 'Gelegt', value: (r) => r.meetings_logged },
  { key: 'meetings_booked', label: 'Termine gebucht', short: 'Gebucht', value: (r) => r.meetings_booked },
  { key: 'meetings_held', label: 'Termine stattgefunden', short: 'Stattgef.', value: (r) => r.meetings_held },
  { key: 'talk_seconds', label: 'Gesprächszeit', short: 'Gespräch', value: (r) => r.talk_seconds, fmt: (r) => formatTalkTime(r.talk_seconds) },
  { key: 'inbound', label: 'Eingehende Anrufe', short: 'Eingehend', value: (r) => r.inbound },
  { key: 'notes', label: 'Notizen', value: (r) => r.notes },
  { key: 'emails', label: 'E-Mails', value: (r) => r.emails },
  { key: 'sms', label: 'SMS', value: (r) => r.sms },
  { key: 'forms', label: 'Aktivitäten', value: (r) => r.forms },
  { key: 'tasks_done', label: 'Aufgaben erledigt', short: 'Aufgaben', value: (r) => r.tasks_done },
  { key: 'opps_created', label: 'Opportunities angelegt', short: 'Opps neu', value: (r) => r.opps_created },
  { key: 'deals_won', label: 'Abschlüsse', value: (r) => r.deals_won },
  { key: 'won_value', label: 'Gewonnener Wert', short: 'Wert', value: (r) => r.won_value, fmt: (r) => formatMoney(r.won_value) },
];

function Compare({ from, to, users, label }: RangeProps & { label: string }) {
  const { store, can } = useApp();
  const { toast } = useUi();
  const { profileById, name } = useLookups();
  const [sort, setSort] = useState<{ key: Metric['key']; dir: 'asc' | 'desc' }>({ key: 'dials', dir: 'desc' });
  const q = useAsync(() => store.reportActivity(from, to, users), [store, from.getTime(), to.getTime(), JSON.stringify(users)], ['calls', 'meetings', 'opportunities', 'tasks']);
  const rows = useMemo(() => {
    const m = METRICS.find((x) => x.key === sort.key)!;
    return [...(q.data ?? [])].sort((a, b) => (m.value(a) - m.value(b)) * (sort.dir === 'asc' ? 1 : -1));
  }, [q.data, sort]);
  const totals = useMemo(() => {
    const t = { user_id: 'total' } as ActivityRow;
    for (const m of METRICS) if (m.key !== 'quote') (t as unknown as Record<string, number>)[m.key] = rows.reduce((s, r) => s + Number(r[m.key as keyof ActivityRow] ?? 0), 0);
    return t;
  }, [rows]);
  const max = useMemo(() => Object.fromEntries(METRICS.map((m) => [m.key, Math.max(1, ...rows.map((r) => m.value(r)))])), [rows]);

  const exportCsv = () => {
    const header = ['Person', 'Funktion', ...METRICS.map((m) => m.label)];
    const lines = rows.map((r) => [name(r.user_id), functionLabel(profileById.get(r.user_id)?.team_function ?? 'other'), ...METRICS.map((m) => (m.key === 'quote' ? formatPercent(r.reached, r.dials) : m.key === 'talk_seconds' ? Math.round(r.talk_seconds / 60) : m.value(r)))]);
    if (__DEMO_BUILD__) {
      toast('In der Demo-Vorschau sind Downloads gesperrt.');
      return;
    }
    downloadText(`team-vergleich-${label.toLowerCase().replace(/\s+/g, '-')}.csv`, toCsv([header, ...lines]));
  };

  if (q.loading && !q.data) return <Loading />;
  if (q.error) return <div className="callout err">{q.error}</div>;
  if (!rows.length) return <Empty title="Keine Daten">In diesem Zeitraum gab es keine Aktivität.</Empty>;

  const head = (m: Metric) => (
    <th key={m.key} className="num">
      <button type="button" onClick={() => setSort((s) => ({ key: m.key, dir: s.key === m.key && s.dir === 'desc' ? 'asc' : 'desc' }))} title={m.label}>
        {m.short ?? m.label} {sort.key === m.key ? sort.dir === 'asc' ? <ArrowUp size={13} /> : <ArrowDown size={13} /> : null}
      </button>
    </th>
  );

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Team-Vergleich</h2>
        {can('export') ? <button type="button" className="btn small" onClick={exportCsv}><Download /> CSV</button> : null}
      </div>
      <div className="table-wrap compare-table" style={{ border: 0, borderTop: '1px solid var(--line)', borderRadius: 0 }}>
        <table className="table">
          <thead>
            <tr>
              <th>Person</th>
              {METRICS.map(head)}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const p = profileById.get(r.user_id);
              return (
                <tr key={r.user_id}>
                  <td className="nowrap">
                    <span className="row gap-8">
                      <Avatar name={p?.full_name ?? '?'} color={p?.color} />
                      <strong>{p?.full_name || 'Unbekannt'}</strong>
                    </span>
                  </td>
                  {METRICS.map((m) => {
                    const v = m.value(r);
                    const best = v > 0 && v === max[m.key] && rows.length > 1;
                    return (
                      <td key={m.key} className={cx('num nowrap', best && 'best')} title={best ? 'Bester Wert' : undefined}>
                        {m.fmt ? m.fmt(r) : formatNumber(v)}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <th>Summe</th>
              {METRICS.map((m) => (
                <th key={m.key} className="num nowrap">{m.key === 'quote' ? formatPercent(totals.reached, totals.dials) : m.fmt ? m.fmt(totals) : formatNumber(m.value(totals))}</th>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

// ---------- Statuswechsel ----------
function StatusChanges({ from, to, users }: RangeProps) {
  const { store } = useApp();
  const { statusById } = useLookups();
  const q = useAsync(() => store.reportStatusChanges(from, to, users), [store, from.getTime(), to.getTime(), JSON.stringify(users)], ['leads']);
  const label = (id: string | null) => (id ? statusById.get(id)?.label ?? 'Unbekannt' : 'ohne Status');
  const color = (id: string | null) => (id ? statusById.get(id)?.color : 'var(--line-strong)');
  const rows = [...(q.data ?? [])].sort((a, b) => b.cnt - a.cnt);
  const into = new Map<string, number>();
  for (const r of rows) into.set(r.to_status ?? 'none', (into.get(r.to_status ?? 'none') ?? 0) + r.cnt);

  if (q.loading && !q.data) return <Loading />;
  if (q.error) return <div className="callout err">{q.error}</div>;
  if (!rows.length) return <Empty title="Keine Statuswechsel">In diesem Zeitraum hat sich kein Lead-Status geändert.</Empty>;

  return (
    <div className="report-grid">
      <div className="panel">
        <div className="panel-head"><h2>Neu in Status</h2></div>
        <div className="panel-body">
          <BarList rows={[...into.entries()].sort((a, b) => b[1] - a[1]).map(([id, cnt]) => ({ key: id, label: label(id === 'none' ? null : id), color: color(id === 'none' ? null : id), value: cnt }))} />
        </div>
      </div>
      <div className="panel">
        <div className="panel-head"><h2>Von → nach</h2></div>
        <div className="table-wrap" style={{ border: 0 }}>
          <table className="table">
            <thead><tr><th>Von</th><th>Nach</th><th className="num">Leads</th></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td><span className="row gap-4"><span className="dot" style={{ background: color(r.from_status) }} aria-hidden="true" />{label(r.from_status)}</span></td>
                  <td><span className="row gap-4"><span className="dot" style={{ background: color(r.to_status) }} aria-hidden="true" /><strong>{label(r.to_status)}</strong></span></td>
                  <td className="num">{formatNumber(r.cnt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ---------- Funnel ----------
function Funnel({ from, to, users }: RangeProps) {
  const { store, ref } = useApp();
  const [pipe, setPipe] = useState(ref.pipelines[0]?.id ?? '');
  const statuses = ref.oppStatuses.filter((s) => s.pipeline_id === pipe).sort((a, b) => a.sort - b.sort);
  const q = useAsync(() => (pipe ? store.reportFunnel(from, to, pipe, users) : Promise.resolve([])), [store, pipe, from.getTime(), to.getTime(), JSON.stringify(users)], ['opportunities']);
  const byId = new Map((q.data ?? []).map((r) => [r.status_id, r]));
  const open = statuses.filter((s) => s.kind === 'open');
  const won = statuses.filter((s) => s.kind === 'won');
  const lost = statuses.filter((s) => s.kind === 'lost');
  const first = byId.get(open[0]?.id ?? '')?.reached ?? 0;
  const maxReached = Math.max(1, ...statuses.map((s) => byId.get(s.id)?.reached ?? 0));

  if (!ref.pipelines.length) return <Empty title="Keine Pipeline">Pipelines legt an, wer „Einstellungen anpassen“ darf.</Empty>;

  const row = (s: (typeof statuses)[number]) => {
    const r = byId.get(s.id);
    const reached = r?.reached ?? 0;
    return (
      <div key={s.id} className="funnel-row">
        <span className="funnel-label"><span className="dot" style={{ background: s.color }} aria-hidden="true" />{s.label}</span>
        <span className="funnel-track"><span className={cx('funnel-fill', s.kind)} style={{ width: `${(reached / maxReached) * 100}%` }} /></span>
        <strong className="num funnel-n">{formatNumber(reached)}</strong>
        <span className="num muted small funnel-pct">{s.kind === 'open' && s.id !== open[0]?.id && first ? formatPercent(reached, first) : s.kind !== 'open' && first ? formatPercent(reached, first) : ''}</span>
        <span className="num small funnel-val">{formatMoney(r?.reached_value ?? 0)}</span>
        <span className="num muted small funnel-now" title="Aktuell in dieser Phase">{r?.current_cnt ? `${r.current_cnt} jetzt` : ''}</span>
      </div>
    );
  };

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Opportunity-Funnel</h2>
        {ref.pipelines.length > 1 ? (
          <select className="select" style={{ width: 'auto' }} value={pipe} onChange={(e) => setPipe(e.target.value)} aria-label="Pipeline">
            {ref.pipelines.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        ) : null}
      </div>
      <p className="small muted" style={{ padding: '0 14px' }}>
        Wie viele Opportunities, die im Zeitraum angelegt wurden, jede Phase erreicht haben – und welcher Anteil von der ersten Phase bis zum Abschluss kommt.
      </p>
      <div className="panel-body">
        {q.loading && !q.data ? <Loading /> : (
          <div className="funnel viz">
            {open.map(row)}
            {won.length ? <div className="funnel-sep">Ergebnis</div> : null}
            {won.map(row)}
            {lost.map(row)}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- Beste Anrufzeiten ----------
const DOW = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

function CallHours({ from, to, users }: RangeProps) {
  const { store } = useApp();
  const [metric, setMetric] = useState<'rate' | 'dials' | 'reached'>('rate');
  const q = useAsync(() => store.reportCallHours(from, to, users), [store, from.getTime(), to.getTime(), JSON.stringify(users)], ['calls']);
  const cells = new Map<string, CallHourRow>((q.data ?? []).map((r) => [`${r.dow}-${r.hour}`, r]));
  const rows = q.data ?? [];
  const days = [1, 2, 3, 4, 5, ...(rows.some((r) => r.dow >= 6) ? [6, 7] : [])];
  const hours = Array.from({ length: 13 }, (_, i) => i + 7);
  const value = (r: CallHourRow | undefined) => (!r ? 0 : metric === 'rate' ? (r.dials >= 3 ? r.reached / r.dials : 0) : metric === 'dials' ? r.dials : r.reached);
  const max = Math.max(0.0001, ...rows.map((r) => value(r)));
  const best = [...rows].filter((r) => r.dials >= 5).sort((a, b) => b.reached / b.dials - a.reached / a.dials).slice(0, 3);

  if (q.loading && !q.data) return <Loading />;
  if (q.error) return <div className="callout err">{q.error}</div>;
  if (!rows.length) return <Empty title="Noch zu wenig Anrufe">Sobald es Anrufe im Zeitraum gibt, siehst du hier, wann Entscheider am besten erreichbar sind.</Empty>;

  const fmt = (r: CallHourRow | undefined): ReactNode => {
    if (!r || !r.dials) return '';
    if (metric === 'rate') return r.dials >= 3 ? `${Math.round((r.reached / r.dials) * 100)}` : '·';
    return formatNumber(metric === 'dials' ? r.dials : r.reached);
  };

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Beste Anrufzeiten</h2>
        <select className="select" style={{ width: 'auto' }} value={metric} onChange={(e) => setMetric(e.target.value as typeof metric)} aria-label="Wert">
          <option value="rate">Erreichbarkeit in %</option>
          <option value="reached">Entscheider erreicht</option>
          <option value="dials">Anwahlen</option>
        </select>
      </div>
      <div className="panel-body">
        {best.length ? (
          <p className="small mt-0">
            Am besten erreichbar: {best.map((b) => `${DOW[b.dow - 1]} ${b.hour}–${b.hour + 1} Uhr (${Math.round((b.reached / b.dials) * 100)} %)`).join(', ')}.
          </p>
        ) : null}
        <div className="heatmap-wrap">
          <table className="heatmap" aria-label="Anrufe nach Wochentag und Uhrzeit">
            <thead>
              <tr>
                <th />
                {hours.map((h) => <th key={h} scope="col">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {days.map((d) => (
                <tr key={d}>
                  <th scope="row">{DOW[d - 1]}</th>
                  {hours.map((h) => {
                    const r = cells.get(`${d}-${h}`);
                    const v = value(r);
                    const step = !r || !r.dials ? 0 : Math.min(5, 1 + Math.floor((v / max) * 4.999));
                    return (
                      <td key={h} className={cx('hm', `s${step}`)} title={r ? `${DOW[d - 1]} ${h}–${h + 1} Uhr: ${r.dials} Anwahlen, ${r.reached} erreicht (${formatPercent(r.reached, r.dials)})` : `${DOW[d - 1]} ${h} Uhr: keine Anrufe`}>
                        {fmt(r)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="heatmap-legend xs muted">
          <span>wenig</span>
          {[1, 2, 3, 4, 5].map((s) => <i key={s} className={cx('hm', `s${s}`)} aria-hidden="true" />)}
          <span>viel</span>
          {metric === 'rate' ? <span>· = unter 3 Anwahlen, nicht aussagekräftig</span> : null}
        </div>
      </div>
    </div>
  );
}

// ---------- Formulare ----------
function FormValues({ from, to, users }: RangeProps) {
  const { store, ref } = useApp();
  const types = ref.activityTypes.filter((t) => t.fields.some((f) => ['choice', 'multichoice', 'checkbox', 'user'].includes(f.type)));
  const [typeId, setTypeId] = useState(types[0]?.id ?? '');
  const type = types.find((t) => t.id === typeId);
  const fields = (type?.fields ?? []).filter((f) => ['choice', 'multichoice', 'checkbox', 'user'].includes(f.type));
  const [fieldKey, setFieldKey] = useState(fields[0]?.key ?? '');
  const field = fields.find((f) => f.key === fieldKey) ?? fields[0];
  const q = useAsync(
    () => (type && field ? store.reportFormValues(type.id, field.key, from, to, users) : Promise.resolve([])),
    [store, type?.id, field?.key, from.getTime(), to.getTime(), JSON.stringify(users)],
    ['timeline'],
  );
  const { name } = useLookups();

  if (!types.length) return <Empty title="Keine auswertbaren Aktivitäten">Eigene Aktivitäten mit Auswahlfeldern lassen sich hier auswerten (z. B. „Setting-Art“ oder „Interesse“).</Empty>;

  const total = (q.data ?? []).reduce((s, r) => s + r.cnt, 0);
  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Auswertung eigener Aktivitäten</h2>
        <div className="row gap-8">
          <select className="select" style={{ width: 'auto' }} value={typeId} onChange={(e) => { setTypeId(e.target.value); setFieldKey(''); }} aria-label="Aktivität">
            {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <select className="select" style={{ width: 'auto' }} value={field?.key ?? ''} onChange={(e) => setFieldKey(e.target.value)} aria-label="Feld">
            {fields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
          </select>
        </div>
      </div>
      <div className="panel-body">
        {q.loading && !q.data ? <Loading /> : !(q.data ?? []).length ? (
          <p className="muted small">In diesem Zeitraum wurde „{type?.name}“ nicht ausgefüllt.</p>
        ) : (
          <>
            <p className="small muted mt-0">{formatNumber(total)} Antworten</p>
            <BarList
              rows={(q.data ?? []).map((r) => ({
                key: r.value,
                label: r.value === '' ? 'leer' : field?.type === 'user' ? name(r.value) : field?.type === 'checkbox' ? (r.value === 'true' ? 'ja' : 'nein') : r.value,
                value: r.cnt,
              }))}
            />
          </>
        )}
      </div>
    </div>
  );
}
