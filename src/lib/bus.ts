// Mini-Ereignisbus: Seiten erfahren, wenn sich Daten geändert haben.

export type BusEvent =
  | 'leads'
  | 'lead'
  | 'tasks'
  | 'calls'
  | 'meetings'
  | 'opportunities'
  | 'timeline'
  | 'notifications'
  | 'comments'
  | 'workflows'
  | 'messages'
  | 'insights'
  | 'ref';

type Handler = (detail?: unknown) => void;
const handlers = new Map<BusEvent, Set<Handler>>();

export const bus = {
  on(event: BusEvent, fn: Handler): () => void {
    if (!handlers.has(event)) handlers.set(event, new Set());
    handlers.get(event)!.add(fn);
    return () => handlers.get(event)?.delete(fn);
  },
  emit(event: BusEvent, detail?: unknown) {
    handlers.get(event)?.forEach((fn) => {
      try {
        fn(detail);
      } catch (e) {
        console.error(e);
      }
    });
  },
};
