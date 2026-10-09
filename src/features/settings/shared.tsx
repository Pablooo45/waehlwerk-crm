// Gemeinsame Bausteine der Einstellungsseiten

import { ArrowDown, ArrowUp, Check, GripVertical } from 'lucide-react';
import { type KeyboardEvent, type ReactNode, useState } from 'react';
import { useApp } from '../../app/context.tsx';
import { moveItem } from '../../lib/order.ts';
import type { StatusKind } from '../../lib/types.ts';
import { cx, errMsg, useUi } from '../../ui/ui.tsx';

export const KIND_LABEL: Record<StatusKind, string> = { open: 'offen', won: 'gewonnen', lost: 'verloren' };

// Speichern, Stammdaten neu laden, Fehler als Hinweis zeigen
export function useSaver() {
  const { reloadRef } = useApp();
  const { toast } = useUi();
  return async (fn: () => Promise<unknown>, okText?: string): Promise<boolean> => {
    try {
      await fn();
      await reloadRef();
      if (okText) toast(okText);
      return true;
    } catch (e) {
      toast(errMsg(e), { kind: 'error' });
      return false;
    }
  };
}

export function SortButtons({ onUp, onDown }: { onUp?: () => void; onDown?: () => void }) {
  return (
    <span className="row gap-4 nowrap">
      <button type="button" className="icon-btn small" onClick={onUp} disabled={!onUp} aria-label="Nach oben">
        <ArrowUp />
      </button>
      <button type="button" className="icon-btn small" onClick={onDown} disabled={!onDown} aria-label="Nach unten">
        <ArrowDown />
      </button>
    </span>
  );
}

export function ColorInput({ value, onChange, label = 'Farbe' }: { value: string; onChange: (v: string) => void; label?: string }) {
  return <input type="color" className="color-input" value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} title={label} />;
}

export const PALETTE = ['#2346a0', '#0e8a5f', '#7c3aed', '#b45309', '#0f6e8c', '#b5473a', '#4c63d9', '#c78a12', '#2f8f6b', '#5b6b7f'];

// Farbwahl wie in Close: feste Farben zum Antippen, dazu eine eigene
export function ColorPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const known = PALETTE.includes(value.toLowerCase());
  return (
    <div className="color-picker" role="radiogroup" aria-label="Farbe">
      {PALETTE.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value.toLowerCase() === c}
          aria-label={c}
          className={cx('swatch', value.toLowerCase() === c && 'on')}
          style={{ background: c }}
          onClick={() => onChange(c)}
        >
          {value.toLowerCase() === c ? <Check size={14} aria-hidden="true" /> : null}
        </button>
      ))}
      <label className={cx('swatch custom', !known && 'on')} title="Eigene Farbe" style={!known ? { background: value } : undefined}>
        <input type="color" value={value} onChange={(e) => onChange(e.target.value)} aria-label="Eigene Farbe" />
      </label>
    </div>
  );
}

export { resort } from '../../lib/order.ts';

// Liste zum Ziehen (Maus) oder mit Pfeiltasten am Griff umsortieren
export function SortableList<T>({
  items,
  keyOf,
  onReorder,
  render,
  label,
}: {
  items: T[];
  keyOf: (t: T) => string;
  onReorder: (next: T[]) => void;
  render: (t: T, handle: ReactNode, index: number) => ReactNode;
  label: string;
}) {
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const move = (from: number, to: number) => {
    const next = moveItem(items, from, to);
    if (next !== items) onReorder(next);
  };
  return (
    <div className="sort-list" role="list" aria-label={label}>
      {items.map((t, i) => {
        const k = keyOf(t);
        const handle = (
          <button
            type="button"
            className="drag-handle"
            aria-label="Verschieben (Pfeiltasten hoch/runter)"
            title="Ziehen zum Sortieren"
            onKeyDown={(e: KeyboardEvent) => {
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                move(i, i - 1);
              } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                move(i, i + 1);
              }
            }}
          >
            <GripVertical aria-hidden="true" />
          </button>
        );
        return (
          <div
            key={k}
            role="listitem"
            className={cx('sort-row', drag === k && 'dragging', over === k && drag && drag !== k && 'drop-target')}
            draggable
            onDragStart={(e) => {
              setDrag(k);
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData('text/plain', k);
            }}
            onDragOver={(e) => {
              if (!drag) return;
              e.preventDefault();
              if (over !== k) setOver(k);
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (drag && drag !== k) move(items.findIndex((x) => keyOf(x) === drag), i);
              setDrag(null);
              setOver(null);
            }}
            onDragEnd={() => {
              setDrag(null);
              setOver(null);
            }}
          >
            {render(t, handle, i)}
          </div>
        );
      })}
    </div>
  );
}
