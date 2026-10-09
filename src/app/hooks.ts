import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { bus, type BusEvent } from '../lib/bus.ts';
import type { CallOutcome, LeadStatus, OpportunityStatus, Profile } from '../lib/types.ts';
import { errMsg } from '../ui/ui.tsx';
import { useApp } from './context.tsx';

export interface AsyncState<T> {
  data: T | undefined;
  error: string | null;
  loading: boolean;
  reload: () => void;
  setData: (fn: (prev: T | undefined) => T | undefined) => void;
}

// Daten laden; lädt still neu, wenn passende Änderungen gemeldet werden.
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[], events: BusEvent[] = []): AsyncState<T> {
  const [data, setDataState] = useState<T | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const run = useCallback((silent: boolean) => {
    const my = ++seq.current;
    if (!silent) setLoading(true);
    fnRef
      .current()
      .then((d) => {
        if (my !== seq.current) return;
        setDataState(d);
        setError(null);
      })
      .catch((e) => {
        if (my !== seq.current) return;
        setError(errMsg(e));
      })
      .finally(() => {
        if (my === seq.current) setLoading(false);
      });
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => run(false), deps);

  useEffect(() => {
    const offs = events.map((ev) => bus.on(ev, () => run(true)));
    return () => offs.forEach((off) => off());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events.join(',')]);

  const reload = useCallback(() => run(true), [run]);
  const setData = useCallback((f: (prev: T | undefined) => T | undefined) => setDataState(f), []);
  return { data, error, loading, reload, setData };
}

export function useLookups() {
  const { ref } = useApp();
  return useMemo(() => {
    const statusById = new Map<string, LeadStatus>(ref.statuses.map((s) => [s.id, s]));
    const profileById = new Map<string, Profile>(ref.profiles.map((p) => [p.id, p]));
    const outcomeByKey = new Map<string, CallOutcome>(ref.outcomes.map((o) => [o.key, o]));
    const oppStatusById = new Map<string, OpportunityStatus>(ref.oppStatuses.map((s) => [s.id, s]));
    const name = (id: string | null | undefined) => {
      if (!id) return '–';
      const p = profileById.get(id);
      return p ? p.full_name || p.email : 'Unbekannt';
    };
    return { statusById, profileById, outcomeByKey, oppStatusById, name };
  }, [ref]);
}

export function useLocalState<T>(key: string, initial: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });
  const set = useCallback(
    (next: T) => {
      setV(next);
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        /* nicht verfügbar */
      }
    },
    [key],
  );
  return [v, set];
}
