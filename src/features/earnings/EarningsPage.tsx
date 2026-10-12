// Mein Verdienst – wie die Provisions-Tabelle des Teams, nur automatisch: Fixgehalt und Provisionsmodell eintragen,
// gewonnene Kunden erfassen; Umsatz, Stufe, Provision und Brutto rechnen sich von selbst.
// Jede Person sieht nur ihre eigenen Zahlen (Zeilenrechte in der Datenbank, auch Admins sehen sie nicht).

import { ArrowUpRight, ChevronLeft, ChevronRight, Lock, Pencil, Plus, Trash2, Wallet } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useApp } from '../../app/context.tsx';
import { useAsync } from '../../app/hooks.ts';
import { leadHref, navigate } from '../../app/router.ts';
import { bus } from '../../lib/bus.ts';
import { isoDay } from '../../lib/dates.ts';
import {
  addMonths,
  cleanTiers,
  dayDate,
  describeTerms,
  formatRate,
  isMonthKey,
  type MonthKey,
  monthCounts,
  monthKeyOf,
  monthLabel,
  monthName,
  type MonthResult,
  monthResult,
  euroInput,
  parseEuro,
  planFor,
  sumUp,
  tierStart,
  yearResults,
} from '../../lib/earnings.ts';
import { formatDate, formatMoney, formatPercent, plural } from '../../lib/format.ts';
import type { CommissionModel, CommissionTier, Lead, Opportunity, PayPlan, WonDeal } from '../../lib/types.ts';
import { cx, Empty, errMsg, Field, Loading, Modal, Switch, Tag, useUi } from '../../ui/ui.tsx';
import { LeadPicker } from '../common/forms.tsx';
import { rowsFromTiers, TierEditor, type TierRow, tiersFromRows } from './TierEditor.tsx';

const showDay = (s: string | null | undefined) => (s ? formatDate(dayDate(s)) : '–');

