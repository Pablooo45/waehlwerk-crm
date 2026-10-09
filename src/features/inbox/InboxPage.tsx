// Inbox wie in Close: fällige Aufgaben und Benachrichtigungen (verpasste Anrufe, Mailbox, Antworten,
// Erwähnungen) an einem Ort – mit Lead-Status an jedem Eintrag. „Später“ schiebt etwas auf, „Erledigt“
// räumt es weg. Rechts die Termine (wie Closes Meeting-Spalte in der Inbox).

import {
  AlarmClock,
  ArrowRight,
  CalendarClock,
  Check,
  CheckSquare,
  Circle,
  Mail,
  Pencil,
  Phone,
  PhoneMissed,
  Plus,
  RotateCcw,
  Trash2,
  Voicemail,
  Workflow as WorkflowIcon,
} from 'lucide-react';
import { type ReactNode, useMemo, useState } from 'react';
import { useApp } from '../../app/context.tsx';
import { useAsync, useLookups } from '../../app/hooks.ts';
import { NOTIFICATION_ICONS, openNotification } from '../../app/Notifications.tsx';
import { type InboxBox, leadHref, navigate, routeHref } from '../../app/router.ts';
import { bus } from '../../lib/bus.ts';
import { addDays, endOfDay, nextWorkday, startOfDay, toLocalInput, fromLocalInput } from '../../lib/dates.ts';
import { formatDateTime, formatDay, formatRelative, formatTime } from '../../lib/format.ts';
import type { AppNotification, Call, Meeting, Task, TaskType } from '../../lib/types.ts';
import { cx, Empty, errMsg, Loading, MenuItem, Popover, Tabs, useMenu, useUi } from '../../ui/ui.tsx';
import { DueTag, RecordingPlayer, StatusTag } from '../common/bits.tsx';
import { TaskFormModal } from '../common/forms.tsx';
import { buildInboxItems, type InboxItem, inboxLeadIds } from './items.ts';
import { firstPhone } from '../dialer/DialerContext.tsx';

type Kind = 'all' | 'emails' | 'calls' | 'sms' | 'tasks' | 'mentions' | 'other';

const KIND_LABEL: Record<Kind, string> = {
  all: 'Alle',
  emails: 'E-Mails',
  calls: 'Anrufe',
  sms: 'SMS',
  tasks: 'Aufgaben',
  mentions: 'Erwähnungen',
  other: 'Sonstiges',
};

const TASK_ICON: Record<TaskType, ReactNode> = {
  call: <Phone size={17} />,
  email: <Mail size={17} />,
  todo: <CheckSquare size={17} />,
  missed_call: <PhoneMissed size={17} color="var(--signal)" />,
  voicemail: <Voicemail size={17} color="var(--signal)" />,
  meeting_followup: <CalendarClock size={17} />,
  workflow: <WorkflowIcon size={17} />,
};

type Item = InboxItem;

function kindOf(i: Item): Kind {
  if (i.kind === 'task') return i.task.type === 'missed_call' || i.task.type === 'voicemail' ? 'calls' : 'tasks';
  switch (i.n.kind) {
    case 'missed_call':
    case 'voicemail':
      return 'calls';
    case 'mention':
    case 'comment':
      return 'mentions';
    case 'email':
      return 'emails';
    case 'sms':
      return 'sms';
    default:
      return 'other';
  }
}

