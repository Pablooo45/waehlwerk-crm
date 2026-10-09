// Notizen während des Gesprächs (wie in Close: beim Verbinden entsteht eine Gesprächsnotiz, in die man sofort tippt).
// Der Text hängt an der Anruf-ID, übersteht ein Neuladen (sessionStorage) und landet in der Nachbearbeitung.

import { useSyncExternalStore } from 'react';

const notes = new Map<string, string>();
const listeners = new Set<() => void>();
const KEY = (id: string) => `call-note:${id}`;

function emit() {
  listeners.forEach((l) => l());
}

export function getCallNote(id: string | null | undefined): string {
  if (!id) return '';
  if (!notes.has(id)) {
    try {
      notes.set(id, sessionStorage.getItem(KEY(id)) ?? '');
    } catch {
      notes.set(id, '');
    }
  }
  return notes.get(id) ?? '';
}

export function setCallNote(id: string, text: string) {
  notes.set(id, text);
  try {
    if (text) sessionStorage.setItem(KEY(id), text);
    else sessionStorage.removeItem(KEY(id));
  } catch {
    /* nicht verfügbar */
  }
  emit();
}

export function clearCallNote(id: string) {
  setCallNote(id, '');
  notes.delete(id);
}

export function useCallNote(id: string | null | undefined): [string, (text: string) => void] {
  const text = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => getCallNote(id),
  );
  return [text, (t: string) => id && setCallNote(id, t)];
}
