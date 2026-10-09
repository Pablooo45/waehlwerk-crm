// Power Dialer: wählt Lead für Lead aus einer Liste, ohne Klicken zwischen den Anrufen.

import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useApp } from '../../app/context.tsx';
import { navigate } from '../../app/router.ts';
import { bus } from '../../lib/bus.ts';
import { uuid } from '../../lib/ids.ts';
import type { Contact, FilterSet, Lead, SortSpec } from '../../lib/types.ts';
import { errMsg, useUi } from '../../ui/ui.tsx';

export type DialerPhase = 'idle' | 'loading' | 'preparing' | 'calling' | 'wrapup' | 'countdown' | 'paused' | 'done';

export interface DialerState {
  active: boolean;
  sessionId: string | null;
  name: string;
  queue: string[];
  index: number;
  lead: Lead | null;
  contact: Contact | null;
  number: string | null;
  phase: DialerPhase;
  countdown: number;
  stats: { dials: number; reached: number; meetings: number; skipped: number };
  message: string | null;
  dialedId: string | null;
}

interface DialerApi extends DialerState {
  start: (opts: { name: string; filter?: FilterSet; sort?: SortSpec; ids?: string[] }) => Promise<void>;
  pause: () => void;
  resume: () => void;
  skip: () => void;
  stop: () => void;
  callNow: (number?: string, contact?: Contact | null) => void;
  afterWrapup: (outcome: string | null) => void;
}

const initial: DialerState = {
  active: false,
  sessionId: null,
  name: '',
  queue: [],
  index: -1,
  lead: null,
  contact: null,
  number: null,
  phase: 'idle',
  countdown: 0,
  stats: { dials: 0, reached: 0, meetings: 0, skipped: 0 },
  message: null,
  dialedId: null,
};

const DialerContext = createContext<DialerApi | null>(null);

export function firstPhone(lead: Lead): { number: string; contact: Contact } | null {
  for (const c of lead.contacts ?? []) {
    const p = c.phones.find((x) => x.type !== 'fax');
    if (p) return { number: p.number, contact: c };
  }
  return null;
}