export default function InboxPage({ box, userId }: { box: InboxBox; userId: string | null }) {
  const { store, me, ref, can } = useApp();
  const { name } = useLookups();
  const uid = userId && can('view_others_inbox') ? userId : me.id;
  const own = uid === me.id;
  const [kind, setKind] = useState<Kind>('all');
  const [editing, setEditing] = useState<Task | null | 'new'>(null);
  const [teamTasks, setTeamTasks] = useState(false);

  const data = useAsync(
    async () => {
      const [tasks, notes] = await Promise.all([
        teamTasks ? store.listTasks({ assignedTo: 'team', done: box === 'done' }) : store.listTasks({ assignedTo: uid, done: box === 'done' }),
        teamTasks ? Promise.resolve([]) : store.listNotifications({ userId: uid, box }),
      ]);
      return { tasks, notes };
    },
    [store, uid, box, teamTasks],
    ['tasks', 'notifications'],
  );


  const items = useMemo(() => buildInboxItems(data.data?.tasks ?? [], data.data?.notes ?? [], box), [data.data, box]);

  const queue = useMemo(() => inboxLeadIds(items), [items]);
  const counts = useMemo(() => {
    const m = new Map<Kind, number>([['all', items.length]]);
    for (const i of items) m.set(kindOf(i), (m.get(kindOf(i)) ?? 0) + 1);
    return m;
  }, [items]);
  const visible = kind === 'all' ? items : items.filter((i) => kindOf(i) === kind);

  const go = (b: InboxBox, u: string | null = userId) => navigate(routeHref({ name: 'inbox', box: b, userId: u }));
  const others = ref.profiles.filter((p) => p.active && p.id !== me.id);

  const doneAll = async () => {
    const notes = visible.filter((i): i is Extract<Item, { kind: 'note' }> => i.kind === 'note').map((i) => i.id);
    if (!notes.length) return;
    await store.updateNotifications(notes, { done: true });
    bus.emit('notifications');
  };

  return (
    <div className="page inbox-page">
      <div className="page-head">
        <h1 className="grow">{own ? (teamTasks ? 'Freie Team-Aufgaben' : 'Inbox') : `Inbox von ${name(uid)}`}</h1>
        {can('view_others_inbox') || ref.profiles.length > 1 ? (
          <select
            className="select"
            style={{ width: 'auto' }}
            value={teamTasks ? '__team' : uid}
            onChange={(e) => {
              if (e.target.value === '__team') {
                setTeamTasks(true);
                go(box, null);
              } else {
                setTeamTasks(false);
                go(box, e.target.value === me.id ? null : e.target.value);
              }
            }}
            aria-label="Wessen Inbox"
          >
            <option value={me.id}>Meine Inbox</option>
            <option value="__team">Freie Team-Aufgaben</option>
            {can('view_others_inbox') ? others.map((p) => <option key={p.id} value={p.id}>{p.full_name || p.email}</option>) : null}
          </select>
        ) : null}
        <button type="button" className="btn" onClick={() => setEditing('new')}>
          <Plus /> Aufgabe
        </button>
        {own && !teamTasks && box === 'inbox' && queue.length ? (
          <button type="button" className="btn primary" onClick={() => navigate(leadHref(queue[0], 'inbox'))} title="Inbox Lead für Lead abarbeiten – auf jeder Lead-Seite geht es mit „Nächster Lead“ weiter">
            Abarbeiten <ArrowRight size={15} />
          </button>
        ) : null}
      </div>

      <div className="inbox-layout">
        <div className="inbox-main">
          <div className="row wrap inbox-bar">
            <Tabs<InboxBox>
              value={box}
              onChange={(b) => go(b)}
              tabs={[
                { value: 'inbox', label: <>Inbox{box === 'inbox' && items.length ? <span className="count">{items.length}</span> : null}</> },
                { value: 'later', label: 'Später' },
                { value: 'done', label: 'Erledigt' },
              ]}
            />
            <span className="grow" />
            {box === 'inbox' && own && visible.some((i) => i.kind === 'note') ? (
              <button type="button" className="btn small ghost" onClick={doneAll}>
                <Check size={15} /> Benachrichtigungen erledigt
              </button>
            ) : null}
          </div>

          <div className="filterbar">
            {(Object.keys(KIND_LABEL) as Kind[]).map((k) =>
              k === 'all' || counts.get(k) ? (
                <button key={k} type="button" className={cx('chip-btn', kind === k && 'active')} aria-pressed={kind === k} onClick={() => setKind(k)}>
                  {KIND_LABEL[k]} <span className="num muted">{counts.get(k) ?? 0}</span>
                </button>
              ) : null,
            )}
          </div>

          {data.loading && !data.data ? (
            <Loading />
          ) : data.error ? (
            <div className="callout err">{data.error}</div>
          ) : !visible.length ? (
            <div className="panel">
              <Empty title={box === 'done' ? 'Noch nichts erledigt' : box === 'later' ? 'Nichts aufgeschoben' : 'Inbox leer'}>
                {box === 'inbox' ? 'Keine fälligen Aufgaben und keine neuen Benachrichtigungen. Zeit für den Power Dialer.' : box === 'later' ? 'Aufgeschobenes und Aufgaben für die nächsten Tage erscheinen hier.' : 'Erledigtes erscheint hier.'}
              </Empty>
            </div>
          ) : (
            <div className="panel">
              <div className="list inbox-list">
                {visible.map((i) =>
                  i.kind === 'task' ? (
                    <TaskItem key={i.id} task={i.task} box={box} canAct={own || teamTasks || can('manage_others_tasks')} onEdit={() => setEditing(i.task)} />
                  ) : (
                    <NoteItem key={i.id} n={i.n} box={box} canAct={own} />
                  ),
                )}
              </div>
            </div>
          )}

        </div>
        <MeetingsSide userId={teamTasks ? me.id : uid} />
      </div>

      {editing ? <TaskFormModal task={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} /> : null}
    </div>
  );
}

