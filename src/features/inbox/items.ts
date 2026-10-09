// Inbox-Einträge zusammenstellen (Aufgaben + Benachrichtigungen) – gemeinsam für die Inbox-Seite und
// „Nächster Lead“ auf der Lead-Seite (wie in Close: die Inbox Lead für Lead abarbeiten).

import { useApp } from '../../app/context.tsx';
import { useAsync } from '../../app/hooks.ts';
import type { InboxBox } from '../../app/router.ts';
import { endOfDay } from '../../lib/dates.ts';
import type { AppNotification, Task } from '../../lib/types.ts';

export type InboxItem =
  | { kind: 'task'; id: string; at: number; task: Task }
  | { kind: 'note'; id: string; at: number; n: AppNotification };

export function isOverdue(i: InboxItem): boolean {
  return i.kind === 'task' && !!i.task.due_at && new Date(i.task.due_at).getTime() < Date.now();
}

export function buildInboxItems(tasks: Task[], notes: AppNotification[], box: InboxBox): InboxItem[] {
  const end = endOfDay().getTime();
  const out: InboxItem[] = [];
  for (const t of tasks) {
    const due = t.due_at ? new Date(t.due_at).getTime() : null;
    if (box === 'inbox' && due !== null && due > end) continue;
    if (box === 'later' && (due === null || due <= end)) continue;
    out.push({ kind: 'task', id: t.id, at: box === 'done' ? new Date(t.done_at ?? t.created_at).getTime() : due ?? new Date(t.created_at).getTime(), task: t });
  }
  for (const n of notes) {
    out.push({ kind: 'note', id: n.id, at: new Date(box === 'later' ? n.snoozed_until ?? n.created_at : box === 'done' ? n.done_at ?? n.created_at : n.created_at).getTime(), n });
  }
  out.sort((a, b) => (box === 'later' ? a.at - b.at : b.at - a.at));
  if (box === 'inbox') {
    // Überfällige Aufgaben zuerst, dann der Rest neu → alt
    out.sort((a, b) => Number(isOverdue(b)) - Number(isOverdue(a)));
  }
  return out;
}

export function leadOf(i: InboxItem): string | null {
  return i.kind === 'task' ? i.task.lead_id : i.n.lead_id;
}

/** Leads in Inbox-Reihenfolge, ohne Doppelte */
export function inboxLeadIds(items: InboxItem[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const i of items) {
    const id = leadOf(i);
    if (id && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/** Meine offene Inbox (heute fällig + Benachrichtigungen) */
export function useMyInbox() {
  const { store, me } = useApp();
  return useAsync(
    async () => {
      const [tasks, notes] = await Promise.all([store.listTasks({ assignedTo: me.id, done: false }), store.listNotifications({ userId: me.id, box: 'inbox' })]);
      return buildInboxItems(tasks, notes, 'inbox');
    },
    [store, me.id],
    ['tasks', 'notifications'],
  );
}
