import { describe, expect, it } from 'vitest';
import {
  addMonths,
  commissionFor,
  describeTerms,
  monthCounts,
  monthKeyOf,
  monthLabel,
  monthResult,
  nextTier,
  planFor,
  sumUp,
  tierAt,
  tierStart,
  yearResults,
} from './earnings.ts';
import type { PayPlan, WonDeal } from './types.ts';

// Stufen wie in der Provisions-Tabelle des Teams
const TIERS = [
  { from: 35000, rate: 3 },
  { from: 25000, rate: 2 },
  { from: 45000, rate: 4 },
  { from: 55000, rate: 5 },
  { from: 70000, rate: 7 },
  { from: 100000, rate: 9 },
];

function plan(valid_from: string, base_salary: number, extra: Partial<PayPlan> = {}): PayPlan {
  return {
    id: valid_from,
    user_id: 'u1',
    valid_from,
    base_salary,
    model_id: null,
    model_name: 'Stufenprovision',
    tiers: TIERS,
    per_deal: 0,
    deal_value: 6500,
    monthly_goal: null,
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-01T00:00:00Z',
    ...extra,
  };
}

let n = 0;
function deal(closed_on: string, deal_value = 6500, canceled = false): WonDeal {
  n += 1;
  return {
    id: `d${n}`,
    user_id: 'u1',
    customer: `Kunde ${n}`,
    lead_id: null,
    opportunity_id: null,
    setting_date: null,
    closed_on,
    deal_value,
    canceled,
    note: null,
    created_at: `2026-08-01T00:00:${String(n % 60).padStart(2, '0')}Z`,
    updated_at: '2026-08-01T00:00:00Z',
  };
}

// August: 10 Kunden (66.500 €), September: 4 Kunden (27.000 €), Oktober: 1 Kunde (6.500 €)
const DEALS: WonDeal[] = [
  ...Array.from({ length: 9 }, (_, i) => deal(`2026-08-${String(10 + i).padStart(2, '0')}`)),
  deal('2026-08-26', 8000),
  deal('2026-09-14'),
  deal('2026-09-23', 7500),
  deal('2026-09-29'),
  deal('2026-09-30'),
  deal('2026-10-06'),
];

describe('Mein Verdienst – Rechnung', () => {
  it('Monate', () => {
    expect(monthKeyOf('2026-10-06')).toBe('2026-10');
    expect(addMonths('2026-12', 1)).toBe('2027-01');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(monthLabel('2026-03')).toBe('März 2026');
  });

  it('Stufen gelten für den ganzen Monatsumsatz', () => {
    expect(tierAt(TIERS, 24999)).toBeNull();
    expect(tierAt(TIERS, 25000)?.rate).toBe(2);
    expect(commissionFor({ tiers: TIERS, per_deal: 0 }, 25000, 4)).toBe(500);
    expect(commissionFor({ tiers: TIERS, per_deal: 0 }, 66500, 10)).toBe(3325);
    expect(commissionFor({ tiers: TIERS, per_deal: 0 }, 120000, 18)).toBe(10800);
    expect(TIERS.map((t) => t.from).sort((a, b) => a - b).map((from) => tierStart({ from, rate: tierAt(TIERS, from)!.rate }))).toEqual([500, 1050, 1800, 2750, 4900, 9000]);
  });

  it('Monate wie in der Tabelle: August, September, Oktober', () => {
    const plans = [plan('2026-08-01', 3000)];
    const aug = monthResult(plans, DEALS, '2026-08');
    expect([aug.count, aug.revenue, aug.tier?.rate, aug.commission, aug.gross]).toEqual([10, 66500, 5, 3325, 6325]);
    const sep = monthResult(plans, DEALS, '2026-09');
    expect([sep.count, sep.revenue, sep.tier?.rate, sep.commission, sep.gross]).toEqual([4, 27000, 2, 540, 3540]);
    const oct = monthResult(plans, DEALS, '2026-10');
    expect([oct.count, oct.revenue, oct.tier, oct.commission, oct.gross]).toEqual([1, 6500, null, 0, 3000]);
    // bis zur nächsten Stufe: 18.500 € fehlen, dann +500 €, etwa 3 Kunden
    expect(oct.next).toEqual({ tier: { from: 25000, rate: 2 }, missing: 18500, extra: 500, deals: 3 });
  });

  it('Jahressumme zählt nur Monate mit Stand bis heute', () => {
    const plans = [plan('2026-08-01', 3000)];
    const year = yearResults(plans, DEALS, 2026);
    expect(year.filter((r) => monthCounts(r, '2026-10')).map((r) => r.key)).toEqual(['2026-08', '2026-09', '2026-10']);
    expect(sumUp(year, '2026-10')).toEqual({ count: 15, revenue: 100000, commission: 3865, gross: 12865 });
  });

  it('neuer Stand ab Oktober ändert frühere Monate nicht', () => {
    const plans = [plan('2026-08-01', 3000), plan('2026-10-01', 3200, { tiers: [{ from: 0, rate: 1 }] })];
    expect(planFor(plans, '2026-07')).toBeNull();
    expect(planFor(plans, '2026-09')?.base_salary).toBe(3000);
    expect(monthResult(plans, DEALS, '2026-09').gross).toBe(3540);
    expect(monthResult(plans, DEALS, '2026-10').gross).toBe(3265);
  });

  it('stornierte Kunden zählen nicht', () => {
    const plans = [plan('2026-08-01', 3000)];
    const deals = [deal('2026-11-03', 20000), deal('2026-11-04', 6500, true), deal('2026-11-05', 6000)];
    const nov = monthResult(plans, deals, '2026-11');
    expect([nov.deals.length, nov.count, nov.revenue, nov.commission]).toEqual([3, 2, 26000, 520]);
  });

  it('fester Betrag je Kunde und fester Prozentsatz', () => {
    expect(commissionFor({ tiers: [], per_deal: 150 }, 19500, 3)).toBe(450);
    expect(commissionFor({ tiers: [{ from: 0, rate: 5 }], per_deal: 0 }, 10000, 2)).toBe(500);
    expect(nextTier({ tiers: [{ from: 0, rate: 5 }], per_deal: 0, deal_value: 5000 }, 10000, 2)).toBeNull();
    expect(nextTier({ tiers: TIERS, per_deal: 0, deal_value: 6500 }, 120000, 18)).toBeNull();
    const money = (x: number) => `${x} €`;
    expect(describeTerms({ tiers: TIERS, per_deal: 0 }, money)).toBe('6 Stufen, 2–9 % ab 25000 €');
    expect(describeTerms({ tiers: [{ from: 0, rate: 5 }], per_deal: 100 }, money)).toBe('5 % vom Umsatz + 100 € je Kunde');
    expect(describeTerms({ tiers: [], per_deal: 0 }, money)).toBe('ohne Provision');
  });
});