// Termine rechts neben der Inbox: heute und die nächsten Tage
function MeetingsSide({ userId }: { userId: string }) {
  const { store } = useApp();
  const q = useAsync(() => store.listMeetings({ from: new Date(Date.now() - 30 * 60_000), to: addDays(endOfDay(), 7), userId }), [store, userId], ['meetings']);
  const list = (q.data ?? []).filter((m) => m.status === 'scheduled').sort((a, b) => (a.starts_at < b.starts_at ? -1 : 1));
  const todayEnd = endOfDay().getTime();
  const today = list.filter((m) => new Date(m.starts_at).getTime() <= todayEnd);
  const later = list.filter((m) => new Date(m.starts_at).getTime() > todayEnd).slice(0, 6);
  const row = (m: Meeting, withDay: boolean) => (
    <div key={m.id} className="side-meeting">
      <span className="side-meeting-time num">{withDay ? formatDay(m.starts_at) : formatTime(m.starts_at)}</span>
      <span className="grow" style={{ minWidth: 0 }}>
        <span className="block ellipsis strong">{m.lead ? <a href={leadHref(m.lead.id)}>{m.lead.name}</a> : m.title}</span>
        <span className="block xs muted ellipsis">{withDay ? `${formatTime(m.starts_at)}, ` : ''}{m.title}</span>
      </span>
      {m.join_url && !withDay ? <a className="btn small" href={m.join_url} target="_blank" rel="noopener">Beitreten</a> : null}
    </div>
  );
  return (
    <aside className="inbox-side" aria-label="Termine">
      <div className="inbox-side-head">
        <CalendarClock size={16} aria-hidden="true" />
        <h2 className="grow">Termine</h2>
        <a href="#/meetings" className="small">Alle</a>
      </div>
      <h3>Heute</h3>
      {today.length ? today.map((m) => row(m, false)) : <p className="small muted">Heute keine Termine mehr.</p>}
      {later.length ? (
        <>
          <h3>Demnächst</h3>
          {later.map((m) => row(m, true))}
        </>
      ) : null}
    </aside>
  );
}

// Zeitpunkte für „Später“
function snoozeOptions(): { label: string; at: Date }[] {
  const now = new Date();
  const inHour = new Date(now.getTime() + 3_600_000);
  const afternoon = new Date(now);
  afternoon.setHours(16, 0, 0, 0);
  const opts = [{ label: 'In einer Stunde', at: inHour }];
  if (afternoon.getTime() > now.getTime() + 30 * 60_000) opts.push({ label: 'Heute 16 Uhr', at: afternoon });
  opts.push({ label: 'Morgen 9 Uhr', at: nextWorkday(1, 9) });
  opts.push({ label: 'Übermorgen 9 Uhr', at: nextWorkday(2, 9) });
  const monday = startOfDay(now);
  monday.setDate(monday.getDate() + ((8 - monday.getDay()) % 7 || 7));
  monday.setHours(9, 0, 0, 0);
  opts.push({ label: 'Nächsten Montag', at: monday });
  return opts;
}

function SnoozeMenu({ onPick, onClose, anchor }: { onPick: (d: Date) => void; onClose: () => void; anchor: HTMLElement | null }) {
  const [custom, setCustom] = useState(toLocalInput(nextWorkday(1, 9)));
  return (
    <Popover anchor={anchor} onClose={onClose} align="end">
      <div className="menu-label">Später erinnern</div>
      {snoozeOptions().map((o) => (
        <MenuItem key={o.label} icon={<AlarmClock />} onClick={() => onPick(o.at)}>
          {o.label}
          <span className="block xs muted">{formatDateTime(o.at)}</span>
        </MenuItem>
      ))}
      <div className="row gap-4" style={{ padding: '6px 10px' }}>
        <input className="input small" type="datetime-local" value={custom} onChange={(e) => setCustom(e.target.value)} aria-label="Eigener Zeitpunkt" />
        <button type="button" className="btn small" onClick={() => { const v = fromLocalInput(custom); if (v) onPick(new Date(v)); }}>OK</button>
      </div>
    </Popover>
  );
}

