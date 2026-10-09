// Opportunities wie in Close: mehrere Pipelines, Board (ziehen & ablegen) oder Liste, Summen je Phase.

import { ArrowDown, ArrowUp, Columns3, Download, List, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useApp } from '../../app/context.tsx';
import { useAsync, useLocalState, useLookups } from '../../app/hooks.ts';
import { leadHref, navigate, routeHref } from '../../app/router.ts';
import { bus } from '../../lib/bus.ts';
import { downloadText, toCsv } from '../../lib/csv.ts';
import { addDays, startOfMonth } from '../../lib/dates.ts';
import { formatDate, formatMoney } from '../../lib/format.ts';
import type { Opportunity, OpportunityStatus } from '../../lib/types.ts';
import { Avatar, cx, Empty, errMsg, Loading, Segmented, Tag, useUi } from '../../ui/ui.tsx';
import { OpportunityModal } from '../common/forms.tsx';

const PERIOD_SHORT: Record<Opportunity['value_period'], string> = { monthly: 'mtl.', annual: 'jährl.', one_time: 'einmalig' };

// „490 € mtl. + 2.500 € einmalig“ – Werte mit unterschiedlicher Abrechnung nicht vermischen
export function sumByPeriod(opps: Opportunity[], weighted = false): string {
  const sums: Record<Opportunity['value_period'], number> = { monthly: 0, annual: 0, one_time: 0 };
  for (const o of opps) sums[o.value_period] += weighted ? (o.value * o.confidence) / 100 : o.value;
  const parts = (Object.keys(sums) as Opportunity['value_period'][]).filter((k) => sums[k]).map((k) => `${formatMoney(sums[k])} ${PERIOD_SHORT[k]}`);
  return parts.length ? parts.join(' + ') : formatMoney(0);
}

type CloseRange = 'all' | 'this_month' | 'next_month' | 'quarter' | 'overdue';
type SortKey = 'value' | 'expected_close' | 'confidence' | 'created_at';