export function DialerProvider({ children }: { children: ReactNode }) {
  const { store, ref, me, phone, dial } = useApp();
  const { toast } = useUi();
  const [state, setState] = useState<DialerState>(initial);
  const stateRef = useRef(state);
  stateRef.current = state;
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const busy = useRef(false);

  const prepareSeconds = me.settings.dialerPrepare ?? 1;
  const advanceSeconds = me.settings.dialerAutoAdvance ?? 3;
  const skipRecent = me.settings.dialerSkipRecent !== false;

  const clearTimer = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  };

  const countdown = useCallback((seconds: number, phase: DialerPhase, then: () => void) => {
    clearTimer();
    if (seconds <= 0) {
      then();
      return;
    }
    setState((s) => ({ ...s, phase, countdown: seconds }));
    let left = seconds;
    timer.current = setInterval(() => {
      left -= 1;
      if (left <= 0) {
        clearTimer();
        then();
      } else {
        setState((s) => ({ ...s, countdown: left }));
      }
    }, 1000);
  }, []);

  const callNow = useCallback(
    async (number?: string, contact?: Contact | null) => {
      clearTimer();
      const s = stateRef.current;
      if (!s.lead) return;
      const target = number ?? s.number;
      if (!target) return;
      const c = contact ?? s.contact;
      const ok = await dial({
        number: target,
        leadId: s.lead.id,
        contactId: c?.id ?? null,
        leadName: s.lead.name,
        contactName: c?.name ?? null,
        dialerSession: s.sessionId,
      });
      setState((x) => ({
        ...x,
        number: target,
        contact: c ?? x.contact,
        phase: ok ? 'calling' : 'paused',
        message: ok ? null : 'Anruf konnte nicht gestartet werden. Telefon prüfen und „Weiter“ drücken.',
        stats: ok ? { ...x.stats, dials: x.stats.dials + 1 } : x.stats,
        dialedId: ok ? s.lead!.id : x.dialedId,
      }));
    },
    [dial],
  );

  const advance = useCallback(
    async (from: number) => {
      if (busy.current) return;
      busy.current = true;
      clearTimer();
      setState((s) => ({ ...s, phase: 'loading', message: null }));
      try {
        const s = stateRef.current;
        let skipped = 0;
        for (let i = from; i < s.queue.length; i++) {
          if (!stateRef.current.active) return;
          const lead = await store.getLead(s.queue[i]);
          if (!lead) {
            skipped++;
            continue;
          }
          const target = firstPhone(lead);
          const kind = ref.statuses.find((st) => st.id === lead.status_id)?.kind;
          const recent = lead.last_call_at &&
            Date.now() - new Date(lead.last_call_at).getTime() < ref.org.dialer_skip_recent_minutes * 60_000;
          if (!target || kind === 'won' || lead.do_not_call || (skipRecent && recent)) {
            skipped++;
            continue;
          }
          if (!(await store.dialerClaim(lead.id))) {
            skipped++;
            continue;
          }
          setState((x) => ({
            ...x,
            index: i,
            lead,
            contact: target.contact,
            number: target.number,
            stats: { ...x.stats, skipped: x.stats.skipped + skipped },
          }));
          busy.current = false;
          countdown(prepareSeconds, 'preparing', () => callNow());
          return;
        }
        setState((x) => ({
          ...x,
          phase: 'done',
          lead: null,
          contact: null,
          index: x.queue.length,
          stats: { ...x.stats, skipped: x.stats.skipped + skipped },
        }));
      } catch (e) {
        setState((x) => ({ ...x, phase: 'paused', message: errMsg(e) }));
      } finally {
        busy.current = false;
      }
    },
    [store, ref, skipRecent, prepareSeconds, countdown, callNow],
  );

  const start = useCallback(
    async (opts: { name: string; filter?: FilterSet; sort?: SortSpec; ids?: string[] }) => {
      if (phone.getSnapshot().call) {
        toast('Bitte erst den laufenden Anruf beenden.', { kind: 'error' });
        return;
      }
      if (phone.getSnapshot().status !== 'ready') {
        toast(phone.getSnapshot().message || 'Das Telefon ist nicht bereit.', { kind: 'error' });
        return;
      }
      try {
        const ids = opts.ids ?? (await store.listLeadIds(opts.filter ?? { conditions: [] }, opts.sort ?? { field: 'created_at', dir: 'desc' }, 2000));
        if (!ids.length) {
          toast('In dieser Liste sind keine Leads.', { kind: 'error' });
          return;
        }
        const next: DialerState = { ...initial, active: true, sessionId: uuid(), name: opts.name, queue: ids, phase: 'loading' };
        stateRef.current = next;
        setState(next);
        navigate('#/dialer');
        await advance(0);
      } catch (e) {
        toast(errMsg(e), { kind: 'error' });
      }
    },
    [store, phone, toast, advance],
  );

  const release = (leadId: string | undefined) => {
    if (leadId) store.dialerRelease(leadId).catch(() => undefined);
  };

  const afterWrapup = useCallback(
    (outcome: string | null) => {
      const o = ref.outcomes.find((x) => x.key === outcome);
      release(stateRef.current.lead?.id);
      bus.emit('leads');
      setState((s) => ({
        ...s,
        stats: {
          ...s.stats,
          reached: s.stats.reached + (o?.counts_as_connected ? 1 : 0),
          meetings: s.stats.meetings + (o?.is_meeting ? 1 : 0),
        },
      }));
      const nextIndex = stateRef.current.index + 1;
      countdown(advanceSeconds, 'countdown', () => advance(nextIndex));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ref, advanceSeconds, countdown, advance],
  );

  const pause = useCallback(() => {
    clearTimer();
    setState((s) => (s.phase === 'calling' || s.phase === 'wrapup' ? s : { ...s, phase: 'paused', message: null }));
  }, []);

  const resume = useCallback(() => {
    const s = stateRef.current;
    if (s.phase !== 'paused' || phone.getSnapshot().call) return;
    if (s.lead && s.dialedId !== s.lead.id) callNow();
    else advance(s.index + 1);
  }, [advance, callNow, phone]);

  const skip = useCallback(() => {
    const s = stateRef.current;
    if (phone.getSnapshot().call) return;
    release(s.lead?.id);
    setState((x) => ({ ...x, stats: { ...x.stats, skipped: x.stats.skipped + 1 } }));
    advance(s.index + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [advance, phone]);

  const stop = useCallback(() => {
    clearTimer();
    release(stateRef.current.lead?.id);
    setState(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Anruf beendet → Nachbearbeitung
  useEffect(() => {
    return phone.subscribe(() => {
      const snap = phone.getSnapshot();
      const s = stateRef.current;
      if (!s.active || s.phase !== 'calling') return;
      if (!snap.call && snap.ended && snap.ended.dialerSession === s.sessionId) {
        setState((x) => ({ ...x, phase: 'wrapup' }));
      }
    });
  }, [phone]);

  useEffect(() => () => clearTimer(), []);

  const api: DialerApi = { ...state, start, pause, resume, skip, stop, callNow, afterWrapup };
  return <DialerContext.Provider value={api}>{children}</DialerContext.Provider>;
}

export function useDialer(): DialerApi {
  const ctx = useContext(DialerContext);
  if (!ctx) throw new Error('DialerProvider fehlt');
  return ctx;
}