function TaskItem({ task, box, canAct, onEdit }: { task: Task; box: InboxBox; canAct: boolean; onEdit: () => void }) {
  const { store, dial, can, me } = useApp();
  const { toast } = useUi();
  const { name } = useLookups();
  const snooze = useMenu();
  const [call, setCall] = useState<Call | null>(null);
  const done = task.done;

  const setDone = async (next: boolean) => {
    try {
      await store.setTaskDone(task.id, next);
      bus.emit('tasks');
      if (next) {
        toast('Erledigt.', {
          action: { label: 'Rückgängig', run: async () => { await store.setTaskDone(task.id, false); bus.emit('tasks'); } },
        });
      }
    } catch (e) {
      toast(errMsg(e), { kind: 'error' });
    }
  };

  const reschedule = async (d: Date) => {
    snooze.close();
    try {
      await store.saveTask({ id: task.id, title: task.title, due_at: d.toISOString() });
      bus.emit('tasks');
      toast(`Verschoben auf ${formatDateTime(d)}.`);
    } catch (e) {
      toast(errMsg(e), { kind: 'error' });
    }
  };

  const callLead = async () => {
    if (!task.lead_id) return;
    const lead = await store.getLead(task.lead_id);
    const target = lead && firstPhone(lead);
    if (!lead || !target) {
      toast('Für diesen Lead ist keine Nummer hinterlegt.', { kind: 'error' });
      return;
    }
    dial({ number: target.number, leadId: lead.id, contactId: target.contact.id, leadName: lead.name, contactName: target.contact.name });
  };

  const remove = async () => {
    try {
      await store.deleteTask(task.id);
      bus.emit('tasks');
    } catch (e) {
      toast(errMsg(e), { kind: 'error' });
    }
  };

  const canDelete = task.created_by === me.id ? can('delete_own_tasks') || can('manage_others_tasks') : can('manage_others_tasks');

  return (
    <div className={cx('list-item inbox-item', done && 'is-done')}>
      <button type="button" className="icon-btn small" onClick={() => setDone(!done)} disabled={!canAct} aria-label={done ? 'Wieder öffnen' : 'Erledigt'} title={done ? 'Wieder öffnen' : 'Erledigt'}>
        {done ? <RotateCcw /> : <Circle />}
      </button>
      <span className="inbox-icon">{TASK_ICON[task.type]}</span>
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="inbox-title">{task.title}</div>
        <div className="row wrap gap-8 small muted">
          {task.lead ? <a href={leadHref(task.lead.id, box === 'inbox' ? 'inbox' : null)}>{task.lead.name}</a> : null}
          {task.lead?.status_id ? <StatusTag statusId={task.lead.status_id} /> : null}
          {!done ? <DueTag due={task.due_at} /> : <span>erledigt {formatRelative(task.done_at)}{task.done_by && task.done_by !== me.id ? ` von ${name(task.done_by)}` : ''}</span>}
          {task.assigned_to && task.assigned_to !== me.id ? <span>für {name(task.assigned_to)}</span> : null}
        </div>
        {task.note ? <div className="small mt-4 pre-wrap">{task.note}</div> : null}
        {call ? <div className="mt-8"><RecordingPlayer call={call} /></div> : null}
      </div>
      <div className="row gap-4 inbox-actions">
        {task.type === 'voicemail' && task.call_id && !call ? (
          <button type="button" className="btn small" onClick={async () => setCall(await store.getCall(task.call_id!))}>
            <Voicemail /> Anhören
          </button>
        ) : null}
        {task.lead_id && !done && can('calling') ? (
          <button type="button" className="icon-btn call small" onClick={callLead} aria-label="Anrufen" title="Anrufen"><Phone /></button>
        ) : null}
        {!done && canAct && box !== 'done' ? (
          <button type="button" className="icon-btn small" onClick={snooze.open} aria-label="Später" title="Später"><AlarmClock /></button>
        ) : null}
        {canAct ? <button type="button" className="icon-btn small" onClick={onEdit} aria-label="Bearbeiten" title="Bearbeiten"><Pencil /></button> : null}
        {canDelete ? <button type="button" className="icon-btn small" onClick={remove} aria-label="Löschen" title="Löschen"><Trash2 /></button> : null}
        {!done && canAct ? (
          <button type="button" className="btn small" onClick={() => setDone(true)}>
            <Check size={15} /> Erledigt
          </button>
        ) : null}
      </div>
      {snooze.isOpen ? <SnoozeMenu anchor={snooze.anchor} onClose={snooze.close} onPick={reschedule} /> : null}
    </div>
  );
}