export default function PipelinePage({ pipelineId }: { pipelineId: string | null }) {
  const { store, ref, me, can } = useApp();
  const { profileById, name } = useLookups();
  const { toast } = useUi();
  const pipeline = ref.pipelines.find((p) => p.id === pipelineId) ?? ref.pipelines[0];
  const [view, setView] = useLocalState<'board' | 'list'>('opp-view', 'board');
  const [who, setWho] = useState<string>('all');
  const [state, setState] = useState<'open' | 'won' | 'lost' | 'all'>('all');
  const [range, setRange] = useState<CloseRange>('all');
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'expected_close', dir: 'asc' });
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [edit, setEdit] = useState<Opportunity | 'new' | null>(null);

  const q = useAsync(() => (pipeline ? store.listOpportunities({ pipelineId: pipeline.id }) : Promise.resolve([])), [store, pipeline?.id], ['opportunities']);
  const cols: OpportunityStatus[] = useMemo(() => ref.oppStatuses.filter((s) => s.pipeline_id === pipeline?.id).sort((a, b) => a.sort - b.sort), [ref.oppStatuses, pipeline?.id]);
  const kindOf = (o: Opportunity) => cols.find((s) => s.id === o.status_id)?.kind ?? 'open';

  const filtered = useMemo(() => {
    const now = new Date();
    const m0 = startOfMonth(now);
    const m1 = new Date(m0.getFullYear(), m0.getMonth() + 1, 1);
    const m2 = new Date(m0.getFullYear(), m0.getMonth() + 2, 1);
    const q3 = addDays(now, 92);
    return (q.data ?? []).filter((o) => {
      if (who === 'me' && o.user_id !== me.id) return false;
      if (who !== 'all' && who !== 'me' && o.user_id !== who) return false;
      if (view === 'list' && state !== 'all' && kindOf(o) !== state) return false;
      if (range !== 'all') {
        if (!o.expected_close) return false;
        const d = new Date(o.expected_close);
        if (range === 'this_month' && (d < m0 || d >= m1)) return false;
        if (range === 'next_month' && (d < m1 || d >= m2)) return false;
        if (range === 'quarter' && (d < now || d > q3)) return false;
        if (range === 'overdue' && (d >= new Date(now.toDateString()) || kindOf(o) !== 'open')) return false;
      }
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.data, who, state, range, view, me.id, cols]);

  const open = filtered.filter((o) => kindOf(o) === 'open');
  const won = filtered.filter((o) => kindOf(o) === 'won');

  const move = async (oppId: string, statusId: string) => {
    const opp = filtered.find((o) => o.id === oppId);
    if (!opp || opp.status_id === statusId) return;
    q.setData((prev) => prev?.map((o) => (o.id === oppId ? { ...o, status_id: statusId } : o)));
    try {
      await store.saveOpportunity({ id: opp.id, lead_id: opp.lead_id, status_id: statusId });
      bus.emit('opportunities');
      const st = cols.find((s) => s.id === statusId);
      if (st?.kind === 'won') toast(`Gewonnen: ${opp.lead?.name ?? 'Opportunity'} 🎉`);
    } catch (e) {
      toast(errMsg(e), { kind: 'error' });
      q.reload();
    }
  };

  const sorted = useMemo(() => {
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const va = a[sort.key] ?? '';
      const vb = b[sort.key] ?? '';
      if (va === vb) return 0;
      if (va === '') return 1;
      if (vb === '') return -1;
      return (va < vb ? -1 : 1) * dir;
    });
  }, [filtered, sort]);

  const sortBy = (key: SortKey) => setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'expected_close' ? 'asc' : 'desc' }));
  const sortIcon = (key: SortKey) => (sort.key === key ? sort.dir === 'asc' ? <ArrowUp size={13} /> : <ArrowDown size={13} /> : null);

  const exportCsv = () => {
    const header = ['Lead', 'Pipeline', 'Status', 'Wert', 'Abrechnung', 'Wahrscheinlichkeit', 'Abschluss erwartet', 'Zuständig', 'Notiz', 'Angelegt', ...ref.customFields.filter((f) => f.entity === 'opportunity').map((f) => f.label)];
    const lines = sorted.map((o) => [
      o.lead?.name ?? '', pipeline?.name ?? '', cols.find((s) => s.id === o.status_id)?.label ?? '', o.value, PERIOD_SHORT[o.value_period], `${o.confidence} %`,
      o.expected_close ?? '', name(o.user_id), o.note ?? '', formatDate(o.created_at),
      ...ref.customFields.filter((f) => f.entity === 'opportunity').map((f) => String(o.custom?.[f.key] ?? '')),
    ]);
    if (__DEMO_BUILD__) {
      toast(`${lines.length} Opportunities wären exportiert worden. In der Demo-Vorschau sind Downloads gesperrt.`);
      return;
    }
    downloadText(`opportunities-${new Date().toISOString().slice(0, 10)}.csv`, toCsv([header, ...lines]));
  };

  if (!pipeline) {
    return (
      <div className="page">
        <Empty title="Noch keine Pipeline" action={can('manage_customizations') ? <a className="btn" href="#/settings/pipelines">Pipeline anlegen</a> : undefined}>
          Pipelines und Phasen legt fest, wer „Einstellungen anpassen“ darf.
        </Empty>
      </div>
    );
  }

  return (
    <div className="page" style={{ maxWidth: 'none' }}>
      <div className="page-head">
        <h1>Opportunities</h1>
        {ref.pipelines.length > 1 ? (
          <div className="segmented" role="group" aria-label="Pipeline">
            {ref.pipelines.map((p) => (
              <button key={p.id} type="button" aria-pressed={p.id === pipeline.id} onClick={() => navigate(routeHref({ name: 'opportunities', pipelineId: p.id }))}>
                {p.name}
              </button>
            ))}
          </div>
        ) : (
          <span className="muted">{pipeline.name}</span>
        )}
        <span className="grow" />
        <Segmented
          value={view}
          onChange={setView}
          label="Ansicht"
          options={[
            { value: 'board', label: <span className="row gap-4"><Columns3 size={15} /> Board</span> },
            { value: 'list', label: <span className="row gap-4"><List size={15} /> Liste</span> },
          ]}
        />
        <button type="button" className="btn primary" onClick={() => setEdit('new')}>
          <Plus /> Opportunity
        </button>
      </div>

      <div className="filterbar">
        <select className="select" style={{ width: 'auto' }} value={who} onChange={(e) => setWho(e.target.value)} aria-label="Zuständig">
          <option value="all">Ganzes Team</option>
          <option value="me">Meine</option>
          {ref.profiles.filter((p) => p.active && p.id !== me.id).map((p) => (
            <option key={p.id} value={p.id}>{p.full_name || p.email}</option>
          ))}
        </select>
        <select className="select" style={{ width: 'auto' }} value={range} onChange={(e) => setRange(e.target.value as CloseRange)} aria-label="Abschluss erwartet">
          <option value="all">Abschluss: jederzeit</option>
          <option value="this_month">Abschluss diesen Monat</option>
          <option value="next_month">Abschluss nächsten Monat</option>
          <option value="quarter">Abschluss in 3 Monaten</option>
          <option value="overdue">Abschluss überfällig</option>
        </select>
        {view === 'list' ? (
          <select className="select" style={{ width: 'auto' }} value={state} onChange={(e) => setState(e.target.value as typeof state)} aria-label="Status">
            <option value="all">Offen, gewonnen und verloren</option>
            <option value="open">Nur offene</option>
            <option value="won">Nur gewonnene</option>
            <option value="lost">Nur verlorene</option>
          </select>
        ) : null}
        <span className="grow" />
        {can('export') && view === 'list' ? (
          <button type="button" className="btn small" onClick={exportCsv} disabled={!sorted.length}>
            <Download /> Export
          </button>
        ) : null}
      </div>

      <div className="opp-summary">
        <div><span className="k">Offen</span><span className="v num">{sumByPeriod(open)}</span><span className="xs muted">{open.length} Opportunities</span></div>
        <div><span className="k">Gewichtet</span><span className="v num">{sumByPeriod(open, true)}</span><span className="xs muted">Wert × Wahrscheinlichkeit</span></div>
        <div><span className="k">Gewonnen</span><span className="v num">{sumByPeriod(won)}</span><span className="xs muted">{won.length} Abschlüsse</span></div>
      </div>

      {q.loading && !q.data ? (
        <Loading />
      ) : !(q.data ?? []).length ? (
        <div className="panel">
          <Empty title="Noch keine Opportunities in dieser Pipeline" action={<button type="button" className="btn primary" onClick={() => setEdit('new')}><Plus /> Opportunity anlegen</button>}>
            Lege eine Opportunity an, sobald es um ein Angebot geht – auf der Lead-Seite oder hier.
          </Empty>
        </div>
      ) : view === 'board' ? (
        <div className="board">
          {cols.map((col) => {
            const items = filtered.filter((o) => o.status_id === col.id);
            return (
              <div
                key={col.id}
                className={cx('board-col', over === col.id && 'drop', col.kind !== 'open' && `kind-${col.kind}`)}
                onDragOver={(e) => {
                  e.preventDefault();
                  setOver(col.id);
                }}
                onDragLeave={() => setOver((o) => (o === col.id ? null : o))}
                onDrop={(e) => {
                  e.preventDefault();
                  setOver(null);
                  const id = e.dataTransfer.getData('text/plain') || dragging;
                  if (id) move(id, col.id);
                }}
              >
                <div className="board-col-head">
                  <span className="dot" style={{ background: col.color }} aria-hidden="true" />
                  <strong className="ellipsis">{col.label}</strong>
                  <span className="muted small num">{items.length}</span>
                  <span className="spacer" />
                </div>
                <div className="board-col-sum xs muted num">{items.length ? sumByPeriod(items) : '–'}</div>
                {items.map((o) => {
                  const owner = o.user_id ? profileById.get(o.user_id) : undefined;
                  const late = col.kind === 'open' && o.expected_close && new Date(o.expected_close) < new Date(new Date().toDateString());
                  return (
                    <div
                      key={o.id}
                      className="deal"
                      draggable
                      onDragStart={(e) => {
                        setDragging(o.id);
                        e.dataTransfer.setData('text/plain', o.id);
                      }}
                      onDragEnd={() => setDragging(null)}
                      onClick={() => setEdit(o)}
                    >
                      <div className="row">
                        <a
                          href={leadHref(o.lead_id)}
                          className="grow ellipsis deal-name"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            navigate(leadHref(o.lead_id));
                          }}
                        >
                          {o.lead?.name ?? 'Lead'}
                        </a>
                        {owner ? <Avatar name={owner.full_name} color={owner.color} /> : null}
                      </div>
                      <div className="row small mt-8">
                        <strong className="num">{formatMoney(o.value)}</strong>
                        <span className="muted">{PERIOD_SHORT[o.value_period]}</span>
                        <span className="spacer" />
                        <span className="muted num">{o.confidence} %</span>
                      </div>
                      {o.expected_close ? <div className={cx('xs', late ? 'overdue-text' : 'muted')}>Abschluss bis {formatDate(o.expected_close)}</div> : null}
                      <select
                        className="select mt-8 deal-select"
                        aria-label="Phase ändern"
                        value={o.status_id ?? ''}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => move(o.id, e.target.value)}
                      >
                        {cols.map((c) => (
                          <option key={c.id} value={c.id}>{c.label}</option>
                        ))}
                      </select>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      ) : !sorted.length ? (
        <div className="panel"><Empty title="Keine Opportunities für diese Filter" /></div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Lead</th>
                <th>Status</th>
                <th className="num"><button type="button" onClick={() => sortBy('value')}>Wert {sortIcon('value')}</button></th>
                <th className="hide-mobile"><button type="button" onClick={() => sortBy('confidence')}>Wahrsch. {sortIcon('confidence')}</button></th>
                <th className="hide-mobile"><button type="button" onClick={() => sortBy('expected_close')}>Abschluss {sortIcon('expected_close')}</button></th>
                <th className="hide-mobile">Zuständig</th>
                <th className="hide-mobile"><button type="button" onClick={() => sortBy('created_at')}>Angelegt {sortIcon('created_at')}</button></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((o) => {
                const st = cols.find((s) => s.id === o.status_id);
                return (
                  <tr key={o.id} className="clickable" onClick={() => setEdit(o)}>
                    <td>
                      <a href={leadHref(o.lead_id)} onClick={(e) => e.stopPropagation()} className="strong">{o.lead?.name ?? 'Lead'}</a>
                      {o.note ? <div className="xs muted ellipsis" style={{ maxWidth: 260 }}>{o.note}</div> : null}
                    </td>
                    <td>{st ? <Tag color={st.color} tone={st.kind === 'won' ? 'green' : st.kind === 'lost' ? 'red' : undefined}>{st.label}</Tag> : null}</td>
                    <td className="num nowrap">{formatMoney(o.value)} <span className="xs muted">{PERIOD_SHORT[o.value_period]}</span></td>
                    <td className="hide-mobile num">{o.confidence} %</td>
                    <td className="hide-mobile nowrap">{o.expected_close ? formatDate(o.expected_close) : <span className="muted">–</span>}</td>
                    <td className="hide-mobile nowrap">{name(o.user_id)}</td>
                    <td className="hide-mobile nowrap small muted">{formatDate(o.created_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {edit ? <OpportunityModal opp={edit === 'new' ? undefined : edit} leadId={edit === 'new' ? null : edit.lead_id} pipelineId={pipeline.id} onClose={() => setEdit(null)} /> : null}
    </div>
  );
}
