// Rechnung für „Mein Verdienst“: Umsatz je Monat, erreichte Stufe, Provision, Brutto und was bis zur nächsten Stufe fehlt.
//
// Regeln wie in der Provisions-Tabelle des Teams:
// • Der Umsatz zählt im Monat des Abschlusses, stornierte Kunden zählen nicht.
// • Die erreichte Stufe gilt für den ganzen Monatsumsatz: ab 25.000 € 2 % → bei 27.000 € sind es 540 €.
// • Dazu kommt ein fester Betrag je Kunde, falls das Modell einen hat.
// • Brutto = Fixgehalt + Provision. Es gilt der Stand (Fixgehalt, Modell), der in diesem Monat aktuell war.

import type { CommissionModel, CommissionTier, PayPlan, WonDeal } from './types.ts';

export type MonthKey = string; // 'YYYY-MM'

const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

const round2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export function monthKeyOf(d: Date | string): MonthKey {
  if (typeof d === 'string' && /^\d{4}-\d{2}/.test(d) && d.length <= 10) return d.slice(0, 7);
  const x = typeof d === 'string' ? new Date(d) : d;
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`;
}

export function isMonthKey(s: string | null | undefined): s is MonthKey {
  return !!s && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
}

export function addMonths(key: MonthKey, n: number): MonthKey {
  const [y, m] = key.split('-').map(Number);
  return monthKeyOf(new Date(y, m - 1 + n, 1));
}

export function monthLabel(key: MonthKey): string {
  const [y, m] = key.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

export function monthName(key: MonthKey): string {
  return MONTHS[Number(key.slice(5, 7)) - 1];
}

export function monthStart(key: MonthKey): string {
  return `${key}-01`;
}

/** Stufen aufsteigend, ohne ungültige Zeilen; doppelte Schwellen: die letzte zählt */
export function cleanTiers(tiers: CommissionTier[] | null | undefined): CommissionTier[] {
  const byFrom = new Map<number, CommissionTier>();
  for (const t of tiers ?? []) {
    const from = Number(t?.from);
    const rate = Number(t?.rate);
    if (Number.isFinite(from) && Number.isFinite(rate) && from >= 0 && rate >= 0) byFrom.set(from, { from, rate });
  }
  return [...byFrom.values()].sort((a, b) => a.from - b.from);
}

export interface Terms {
  tiers: CommissionTier[];
  per_deal: number;
  deal_value: number;
}

// Zahlen aus der Datenbank (numeric) sicher als Zahl, Datumsangaben als YYYY-MM-DD
export function normModel(m: CommissionModel): CommissionModel {
  return { ...m, description: m.description ?? '', tiers: cleanTiers(m.tiers), per_deal: num(m.per_deal), deal_value: num(m.deal_value) };
}

export function normPlan(p: PayPlan): PayPlan {
  return {
    ...p,
    valid_from: String(p.valid_from).slice(0, 10),
    base_salary: num(p.base_salary),
    model_name: p.model_name ?? '',
    tiers: cleanTiers(p.tiers),
    per_deal: num(p.per_deal),
    deal_value: num(p.deal_value),
    monthly_goal: p.monthly_goal == null ? null : num(p.monthly_goal),
  };
}

export function normDeal(d: WonDeal): WonDeal {
  return {
    ...d,
    closed_on: String(d.closed_on).slice(0, 10),
    setting_date: d.setting_date ? String(d.setting_date).slice(0, 10) : null,
    deal_value: num(d.deal_value),
    canceled: !!d.canceled,
  };
}

/** Prüfungen vor dem Speichern (gleiche Regeln wie in der Datenbank), Meldungen für die Oberfläche */
export function checkPlan(p: Pick<PayPlan, 'valid_from'> & Partial<PayPlan>): string | null {
  if (!/^\d{4}-(0[1-9]|1[0-2])-01$/.test(p.valid_from ?? '')) return 'Bitte einen Monat bei „Gilt ab“ wählen.';
  if (num(p.base_salary) < 0 || num(p.per_deal) < 0 || num(p.deal_value) < 0 || (p.monthly_goal != null && num(p.monthly_goal) < 0)) return 'Beträge dürfen nicht negativ sein.';
  for (const t of p.tiers ?? []) {
    if (!(Number(t.from) >= 0) || !(Number(t.rate) >= 0) || Number(t.rate) > 100) return 'Stufen brauchen einen Umsatz ab 0 € und einen Prozentsatz zwischen 0 und 100.';
  }
  return null;
}

export function checkDeal(d: Pick<WonDeal, 'customer' | 'closed_on' | 'deal_value'>): string | null {
  if (!d.customer?.trim()) return 'Bitte den Kunden eintragen.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.closed_on ?? '') || isNaN(new Date(d.closed_on).getTime())) return 'Bitte das Abschlussdatum eintragen.';
  if (!(Number(d.deal_value) >= 0)) return 'Der Dealwert muss eine Zahl ab 0 € sein.';
  return null;
}

/** Erreichte Stufe für einen Monatsumsatz (null = noch keine) */
export function tierAt(tiers: CommissionTier[], revenue: number): CommissionTier | null {
  let hit: CommissionTier | null = null;
  for (const t of cleanTiers(tiers)) if (revenue >= t.from) hit = t;
  return hit;
}

export function commissionFor(terms: Pick<Terms, 'tiers' | 'per_deal'>, revenue: number, deals: number): number {
  const t = tierAt(terms.tiers, revenue);
  return round2((t ? (revenue * t.rate) / 100 : 0) + deals * num(terms.per_deal));
}

/** Provision genau beim Erreichen einer Stufe (Spalte „Provision bei Stufenstart“) */
export function tierStart(t: CommissionTier): number {
  return round2((t.from * t.rate) / 100);
}

/** Gültiger Stand für einen Monat: der neueste, der spätestens in diesem Monat beginnt */
export function planFor(plans: PayPlan[], key: MonthKey): PayPlan | null {
  let best: PayPlan | null = null;
  for (const p of plans) {
    const k = monthKeyOf(p.valid_from);
    if (k <= key && (!best || k > monthKeyOf(best.valid_from))) best = p;
  }
  return best;
}

export interface NextTier {
  tier: CommissionTier;
  missing: number; // Umsatz bis zur nächsten Stufe
  extra: number; // so viel mehr Provision, sobald die Stufe erreicht ist
  deals: number | null; // ungefähr so viele Kunden beim Standard-Dealwert
}

export function nextTier(terms: Terms, revenue: number, count: number): NextTier | null {
  const tier = cleanTiers(terms.tiers).find((t) => t.from > revenue);
  if (!tier) return null;
  const missing = round2(tier.from - revenue);
  const dealValue = num(terms.deal_value);
  const deals = dealValue > 0 ? Math.max(1, Math.ceil(missing / dealValue)) : null;
  const now = commissionFor(terms, revenue, count);
  const then = commissionFor(terms, tier.from, count + (deals ?? 0));
  return { tier, missing, extra: round2(then - now), deals };
}

export interface MonthResult {
  key: MonthKey;
  plan: PayPlan | null;
  deals: WonDeal[]; // alle Kunden des Monats, auch stornierte
  count: number; // gezählte Kunden (ohne Storno)
  revenue: number;
  tier: CommissionTier | null;
  commission: number;
  base: number;
  gross: number;
  next: NextTier | null;
  goal: number | null;
}

export function dealsIn(deals: WonDeal[], key: MonthKey): WonDeal[] {
  return deals.filter((d) => monthKeyOf(d.closed_on) === key);
}

export function monthResult(plans: PayPlan[], deals: WonDeal[], key: MonthKey): MonthResult {
  const plan = planFor(plans, key);
  const inMonth = dealsIn(deals, key).sort((a, b) => (a.closed_on < b.closed_on ? -1 : a.closed_on > b.closed_on ? 1 : a.created_at < b.created_at ? -1 : 1));
  const counted = inMonth.filter((d) => !d.canceled);
  const revenue = round2(counted.reduce((s, d) => s + num(d.deal_value), 0));
  const terms: Terms = plan ? { tiers: plan.tiers, per_deal: num(plan.per_deal), deal_value: num(plan.deal_value) } : { tiers: [], per_deal: 0, deal_value: 0 };
  const commission = commissionFor(terms, revenue, counted.length);
  const base = plan ? num(plan.base_salary) : 0;
  return {
    key,
    plan,
    deals: inMonth,
    count: counted.length,
    revenue,
    tier: tierAt(terms.tiers, revenue),
    commission,
    base,
    gross: round2(base + commission),
    next: plan ? nextTier(terms, revenue, counted.length) : null,
    goal: plan?.monthly_goal != null && num(plan.monthly_goal) > 0 ? num(plan.monthly_goal) : null,
  };
}

export function yearResults(plans: PayPlan[], deals: WonDeal[], year: number): MonthResult[] {
  return Array.from({ length: 12 }, (_, i) => monthResult(plans, deals, `${year}-${String(i + 1).padStart(2, '0')}`));
}

/** Zählt der Monat im Jahresüberblick? Ab dem ersten Stand bis heute – und jeder Monat mit eingetragenen Kunden. */
export function monthCounts(r: MonthResult, today: MonthKey): boolean {
  return (!!r.plan && r.key <= today) || r.deals.length > 0;
}

export function sumUp(rows: MonthResult[], today: MonthKey) {
  const active = rows.filter((r) => monthCounts(r, today));
  return {
    count: active.reduce((s, r) => s + r.count, 0),
    revenue: round2(active.reduce((s, r) => s + r.revenue, 0)),
    commission: round2(active.reduce((s, r) => s + r.commission, 0)),
    gross: round2(active.reduce((s, r) => s + r.gross, 0)),
  };
}

/** Datum ohne Uhrzeit (YYYY-MM-DD) als lokaler Tag – nicht als UTC-Mitternacht */
export function dayDate(s: string): Date {
  const [y, m, d] = s.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Eingabe wie „6.500“, „6500,50“ oder „6 500 €“ → Zahl; leer → null; Unsinn → NaN */
export function parseEuro(s: string): number | null {
  const t = s.replace(/[\s €]/g, '');
  if (!t) return null;
  return Number(t.replace(/\./g, '').replace(',', '.'));
}

/** „2,5“ oder „2.5“ → 2.5; leer → null */
export function parsePercent(s: string): number | null {
  const t = s.replace(/[\s %]/g, '');
  if (!t) return null;
  return Number(t.replace(',', '.'));
}

export function numberInput(n: number | null | undefined): string {
  return n == null ? '' : String(n).replace('.', ',');
}

const euroFmt = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 });
/** Betrag fürs Eingabefeld mit Tausenderpunkt, z. B. „6.500“ (parseEuro liest das wieder ein) */
export function euroInput(n: number | null | undefined): string {
  return n == null || !Number.isFinite(n) ? '' : euroFmt.format(n);
}

export function formatRate(rate: number): string {
  const r = Math.round(rate * 100) / 100;
  return `${String(r).replace('.', ',')} %`;
}

/** Kurzbeschreibung eines Modells, z. B. „6 Stufen, 2–9 % ab 25.000 €“ */
export function describeTerms(terms: Pick<Terms, 'tiers' | 'per_deal'>, money: (n: number) => string): string {
  const tiers = cleanTiers(terms.tiers);
  const parts: string[] = [];
  if (tiers.length === 1 && tiers[0].from === 0) parts.push(`${formatRate(tiers[0].rate)} vom Umsatz`);
  else if (tiers.length === 1) parts.push(`${formatRate(tiers[0].rate)} ab ${money(tiers[0].from)}`);
  else if (tiers.length > 1) {
    const lo = tiers[0].rate;
    const hi = tiers[tiers.length - 1].rate;
    parts.push(`${tiers.length} Stufen, ${String(lo).replace('.', ',')}–${formatRate(hi)} ab ${money(tiers[0].from)}`);
  }
  if (num(terms.per_deal) > 0) parts.push(`${money(num(terms.per_deal))} je Kunde`);
  return parts.join(' + ') || 'ohne Provision';
}