function NoteItem({ n, box, canAct }: { n: AppNotification; box: InboxBox; canAct: boolean }) {
  const { store } = useApp();
  const { toast } = useUi();
  const { name } = useLookups();
  const snooze = useMenu();
  const [call, setCall] = useState<Call | null>(null);

  const update = async (patch: { read?: boolean; done?: boolean; snoozed_until?: string | null }, msg?: string) => {
    try {
      await store.updateNotifications([n.id], patch);
      bus.emit('notifications');
      if (msg) {
        toast(msg, {
          action: patch.done ? { label: 'Rückgängig', run: async () => { await store.updateNotifications([n.id], { done: false }); bus.emit('notifications'); } } : undefined,
        });
      }
    } catch (e) {
      toast(errMsg(e), { kind: 'error' });
    }
  };

  const open = () => {
    if (!n.read_at && canAct) update({ read: true });
    openNotification(n);
  };

  return (
    <div className={cx('list-item inbox-item', !n.read_at && box === 'inbox' && 'unread')}>
      <span className="icon-btn small inbox-dot" aria-hidden="true">{!n.read_at && box === 'inbox' ? <span className="unread-dot" /> : null}</span>
      <span className="inbox-icon">{NOTIFICATION_ICONS[n.kind]}</span>
      <div className="grow" style={{ minWidth: 0 }}>
        <button type="button" className="inbox-title link-like" onClick={open}>{n.title}</button>
        {n.body ? <div className="small inbox-body">{n.body}</div> : null}
        <div className="row wrap gap-8 xs muted mt-4">
          {n.lead ? <a href={leadHref(n.lead.id, box === 'inbox' ? 'inbox' : null)}>{n.lead.name}</a> : null}
          {n.lead?.status_id ? <StatusTag statusId={n.lead.status_id} /> : null}
          <span title={formatDateTime(n.created_at)}>{formatRelative(n.created_at)}</span>
          {n.actor_id ? <span>von {name(n.actor_id)}</span> : null}
          {box === 'later' && n.snoozed_until ? <span>erinnert {formatDateTime(n.snoozed_until)}</span> : null}
        </div>
        {call ? <div className="mt-8"><RecordingPlayer call={call} /></div> : null}
      </div>
      <div className="row gap-4 inbox-actions">
        {n.kind === 'voicemail' && n.ref_kind === 'call' && n.ref_id && !call ? (
          <button type="button" className="btn small" onClick={async () => setCall(await store.getCall(n.ref_id!))}>
            <Voicemail /> Anhören
          </button>
        ) : null}
        {canAct && box !== 'done' ? (
          <button type="button" className="icon-btn small" onClick={snooze.open} aria-label="Später" title="Später"><AlarmClock /></button>
        ) : null}
        {canAct && box === 'later' ? (
          <button type="button" className="btn small" onClick={() => update({ snoozed_until: null }, 'Zurück in der Inbox.')}>Jetzt</button>
        ) : null}
        {canAct && box !== 'done' ? (
          <button type="button" className="btn small" onClick={() => update({ done: true }, 'Erledigt.')}>
            <Check size={15} /> Erledigt
          </button>
        ) : null}
        {canAct && box === 'done' ? (
          <button type="button" className="btn small" onClick={() => update({ done: false }, 'Zurück in der Inbox.')}>
            <RotateCcw size={15} /> Zurück
          </button>
        ) : null}
      </div>
      {snooze.isOpen ? (
        <SnoozeMenu anchor={snooze.anchor} onClose={snooze.close} onPick={(d) => { snooze.close(); update({ snoozed_until: d.toISOString(), read: true }, `Erinnert dich ${formatDateTime(d)}.`); }} />
      ) : null}
    </div>
  );
}
