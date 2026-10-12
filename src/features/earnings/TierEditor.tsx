// Stufen eines Provisionsmodells bearbeiten – gemeinsam für „Mein Verdienst“ und Einstellungen → Provisionsmodelle.

import { Plus, Trash2 } from 'lucide-react';
import { cleanTiers, euroInput, formatRate, numberInput, parseEuro, parsePercent, tierStart } from '../../lib/earnings.ts';
import { formatMoney } from '../../lib/format.ts';
import type { CommissionTier } from '../../lib/types.ts';

export interface TierRow {
  from: string;
  rate: string;
}

export function rowsFromTiers(tiers: CommissionTier[]): TierRow[] {
  return cleanTiers(tiers).map((t) => ({ from: euroInput(t.from), rate: numberInput(t.rate) }));
}

/** Eingaben → Stufen; Fehlertext, wenn eine Zeile nicht stimmt */
export function tiersFromRows(rows: TierRow[]): { tiers: CommissionTier[]; error: string | null } {
  const tiers: CommissionTier[] = [];
  for (const [i, r] of rows.entries()) {
    if (!r.from.trim() && !r.rate.trim()) continue;
    const from = parseEuro(r.from);
    const rate = parsePercent(r.rate);
    if (from == null || !Number.isFinite(from) || from < 0) return { tiers, error: `Stufe ${i + 1}: Bitte den Umsatz eintragen, ab dem sie gilt.` };
    if (rate == null || !Number.isFinite(rate) || rate < 0 || rate > 100) return { tiers, error: `Stufe ${i + 1}: Bitte einen Prozentsatz zwischen 0 und 100 eintragen.` };
    if (tiers.some((t) => t.from === from)) return { tiers, error: `Stufe ${i + 1}: Ab ${formatMoney(from)} gibt es schon eine Stufe.` };
    tiers.push({ from, rate });
  }
  return { tiers: cleanTiers(tiers), error: null };
}

export function TierEditor({ rows, onChange, idPrefix }: { rows: TierRow[]; onChange: (rows: TierRow[]) => void; idPrefix: string }) {
  const set = (i: number, patch: Partial<TierRow>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const add = () => {
    const parsed = tiersFromRows(rows).tiers;
    const last = parsed[parsed.length - 1];
    onChange([...rows, last ? { from: euroInput(last.from + 10000), rate: numberInput(last.rate + 1) } : { from: '25.000', rate: '2' }]);
  };
  const preview = tiersFromRows(rows);
  return (
    <div className="tier-editor">
      {rows.length ? (
        <div className="tier-row tier-head" aria-hidden="true">
          <span>ab Monatsumsatz</span>
          <span>Prozent</span>
          <span className="hide-mobile">Provision beim Erreichen</span>
          <span />
        </div>
      ) : null}
      {rows.map((r, i) => {
        const from = parseEuro(r.from);
        const rate = parsePercent(r.rate);
        const start = from != null && rate != null && Number.isFinite(from) && Number.isFinite(rate) ? tierStart({ from, rate }) : null;
        return (
          <div className="tier-row" key={i}>
            <span className="affix">
              <input
                id={`${idPrefix}-from-${i}`}
                className="input"
                inputMode="decimal"
                value={r.from}
                onChange={(e) => set(i, { from: e.target.value })}
                aria-label={`Stufe ${i + 1}: ab Monatsumsatz in Euro`}
                placeholder="25.000"
              />
              <span aria-hidden="true">€</span>
            </span>
            <span className="affix">
              <input
                id={`${idPrefix}-rate-${i}`}
                className="input"
                inputMode="decimal"
                value={r.rate}
                onChange={(e) => set(i, { rate: e.target.value })}
                aria-label={`Stufe ${i + 1}: Prozent vom Monatsumsatz`}
                placeholder="2"
              />
              <span aria-hidden="true">%</span>
            </span>
            <span className="tier-start muted small hide-mobile num">{start != null ? formatMoney(start) : ''}</span>
            <button type="button" className="icon-btn small" onClick={() => onChange(rows.filter((_, j) => j !== i))} aria-label={`Stufe ${i + 1} entfernen`}>
              <Trash2 />
            </button>
          </div>
        );
      })}
      <div className="row wrap">
        <button type="button" className="btn small" onClick={add}>
          <Plus /> Stufe hinzufügen
        </button>
        {preview.error ? <span className="small danger-text">{preview.error}</span> : null}
        {!preview.error && preview.tiers.length === 1 && preview.tiers[0].from === 0 ? (
          <span className="small muted">Fester Satz: {formatRate(preview.tiers[0].rate)} auf jeden Umsatz.</span>
        ) : null}
      </div>
    </div>
  );
}