export default function EarningsPage({ month }: { month: string | null }) {
  const { store, me, ref } = useApp();
  const today = monthKeyOf(new Date());
  const key: MonthKey = isMonthKey(month) ? month : today;
  const go = (k: MonthKey) => navigate({ name: 'earnings', month: k === today ? null : k });

  const q = useAsync(
    async () => {
      const [plans, deals, models] = await Promise.all([store.listPayPlans(), store.listWonDeals(), store.listCommissionModels()]);
      return { plans, deals, models };
    },
    [store, me.id],
    ['earnings'],
  );
  const wonIds = useMemo(() => ref.oppStatuses.filter((s) => s.kind === 'won').map((s) => s.id), [ref.oppStatuses]);
  const opps = useAsync(
    () => (wonIds.length ? store.listOpportunities({ userId: me.id, statusIds: wonIds }) : Promise.resolve([] as Opportunity[])),
    [store, me.id, wonIds.join(',')],
    ['opportunities'],
  );

  const [dealEdit, setDealEdit] = useState<Partial<WonDeal> | null>(null);
  const [planEdit, setPlanEdit] = useState<{ plan: PayPlan | null; month: MonthKey } | null>(null);

  if (q.error) {
    return (
      <div className="page">
        <div className="callout err">{q.error}</div>
      </div>
    );
  }
  if (!q.data) return <Loading />;
  const { plans, deals, models } = q.data;
  const r = monthResult(plans, deals, key);
  const year = Number(key.slice(0, 4));
  const rows = yearResults(plans, deals, year);
  const total = sumUp(rows, today);
  const dealValue = r.plan?.deal_value ?? planFor(plans, today)?.deal_value ?? 0;

  // Gewonnene Opportunities dieses Monats, die noch nicht eingetragen sind (je Lead eine)
  const linkedOpps = new Set(deals.map((d) => d.opportunity_id).filter(Boolean));
  const leadsThisMonth = new Set(r.deals.map((d) => d.lead_id).filter(Boolean));
  const suggestions: Opportunity[] = [];
  for (const o of [...(opps.data ?? [])].sort((a, b) => (b.closed_at ?? '').localeCompare(a.closed_at ?? ''))) {
    if (!o.closed_at || monthKeyOf(o.closed_at) !== key || linkedOpps.has(o.id) || leadsThisMonth.has(o.lead_id)) continue;
    if (suggestions.some((s) => s.lead_id === o.lead_id)) continue;
    suggestions.push(o);
  }

  const newDeal = (extra: Partial<WonDeal> = {}) =>
    setDealEdit({ closed_on: key === today ? isoDay(new Date()) : `${key}-01`, deal_value: dealValue, ...extra });

  return (
    <div className="page earn">
      <div className="page-head">
        <h1>Mein Verdienst</h1>
        <MonthNav value={key} today={today} onChange={go} />
        <button type="button" className="btn primary" onClick={() => newDeal()}>
          <Plus /> Kunde eintragen
        </button>
      </div>
      <p className="earn-private small muted">
        <Lock aria-hidden="true" /> Nur du siehst diese Seite – auch Admins sehen deine Zahlen nicht.
      </p>

      {!plans.length ? (
        <section className="panel earn-setup">
          <span className="earn-setup-icon" aria-hidden="true">
            <Wallet />
          </span>
          <div className="grow">
            <h2>Richte deinen Verdienst ein</h2>
            <p className="muted">
              Trag dein Fixgehalt ein und wähl dein Provisionsmodell. Danach erfasst du hier jeden gewonnenen Kunden – Umsatz, Stufe, Provision und
              Brutto rechnen sich von selbst.
            </p>
          </div>
          <button type="button" className="btn primary" onClick={() => setPlanEdit({ plan: null, month: key })}>
            Jetzt einrichten
          </button>
        </section>
      ) : null}

      <div className="earn-layout">
        <div className="earn-main">
          <Kpis r={r} onGoal={() => r.plan && setPlanEdit({ plan: r.plan, month: monthKeyOf(r.plan.valid_from) })} />
          {r.plan ? <TierLadder r={r} /> : null}

          <section className="panel">
            <div className="panel-head">
              <h2>Kunden im {monthLabel(key)}</h2>
              {r.deals.length ? (
                <button type="button" className="btn small" onClick={() => newDeal()}>
                  <Plus /> Kunde eintragen
                </button>
              ) : null}
            </div>
            {r.deals.length ? (
              <DealsTable deals={r.deals} onEdit={setDealEdit} />
            ) : (
              <Empty title="Noch kein Kunde in diesem Monat" action={<button type="button" className="btn primary" onClick={() => newDeal()}><Plus /> Kunde eintragen</button>}>
                Trag jeden Abschluss hier ein. Er zählt im Monat des Abschlusses.
              </Empty>
            )}
          </section>

          {suggestions.length ? (
            <section className="panel earn-suggest">
              <div className="panel-head">
                <h2>Im CRM gewonnen, noch nicht eingetragen</h2>
              </div>
              <div className="list">
                {suggestions.map((o) => (
                  <div className="list-item" key={o.id}>
                    <span className="grow" style={{ minWidth: 0 }}>
                      <strong className="block ellipsis">{o.lead?.name ?? 'Lead'}</strong>
                      <span className="small muted">
                        gewonnen am {formatDate(o.closed_at)}
                        {o.value ? `, ${formatMoney(o.value)}` : ''}
                      </span>
                    </span>
                    <button
                      type="button"
                      className="btn small"
                      onClick={() =>
                        newDeal({
                          customer: o.lead?.name ?? '',
                          lead_id: o.lead_id,
                          opportunity_id: o.id,
                          closed_on: isoDay(new Date(o.closed_at!)),
                          deal_value: o.value > 0 ? o.value : dealValue,
                        })
                      }
                    >
                      Übernehmen
                    </button>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          <YearPanel rows={rows} total={total} year={year} current={key} today={today} onPick={go} />
        </div>

        <aside className="earn-aside">
          <PlanCard
            r={r}
            plans={plans}
            onEdit={(p) => setPlanEdit({ plan: p, month: p ? monthKeyOf(p.valid_from) : key })}
          />
        </aside>
      </div>

      {dealEdit ? (
        <DealModal
          initial={dealEdit}
          viewKey={key}
          defaultValue={dealValue}
          wonIds={wonIds}
          onGo={go}
          onClose={() => setDealEdit(null)}
        />
      ) : null}
      {planEdit ? (
        <PlanModal plan={planEdit.plan} month={planEdit.month} plans={plans} models={models} onClose={() => setPlanEdit(null)} />
      ) : null}
    </div>
  );
}

function MonthNav({ value, today, onChange }: { value: MonthKey; today: MonthKey; onChange: (k: MonthKey) => void }) {
  return (
    <div className="month-nav" role="group" aria-label="Monat wählen">
      <button type="button" className="icon-btn" onClick={() => onChange(addMonths(value, -1))} aria-label="Vorheriger Monat">
        <ChevronLeft />
      </button>
      <span className="month-nav-label" aria-live="polite">
        {monthLabel(value)}
      </span>
      <button type="button" className="icon-btn" onClick={() => onChange(addMonths(value, 1))} aria-label="Nächster Monat">
        <ChevronRight />
      </button>
      {value !== today ? (
        <button type="button" className="btn small ghost" onClick={() => onChange(today)}>
          Dieser Monat
        </button>
      ) : null}
    </div>
  );
}

function Kpis({ r, onGoal }: { r: MonthResult; onGoal: () => void }) {
  const canceled = r.deals.length - r.count;
  const plan = r.plan;
  const hasTiers = !!plan && cleanTiers(plan.tiers).length > 0;
  let provision = 'noch kein Modell';
  if (plan) {
    const perDeal = plan.per_deal > 0 ? `${formatMoney(plan.per_deal)} je Kunde` : '';
    if (r.tier) provision = `Stufe ${formatRate(r.tier.rate)}${perDeal ? ` + ${perDeal}` : ''}`;
    else if (hasTiers) provision = perDeal ? `noch keine Stufe, ${perDeal}` : 'noch keine Stufe erreicht';
    else provision = perDeal || 'ohne Provision';
  }
  return (
    <div className="kpis earn-kpis">
      <div className="kpi">
        <div className="v num">{formatMoney(r.revenue)}</div>
        <div className="k">
          Umsatz, {plural(r.count, 'Kunde', 'Kunden')}
          {canceled ? `, ${canceled} storniert` : ''}
        </div>
      </div>
      <div className="kpi">
        <div className="v num">{formatMoney(r.commission)}</div>
        <div className="k">Provision, {provision}</div>
      </div>
      <div className="kpi earn-gross">
        <div className="v num">{plan ? formatMoney(r.gross) : '–'}</div>
        <div className="k">{plan ? `Brutto: ${formatMoney(r.base)} Fixgehalt + Provision` : 'Brutto: erst Fixgehalt eintragen'}</div>
      </div>
      {plan ? (
        <div className="kpi">
          {r.goal ? (
            <>
              <div className="v num">{formatPercent(r.gross, r.goal)}</div>
              <div className="k">vom Monatsziel {formatMoney(r.goal)} brutto</div>
              <div className="bar-track earn-goal-bar" aria-hidden="true">
                <div style={{ width: `${Math.min(100, (r.gross / r.goal) * 100)}%` }} />
              </div>
            </>
          ) : (
            <>
              <div className="v muted">–</div>
              <div className="k">
                <button type="button" className="link-like" onClick={onGoal}>
                  Monatsziel festlegen
                </button>
              </div>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

// Stufen als Treppe: erreichte Stufen grün, die nächste füllt sich mit dem Umsatz des Monats
function TierLadder({ r }: { r: MonthResult }) {
  const plan = r.plan!;
  const tiers = cleanTiers(plan.tiers);
  if (!tiers.length || (tiers.length === 1 && tiers[0].from === 0)) return null;
  const maxRate = Math.max(...tiers.map((t) => t.rate)) || 1;
  const n = r.next;
  const text = n
    ? `Noch ${formatMoney(n.missing)} bis ${formatRate(n.tier.rate)} – dann ${formatMoney(n.extra)} mehr Provision${
        n.deals ? `, etwa ${plural(n.deals, 'Kunde', 'Kunden')} à ${formatMoney(plan.deal_value)}` : ''
      }.`
    : `Höchste Stufe erreicht: ${formatRate(r.tier!.rate)} auf ${formatMoney(r.revenue)} Umsatz.`;
  return (
    <section className="panel earn-ladder">
      <div className="panel-head">
        <h2>Stufen im {monthName(r.key)}</h2>
        <span className="small muted">{formatMoney(r.revenue)} Umsatz</span>
      </div>
      <div className="panel-body">
        <p className="ladder-text">{text}</p>
        <div className="ladder" role="img" aria-label={text}>
          {tiers.map((t, i) => {
            const prev = i === 0 ? 0 : tiers[i - 1].from;
            const fill = r.revenue >= t.from ? 1 : r.revenue <= prev ? 0 : (r.revenue - prev) / (t.from - prev);
            return (
              <div
                key={t.from}
                className={cx('step', fill >= 1 && 'reached', fill > 0 && fill < 1 && 'current', n?.tier.from === t.from && 'next')}
                title={`Ab ${formatMoney(t.from)}: ${formatRate(t.rate)} auf den ganzen Monatsumsatz (${formatMoney(tierStart(t))} Provision)`}
              >
                <span className="step-rate">{formatRate(t.rate)}</span>
                <span className="step-bar" style={{ height: `${28 + (t.rate / maxRate) * 56}px` }}>
                  <span className="step-fill" style={{ height: `${Math.round(fill * 100)}%` }} />
                </span>
                <span className="step-from num">{compactEuro(t.from)}</span>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function compactEuro(n: number): string {
  if (n >= 1000) return `${String(Math.round(n / 100) / 10).replace('.', ',')} T€`;
  return `${n} €`;
}

function DealsTable({ deals, onEdit }: { deals: WonDeal[]; onEdit: (d: WonDeal) => void }) {
  return (
    <div className="table-wrap flat">
      <table className="table earn-deals">
        <thead>
          <tr>
            <th>Kunde</th>
            <th className="hide-mobile">Setting-Termin</th>
            <th>Abschluss</th>
            <th className="right">Dealwert</th>
            <th className="hide-mobile">Notiz</th>
            <th className="hide-mobile">
              <span className="sr-only">Bearbeiten</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {deals.map((d) => (
            <tr key={d.id} className={cx('clickable', d.canceled && 'canceled')} onClick={() => onEdit(d)}>
              <td className="deal-cell">
                <span className="row gap-4 nowrap" style={{ minWidth: 0 }}>
                  <strong className="deal-name ellipsis">{d.customer}</strong>
                  {d.lead_id ? (
                    <a href={leadHref(d.lead_id)} className="icon-btn small" title="Lead öffnen" aria-label={`Lead ${d.customer} öffnen`} onClick={(e) => e.stopPropagation()}>
                      <ArrowUpRight />
                    </a>
                  ) : null}
                  {d.canceled ? <Tag tone="red">storniert</Tag> : null}
                </span>
              </td>
              <td className="hide-mobile num">{showDay(d.setting_date)}</td>
              <td className="num">{showDay(d.closed_on)}</td>
              <td className="right num">{formatMoney(d.deal_value)}</td>
              <td className="hide-mobile note-cell">
                <span className="ellipsis block">{d.note ?? ''}</span>
              </td>
              <td className="right hide-mobile">
                <button
                  type="button"
                  className="icon-btn small"
                  aria-label={`${d.customer} bearbeiten`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onEdit(d);
                  }}
                >
                  <Pencil />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function YearPanel({
  rows,
  total,
  year,
  current,
  today,
  onPick,
}: {
  rows: MonthResult[];
  total: ReturnType<typeof sumUp>;
  year: number;
  current: MonthKey;
  today: MonthKey;
  onPick: (k: MonthKey) => void;
}) {
  // Monate ohne Einträge am Stück zu einer Zeile zusammenfassen
  const groups: MonthResult[][] = [];
  for (const m of rows) {
    const idle = !monthCounts(m, today) && m.key !== current;
    const last = groups[groups.length - 1];
    if (idle && last && last.every((x) => !monthCounts(x, today) && x.key !== current)) last.push(m);
    else groups.push([m]);
  }
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Jahr {year}</h2>
        <div className="row gap-4">
          <button type="button" className="icon-btn small" onClick={() => onPick(addMonths(current, -12))} aria-label={`Jahr ${year - 1}`}>
            <ChevronLeft />
          </button>
          <button type="button" className="icon-btn small" onClick={() => onPick(addMonths(current, 12))} aria-label={`Jahr ${year + 1}`}>
            <ChevronRight />
          </button>
        </div>
      </div>
      <div className="table-wrap flat">
        <table className="table earn-year">
          <thead>
            <tr>
              <th>Monat</th>
              <th className="right hide-mobile">Kunden</th>
              <th className="right">Umsatz</th>
              <th className="right hide-mobile">Stufe</th>
              <th className="right">Provision</th>
              <th className="right">Brutto</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) =>
              g.length > 1 ? (
                <tr key={g[0].key} className="idle">
                  <td colSpan={6} className="muted">
                    {monthName(g[0].key)} – {monthName(g[g.length - 1].key)}: nichts eingetragen
                  </td>
                </tr>
              ) : (
                <MonthRow key={g[0].key} m={g[0]} on={monthCounts(g[0], today)} selected={g[0].key === current} onPick={onPick} />
              ),
            )}
          </tbody>
          <tfoot>
            <tr>
              <td>Gesamt</td>
              <td className="right num hide-mobile">{total.count}</td>
              <td className="right num">{formatMoney(total.revenue)}</td>
              <td className="hide-mobile" />
              <td className="right num">{formatMoney(total.commission)}</td>
              <td className="right num">{formatMoney(total.gross)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}

function MonthRow({ m, on, selected, onPick }: { m: MonthResult; on: boolean; selected: boolean; onPick: (k: MonthKey) => void }) {
  return (
    <tr className={cx('clickable', selected && 'selected', !on && 'idle')} onClick={() => onPick(m.key)}>
      <td>
        <button
          type="button"
          className="link-like"
          onClick={(e) => {
            e.stopPropagation();
            onPick(m.key);
          }}
        >
          {monthName(m.key)}
        </button>
      </td>
      <td className="right num hide-mobile">{on ? m.count : ''}</td>
      <td className="right num">{on ? formatMoney(m.revenue) : ''}</td>
      <td className="right num hide-mobile">{on ? (m.tier ? formatRate(m.tier.rate) : '–') : ''}</td>
      <td className="right num">{on ? formatMoney(m.commission) : ''}</td>
      <td className="right num">{on && m.plan ? formatMoney(m.gross) : on ? '–' : ''}</td>
    </tr>
  );
}

function PlanCard({ r, plans, onEdit }: { r: MonthResult; plans: PayPlan[]; onEdit: (p: PayPlan | null) => void }) {
  const plan = r.plan;
  const others = [...plans].filter((p) => p.id !== plan?.id).sort((a, b) => b.valid_from.localeCompare(a.valid_from));
  const tiers = plan ? cleanTiers(plan.tiers) : [];
  return (
    <section className="panel earn-plan">
      <div className="panel-head">
        <h2>Mein Modell</h2>
        {plan ? (
          <button type="button" className="btn small" onClick={() => onEdit(plan)}>
            <Pencil /> Ändern
          </button>
        ) : null}
      </div>
      <div className="panel-body">
        {plan ? (
          <>
            <dl className="earn-dl">
              <div>
                <dt>Fixgehalt</dt>
                <dd className="num">{formatMoney(plan.base_salary)} brutto</dd>
              </div>
              <div>
                <dt>Provision</dt>
                <dd>{plan.model_name || 'Eigenes Modell'}</dd>
              </div>
              {plan.per_deal > 0 ? (
                <div>
                  <dt>Je Kunde</dt>
                  <dd className="num">{formatMoney(plan.per_deal)}</dd>
                </div>
              ) : null}
              <div>
                <dt>Standard-Dealwert</dt>
                <dd className="num">{plan.deal_value ? formatMoney(plan.deal_value) : '–'}</dd>
              </div>
              <div>
                <dt>Monatsziel</dt>
                <dd className="num">{plan.monthly_goal ? `${formatMoney(plan.monthly_goal)} brutto` : '–'}</dd>
              </div>
            </dl>
            {tiers.length ? (
              <table className="table earn-tiers">
                <thead>
                  <tr>
                    <th>Stufe</th>
                    <th className="right">ab Umsatz</th>
                    <th className="right">Provision</th>
                  </tr>
                </thead>
                <tbody>
                  {tiers.map((t) => (
                    <tr key={t.from} className={cx(r.tier?.from === t.from && 'selected')}>
                      <td className="num">{formatRate(t.rate)}</td>
                      <td className="right num">{formatMoney(t.from)}</td>
                      <td className="right num">{formatMoney(tierStart(t))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
            <p className="small muted">
              {tiers.length ? 'Die erreichte Stufe gilt für den ganzen Umsatz des Monats. ' : ''}Gilt seit {monthLabel(monthKeyOf(plan.valid_from))}.
            </p>
          </>
        ) : (
          <div className="col gap-12">
            <p className="muted">Für {monthLabel(r.key)} ist noch kein Fixgehalt und kein Provisionsmodell eingetragen.</p>
            <button type="button" className="btn primary" onClick={() => onEdit(null)}>
              Eintragen
            </button>
          </div>
        )}
        {others.length ? (
          <details className="earn-history">
            <summary>Andere Stände ({others.length})</summary>
            <ul>
              {others.map((p) => (
                <li key={p.id}>
                  <button type="button" className="link-like" onClick={() => onEdit(p)}>
                    Ab {monthLabel(monthKeyOf(p.valid_from))}: {formatMoney(p.base_salary)}, {p.model_name || 'Eigenes Modell'}
                  </button>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>
    </section>
  );
}

// ---------- Kunde eintragen / bearbeiten ----------
function DealModal({
  initial,
  viewKey,
  defaultValue,
  wonIds,
  onGo,
  onClose,
}: {
  initial: Partial<WonDeal>;
  viewKey: MonthKey;
  defaultValue: number;
  wonIds: string[];
  onGo: (k: MonthKey) => void;
  onClose: () => void;
}) {
  const { store } = useApp();
  const { toast, confirm } = useUi();
  const editing = !!initial.id;
  const [lead, setLead] = useState<{ id: string; name: string } | null>(initial.lead_id ? { id: initial.lead_id, name: initial.customer ?? '' } : null);
  const [customer, setCustomer] = useState(initial.customer ?? '');
  const [closedOn, setClosedOn] = useState(initial.closed_on ?? isoDay(new Date()));
  const [setting, setSetting] = useState(initial.setting_date ?? '');
  const [value, setValue] = useState(euroInput(initial.deal_value ?? defaultValue));
  const [note, setNote] = useState(initial.note ?? '');
  const [canceled, setCanceled] = useState(!!initial.canceled);
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);
  const parsed = parseEuro(value);
  const badValue = parsed == null || !Number.isFinite(parsed) || parsed < 0;
  const problem = !customer.trim()
    ? 'Bitte den Kunden eintragen.'
    : !/^\d{4}-\d{2}-\d{2}$/.test(closedOn)
      ? 'Bitte das Abschlussdatum eintragen.'
      : badValue
        ? 'Bitte den Dealwert als Zahl eintragen, z. B. 6.500.'
        : null;

  // Lead gewählt: Name übernehmen, Setting-Termin und Dealwert aus dem CRM vorschlagen
  const pickLead = async (l: Lead) => {
    const before = lead?.name;
    setLead({ id: l.id, name: l.name });
    setCustomer((c) => (!c.trim() || c === before ? l.name : c));
    try {
      const [meetings, opps] = await Promise.all([
        store.listMeetings({ from: new Date(2000, 0, 1), to: new Date(2100, 0, 1), leadId: l.id }),
        store.listOpportunities({ leadId: l.id }),
      ]);
      const first = meetings.filter((m) => m.status !== 'canceled').sort((a, b) => a.starts_at.localeCompare(b.starts_at))[0];
      if (first) setSetting((s) => s || isoDay(new Date(first.starts_at)));
      const won = opps.find((o) => o.status_id && wonIds.includes(o.status_id) && o.value > 0);
      if (won) setValue((v) => (!v.trim() || v === euroInput(defaultValue) ? euroInput(won.value) : v));
    } catch {
      /* nur Vorschläge */
    }
  };

  const save = async () => {
    if (busy) return;
    if (problem) {
      setTried(true);
      return;
    }
    setBusy(true);
    try {
      const saved = await store.saveWonDeal({
        id: initial.id,
        customer: customer.trim(),
        lead_id: lead?.id ?? null,
        opportunity_id: initial.opportunity_id ?? null,
        setting_date: setting || null,
        closed_on: closedOn,
        deal_value: parsed!,
        canceled,
        note: note.trim() || null,
      });
      bus.emit('earnings');
      const k = monthKeyOf(saved.closed_on);
      if (k !== viewKey) toast(`${saved.customer} zählt im ${monthLabel(k)}.`, { action: { label: 'Ansehen', run: () => onGo(k) } });
      else toast(editing ? 'Gespeichert.' : `${saved.customer} eingetragen.`);
      onClose();
    } catch (e) {
      toast(errMsg(e), { kind: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!initial.id) return;
    if (!(await confirm(`„${initial.customer}“ aus deinen Kunden löschen?`, { danger: true, confirmLabel: 'Löschen' }))) return;
    try {
      await store.deleteWonDeal(initial.id);
      bus.emit('earnings');
      toast('Gelöscht.');
      onClose();
    } catch (e) {
      toast(errMsg(e), { kind: 'error' });
    }
  };

  return (
    <Modal
      title={editing ? 'Kunde bearbeiten' : 'Kunde eintragen'}
      onClose={onClose}
      footer={
        <>
          {editing ? (
            <button type="button" className="btn ghost danger-text" style={{ marginRight: 'auto' }} onClick={remove}>
              <Trash2 /> Löschen
            </button>
          ) : null}
          <button type="button" className="btn" onClick={onClose}>
            Abbrechen
          </button>
          <button type="button" className="btn primary" onClick={save} disabled={busy}>
            Speichern
          </button>
        </>
      }
    >
      <form
        className="col gap-12"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <Field label="Lead im CRM (optional)" hint={lead ? undefined : 'Dann stehen Name, Setting-Termin und Dealwert schon drin.'}>
          {lead ? (
            <div className="row">
              <a className="grow strong ellipsis" href={leadHref(lead.id)}>
                {lead.name || customer}
              </a>
              <button type="button" className="btn small ghost" onClick={() => setLead(null)}>
                Lösen
              </button>
            </div>
          ) : (
            <LeadPicker onPick={pickLead} />
          )}
        </Field>
        <Field label="Kunde">
          <input id="deal-customer" className="input" value={customer} onChange={(e) => setCustomer(e.target.value)} placeholder="z. B. Adler-Apotheke, Dr. Lange" />
        </Field>
        <div className="form-grid">
          <Field label="Abschlussdatum" hint="Der Umsatz zählt in diesem Monat.">
            <input id="deal-closed" className="input" type="date" value={closedOn} onChange={(e) => setClosedOn(e.target.value)} />
          </Field>
          <Field label="Setting-Termin (optional)">
            <input id="deal-setting" className="input" type="date" value={setting} onChange={(e) => setSetting(e.target.value)} />
          </Field>
          <Field label="Dealwert" hint={defaultValue ? `Standard: ${formatMoney(defaultValue)}` : undefined}>
            <span className="affix">
              <input id="deal-value" className="input" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} placeholder="6.500" />
              <span aria-hidden="true">€</span>
            </span>
          </Field>
        </div>
        <Field label="Notiz (optional)">
          <textarea id="deal-note" className="textarea" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="z. B. Paket, Zahlweise, Besonderheiten" />
        </Field>
        {editing ? (
          <label className="switch-row">
            <span className="grow">
              <strong>Storniert</strong>
              <span className="block small muted">Bleibt in der Liste, zählt aber nicht mehr zum Umsatz.</span>
            </span>
            <Switch id="deal-canceled" checked={canceled} onChange={setCanceled} label="Storniert" />
          </label>
        ) : null}
        {(tried && problem) || (value.trim() !== '' && badValue) ? (
          <p className="small danger-text" role="alert">
            {tried && problem ? problem : 'Bitte den Dealwert als Zahl eintragen, z. B. 6.500.'}
          </p>
        ) : null}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

// ---------- Fixgehalt und Provisionsmodell ----------
type TermsLike = { tiers: CommissionTier[]; per_deal: number; deal_value: number };
const sameTerms = (a: TermsLike, b: TermsLike) =>
  JSON.stringify(cleanTiers(a.tiers)) === JSON.stringify(cleanTiers(b.tiers)) && Number(a.per_deal) === Number(b.per_deal) && Number(a.deal_value) === Number(b.deal_value);
const amountInput = (n: number | null | undefined) => (n ? euroInput(n) : '');

function PlanModal({
  plan,
  month,
  plans,
  models,
  onClose,
}: {
  plan: PayPlan | null;
  month: MonthKey;
  plans: PayPlan[];
  models: CommissionModel[];
  onClose: () => void;
}) {
  const { store, can } = useApp();
  const { toast, confirm } = useUi();
  const preset = (id: string | null | undefined) => models.find((m) => m.id === id) ?? null;
  const start = plan ? preset(plan.model_id) : models[0] ?? null;
  const [validFrom, setValidFrom] = useState<string>(month);
  const [base, setBase] = useState(plan ? euroInput(plan.base_salary) : '');
  const [modelId, setModelId] = useState<string>(start?.id ?? 'own');
  const [custom, setCustom] = useState<boolean>(plan ? !start || !sameTerms(start, plan) : !start);
  const [rows, setRows] = useState<TierRow[]>(rowsFromTiers(plan?.tiers ?? start?.tiers ?? []));
  const [perDeal, setPerDeal] = useState(amountInput(plan?.per_deal ?? start?.per_deal));
  const [dealValue, setDealValue] = useState(amountInput(plan?.deal_value ?? start?.deal_value));
  const [goal, setGoal] = useState(amountInput(plan?.monthly_goal));
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);

  const chosen = preset(modelId);
  const choose = (id: string) => {
    setModelId(id);
    const m = preset(id);
    if (m) {
      setRows(rowsFromTiers(m.tiers));
      setPerDeal(amountInput(m.per_deal));
      setDealValue(amountInput(m.deal_value));
      setCustom(false);
    } else setCustom(true);
  };

  const tiers = tiersFromRows(rows);
  const nums = { base: parseEuro(base), perDeal: parseEuro(perDeal), dealValue: parseEuro(dealValue), goal: parseEuro(goal) };
  const bad = (n: number | null) => n != null && (!Number.isFinite(n) || n < 0);
  const problem = !isMonthKey(validFrom)
    ? 'Bitte wählen, ab welchem Monat das gilt.'
    : nums.base == null
      ? 'Bitte dein Fixgehalt eintragen (0, wenn du keins hast).'
      : bad(nums.base) || bad(nums.perDeal) || bad(nums.dealValue) || bad(nums.goal)
        ? 'Bitte nur Beträge ab 0 € eintragen, z. B. 3.000.'
        : tiers.error;
  const existing = plans.find((p) => monthKeyOf(p.valid_from) === validFrom) ?? null;

  const save = async () => {
    if (busy) return;
    if (problem) {
      setTried(true);
      return;
    }
    setBusy(true);
    try {
      const terms: TermsLike =
        custom || !chosen
          ? { tiers: tiers.tiers, per_deal: nums.perDeal ?? 0, deal_value: nums.dealValue ?? 0 }
          : { tiers: chosen.tiers, per_deal: chosen.per_deal, deal_value: chosen.deal_value };
      const name = chosen
        ? sameTerms(chosen, terms)
          ? chosen.name
          : `${chosen.name} (angepasst)`
        : (plan && !plan.model_id && plan.model_name) || 'Eigenes Modell';
      await store.savePayPlan({
        id: existing?.id,
        valid_from: `${validFrom}-01`,
        base_salary: nums.base ?? 0,
        model_id: chosen?.id ?? null,
        model_name: name,
        tiers: cleanTiers(terms.tiers),
        per_deal: terms.per_deal,
        deal_value: terms.deal_value,
        monthly_goal: nums.goal && nums.goal > 0 ? nums.goal : null,
      });
      bus.emit('earnings');
      toast('Gespeichert.');
      onClose();
    } catch (e) {
      toast(errMsg(e), { kind: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!plan) return;
    const label = monthLabel(monthKeyOf(plan.valid_from));
    if (!(await confirm(`Den Stand ab ${label} löschen? Die Monate ab ${label} rechnen dann mit dem Stand davor.`, { danger: true, confirmLabel: 'Löschen' }))) return;
    try {
      await store.deletePayPlan(plan.id);
      bus.emit('earnings');
      toast('Gelöscht.');
      onClose();
    } catch (e) {
      toast(errMsg(e), { kind: 'error' });
    }
  };

  const changedMonth = !!plan && monthKeyOf(plan.valid_from) !== validFrom;
  return (
    <Modal
      title="Fixgehalt und Provisionsmodell"
      onClose={onClose}
      wide
      footer={
        <>
          {plan ? (
            <button type="button" className="btn ghost danger-text" style={{ marginRight: 'auto' }} onClick={remove}>
              <Trash2 /> Stand löschen
            </button>
          ) : null}
          <button type="button" className="btn" onClick={onClose}>
            Abbrechen
          </button>
          <button type="button" className="btn primary" onClick={save} disabled={busy}>
            Speichern
          </button>
        </>
      }
    >
      <form
        className="col gap-16"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <div className="form-grid">
          <Field
            label="Gilt ab"
            hint={
              existing && existing.id !== plan?.id
                ? `Ersetzt den Stand ab ${monthLabel(validFrom)}.`
                : changedMonth
                  ? 'Wird als neuer Stand gespeichert, der alte gilt weiter für die Monate davor.'
                  : 'Frühere Monate rechnen weiter mit dem Stand, der damals galt.'
            }
          >
            <input id="plan-from" className="input" type="month" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
          </Field>
          <Field label="Fixgehalt im Monat (brutto)">
            <span className="affix">
              <input id="plan-base" className="input" inputMode="decimal" value={base} onChange={(e) => setBase(e.target.value)} placeholder="3.000" />
              <span aria-hidden="true">€</span>
            </span>
          </Field>
        </div>

        <Field
          label="Provisionsmodell"
          hint={
            models.length
              ? undefined
              : can('manage_customizations')
                ? 'Tipp: Unter Einstellungen → Provisionsmodelle legst du Vorlagen fürs ganze Team an.'
                : 'Noch keine Vorlagen fürs Team – trag dein Modell einfach selbst ein.'
          }
        >
          <select id="plan-model" className="select" value={chosen ? modelId : 'own'} onChange={(e) => choose(e.target.value)}>
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
            <option value="own">Eigenes Modell</option>
          </select>
        </Field>

        {chosen && !custom ? (
          <div className="plan-preset">
            <p className="small">
              <strong>{describeTerms(chosen, formatMoney)}</strong>
              {chosen.deal_value ? `, Standard-Dealwert ${formatMoney(chosen.deal_value)}` : ''}
            </p>
            {chosen.description ? <p className="small muted">{chosen.description}</p> : null}
            <button type="button" className="btn small" onClick={() => setCustom(true)}>
              <Pencil /> Für mich anpassen
            </button>
          </div>
        ) : (
          <div className="col gap-12 plan-custom">
            <div>
              <h3>Stufen nach Monatsumsatz</h3>
              <p className="small muted">Ab diesem Umsatz im Monat gilt der Prozentsatz für den ganzen Umsatz des Monats. Ein fester Satz ist eine Stufe ab 0 €.</p>
            </div>
            <TierEditor rows={rows} onChange={setRows} idPrefix="plan-tier" />
            <div className="form-grid">
              <Field label="Fester Betrag je Kunde (optional)">
                <span className="affix">
                  <input id="plan-per-deal" className="input" inputMode="decimal" value={perDeal} onChange={(e) => setPerDeal(e.target.value)} placeholder="0" />
                  <span aria-hidden="true">€</span>
                </span>
              </Field>
              <Field label="Standard-Dealwert" hint="Vorschlag beim Eintragen eines Kunden.">
                <span className="affix">
                  <input id="plan-deal-value" className="input" inputMode="decimal" value={dealValue} onChange={(e) => setDealValue(e.target.value)} placeholder="6.500" />
                  <span aria-hidden="true">€</span>
                </span>
              </Field>
            </div>
            {chosen ? (
              <button type="button" className="btn small ghost" style={{ alignSelf: 'flex-start' }} onClick={() => choose(chosen.id)}>
                Zurück zur Vorlage „{chosen.name}“
              </button>
            ) : null}
          </div>
        )}

        <Field label="Monatsziel brutto (optional)" hint="Dann siehst du jeden Monat, wie weit du bist.">
          <span className="affix">
            <input id="plan-goal" className="input" inputMode="decimal" value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="5.000" />
            <span aria-hidden="true">€</span>
          </span>
        </Field>
        {tried && problem ? (
          <p className="small danger-text" role="alert">
            {problem}
          </p>
        ) : null}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
