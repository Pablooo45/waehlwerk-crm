// Gemeinsame Bausteine der Einstellungsseiten

import { ArrowDown, ArrowUp } from 'lucide-react';
import { useApp } from '../../app/context.tsx';
import type { StatusKind } from '../../lib/types.ts';
import { errMsg, useUi } from '../../ui/ui.tsx';

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
