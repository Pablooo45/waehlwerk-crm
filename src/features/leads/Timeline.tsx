// Verlauf eines Leads wie in Close: Anstehend (Termine, geplante E-Mails), Angeheftet, dann alle Aktivitäten –
// Anrufe (mit Aufnahme), Notizen, E-Mails, SMS, Termine, eigene Aktivitäten, Änderungen; jeweils mit Kommentaren
// und @Erwähnungen. Filter-Menü und Suche (Strg + F) wie in Close.

import {
  AlertTriangle,
  ArrowRightLeft,
  CalendarCheck,
  CalendarClock,
  CalendarX,
  Check,
  CheckCircle2,
  ChevronDown,
  ClipboardList,
  CornerUpLeft,
  Eye,
  FileText,
  GitMerge,
  ListFilter,
  Mail,
  MessageCircle,
  MessageSquare,
  Paperclip,
  Pencil,
  Phone,
  PhoneIncoming,
  PhoneMissed,
  Pin,
  PinOff,
  Plus,
  Search as SearchIcon,
  StickyNote,
  Trash2,
  TrendingUp,
  UserRound,
  Voicemail,
  X as XIcon,
} from 'lucide-react';
import { createContext, type ReactNode, useContext, useState } from 'react';
import { useApp } from '../../app/context.tsx';
import { useLookups } from '../../app/hooks.ts';
import { callHref } from '../../app/router.ts';
import { bus } from '../../lib/bus.ts';
import { formatDateTime, formatDuration, formatMoney, formatPhone, formatRelative } from '../../lib/format.ts';
import { canDeleteActivity, canEditActivity } from '../../lib/perms.ts';
import type { Call, Comment, CommentTarget, CustomActivity, Email, LeadEvent, Meeting, Note, SmsMessage, Task, TimelineItem } from '../../lib/types.ts';
import { MentionInput, mentionsIn, MentionText } from '../../ui/MentionInput.tsx';
import { HtmlFrame, textToHtml } from '../../ui/RichText.tsx';
import { cx, Empty, errMsg, MenuItem, Popover, Tag, useHotkeys, useMenu, useUi } from '../../ui/ui.tsx';
import { OutcomeTag, RecordingPlayer } from '../common/bits.tsx';
import { formatFieldValue, shapeOf } from '../common/fields.tsx';
import { QualityBadge } from '../calls/Player.tsx';

type Kind = 'all' | 'call' | 'note' | 'email' | 'sms' | 'meeting' | 'activity' | 'event';

const KIND_LABEL: Record<Kind, string> = {
  all: 'Alle Aktivitäten',
  call: 'Anrufe',
  email: 'E-Mails',
  sms: 'SMS',
  note: 'Notizen',
  meeting: 'Termine',
  activity: 'Eigene Aktivitäten',
  event: 'Änderungen & Aufgaben',
};

export interface TimelineActions {
  onReply?: (e: Email) => void;
  onEditActivity?: (a: CustomActivity) => void;
}

// Suchtext eines Eintrags (Closes „Aktivitäten durchsuchen“)
function textOf(i: TimelineItem): string {
  switch (i.kind) {
    case 'call':
      return [i.data.note, i.data.to_number, i.data.from_number].filter(Boolean).join(' ');
    case 'note':
      return i.data.body;
    case 'email':
      return `${i.data.subject} ${i.data.is_html ? i.data.body.replace(/<[^>]+>/g, ' ') : i.data.body} ${i.data.to_address ?? ''} ${i.data.from_address ?? ''}`;
    case 'sms':
      return i.data.body;
    case 'meeting':
      return `${i.data.title} ${i.data.outcome_note ?? ''}`;
    case 'activity':
      return Object.values(i.data.data ?? {}).map((v) => (Array.isArray(v) ? v.join(' ') : String(v ?? ''))).join(' ');
    case 'task':
      return i.data.title;
    default:
      return '';
  }
}

export function Timeline({ items, leadId, comments, actions }: { items: TimelineItem[]; leadId: string; comments: Comment[]; actions?: TimelineActions }) {
  const [kind, setKind] = useState<Kind>('all');
  const [q, setQ] = useState('');
  const [searching, setSearching] = useState(false);
  const filterMenu = useMenu();
  const kindOf = (i: TimelineItem): Kind => (i.kind === 'task' ? 'event' : i.kind);
  const counts = new Map<Kind, number>();
  for (const i of items) counts.set(kindOf(i), (counts.get(kindOf(i)) ?? 0) + 1);
  const byTarget = new Map<string, Comment[]>();
  for (const c of comments) {
    const k = `${c.target_kind}:${c.target_id}`;
    byTarget.set(k, [...(byTarget.get(k) ?? []), c]);
  }

  useHotkeys(
    {
      'mod+f': (e) => {
        e.preventDefault();
        setSearching(true);
      },
    },
    true,
    true,
  );

  // Anstehend: Termine in der Zukunft und geplante E-Mails/SMS; angeheftet: Notizen mit Stecknadel
  const now = Date.now();
  const isUpcoming = (i: TimelineItem) =>
    (i.kind === 'meeting' && i.data.status === 'scheduled' && new Date(i.data.starts_at).getTime() > now) ||
    ((i.kind === 'email' || i.kind === 'sms') && i.data.status === 'scheduled');
  const upcoming = items
    .filter(isUpcoming)
    .sort((a, b) => (startOf(a) < startOf(b) ? -1 : 1));
  const pinned = items.filter((i) => i.kind === 'note' && i.data.pinned);
  const term = q.trim().toLowerCase();
  const visible = items.filter(
    (i) => !isUpcoming(i) && !(i.kind === 'note' && i.data.pinned) && (kind === 'all' || kindOf(i) === kind) && (!term || textOf(i).toLowerCase().includes(term)),
  );

  const row = (item: TimelineItem) => {
    const target = targetOf(item);
    return (
      <TimelineRow
        key={`${item.kind}-${item.id}`}
        item={item}
        leadId={leadId}
        actions={actions}
        comments={target ? byTarget.get(`${target.kind}:${target.id}`) ?? [] : []}
        target={target}
      />
    );
  };

  return (
    <div className="feed">
      {upcoming.length ? (
        <div className="feed-group upcoming">
          <h3><CalendarClock size={14} aria-hidden="true" /> Anstehend</h3>
          <div className="timeline">{upcoming.map(row)}</div>
        </div>
      ) : null}
      {pinned.length ? (
        <div className="feed-group pinned">
          <h3><Pin size={14} aria-hidden="true" /> Angeheftet</h3>
          <div className="timeline">{pinned.map(row)}</div>
        </div>
      ) : null}
      <div className="feed-head">
        <h2>Aktivitäten</h2>
        <span className="grow" />
        {searching ? (
          <div className="feed-search">
            <SearchIcon size={15} aria-hidden="true" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Aktivitäten durchsuchen"
              aria-label="Aktivitäten durchsuchen"
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setQ('');
                  setSearching(false);
                }
              }}
            />
            <button type="button" className="icon-btn small" onClick={() => { setQ(''); setSearching(false); }} aria-label="Suche schließen">
              <XIcon />
            </button>
          </div>
        ) : (
          <button type="button" className="icon-btn small" onClick={() => setSearching(true)} aria-label="Aktivitäten durchsuchen" title="Aktivitäten durchsuchen (Strg + F)">
            <SearchIcon />
          </button>
        )}
        <button type="button" className={cx('btn small', kind !== 'all' && 'active')} onClick={filterMenu.open} aria-haspopup="menu">
          <ListFilter size={15} /> {KIND_LABEL[kind]} <ChevronDown size={14} />
        </button>
      </div>
      {!visible.length ? (
        <Empty title={term || kind !== 'all' ? 'Nichts gefunden' : 'Noch nichts passiert'}>
          {term || kind !== 'all' ? 'Anderen Filter wählen oder Suche leeren.' : 'Anrufe, Notizen, E-Mails und Termine erscheinen hier.'}
        </Empty>
      ) : (
        <div className="timeline">{visible.map(row)}</div>
      )}
      {filterMenu.isOpen ? (
        <Popover anchor={filterMenu.anchor} onClose={filterMenu.close} align="end">
          {(Object.keys(KIND_LABEL) as Kind[]).map((k) =>
            k === 'all' || counts.get(k) ? (
              <MenuItem key={k} onClick={() => { setKind(k); filterMenu.close(); }}>
                <span className="row gap-6">
                  <span className="grow">{KIND_LABEL[k]}</span>
                  <span className="muted num">{k === 'all' ? items.length : counts.get(k)}</span>
                  {kind === k ? <Check size={15} aria-label="gewählt" /> : <span style={{ width: 15 }} />}
                </span>
              </MenuItem>
            ) : null,
          )}
        </Popover>
      ) : null}
    </div>
  );
}

function startOf(i: TimelineItem): string {
  if (i.kind === 'meeting') return i.data.starts_at;
  if ((i.kind === 'email' || i.kind === 'sms') && i.data.send_at) return i.data.send_at;
  return i.at;
}

function targetOf(item: TimelineItem): { kind: CommentTarget; id: string } | null {
  switch (item.kind) {
    case 'call':
      return { kind: 'call', id: item.id };
    case 'note':
      return { kind: 'note', id: item.id };
    case 'email':
      return { kind: 'email', id: item.id };
    case 'meeting':
      return { kind: 'meeting', id: item.id };
    case 'activity':
      return { kind: 'activity', id: item.id };
    default:
      return null;
  }
}

// Kommentar-Knopf oben rechts in jeder Karte (wie in Close) – über Kontext an die Zeile gereicht
const CommentCtx = createContext<ReactNode>(null);

function TimelineRow({ item, leadId, actions, comments, target }: { item: TimelineItem; leadId: string; actions?: TimelineActions; comments: Comment[]; target: { kind: CommentTarget; id: string } | null }) {
  const [composing, setComposing] = useState(false);
  const thread = target && (comments.length || composing) ? <Thread leadId={leadId} target={target} comments={comments} open={composing} setOpen={setComposing} /> : null;
  const commentBtn = target && !composing ? (
    <button type="button" className="icon-btn small" onClick={() => setComposing(true)} aria-label="Kommentieren" title="Kommentieren (@Name erwähnt Kollegen)">
      <MessageSquare />
    </button>
  ) : null;
  return <CommentCtx.Provider value={commentBtn}>{rowFor(item, leadId, thread, actions)}</CommentCtx.Provider>;
}

function rowFor(item: TimelineItem, leadId: string, thread: ReactNode, actions?: TimelineActions) {
  switch (item.kind) {
    case 'call':
      return <CallItem call={item.data} thread={thread} />;
    case 'note':
      return <NoteItem note={item.data} leadId={leadId} thread={thread} />;
    case 'email':
      return <EmailItem email={item.data} onReply={actions?.onReply} thread={thread} />;
    case 'sms':
      return <SmsItem sms={item.data} />;
    case 'meeting':
      return <MeetingItem meeting={item.data} thread={thread} />;
    case 'activity':
      return <ActivityItem activity={item.data} onEdit={actions?.onEditActivity} thread={thread} />;
    case 'event':
      return <EventItem event={item.data} />;
    case 'task':
      return <TaskItem task={item.data} />;
  }
}

function Row({ icon, tone, head, children, actions, thread }: { icon: ReactNode; tone?: string; head: ReactNode; children?: ReactNode; actions?: ReactNode; thread?: ReactNode }) {
  const comment = useContext(CommentCtx);
  return (
    <div className="tl-item">
      <div className={cx('tl-icon', tone)}>{icon}</div>
      <div style={{ minWidth: 0 }}>
        <div className="tl-head">
          {head}
          {actions || comment ? (
            <span className="tl-actions">
              {actions}
              {comment}
            </span>
          ) : null}
        </div>
        {children}
        {thread}
      </div>
    </div>
  );
}

// ---------- Kommentare ----------
function Thread({ leadId, target, comments, open, setOpen }: { leadId: string; target: { kind: CommentTarget; id: string }; comments: Comment[]; open: boolean; setOpen: (v: boolean) => void }) {
  const { store, ref, me } = useApp();
  const { toast } = useUi();
  const { name, profileById } = useLookups();
  const [draft, setDraft] = useState('');

  const add = async () => {
    if (!draft.trim()) return;
    try {
      await store.addComment({ lead_id: leadId, target_kind: target.kind, target_id: target.id, body: draft.trim(), mentions: mentionsIn(draft, ref.profiles) });
      setDraft('');
      setOpen(false);
      bus.emit('comments');
    } catch (e) {
      toast(errMsg(e), { kind: 'error' });
    }
  };

  const remove = async (c: Comment) => {
    try {
      await store.deleteComment(c.id);
      bus.emit('comments');
    } catch (e) {
      toast(errMsg(e), { kind: 'error' });
    }
  };

  return (
    <div className="tl-thread">
      {comments.map((c) => (
        <div key={c.id} className="tl-comment">
          <span className="avatar xs" style={{ background: profileById.get(c.user_id ?? '')?.color ?? '#5b6b7f' }} aria-hidden="true" />
          <div className="grow">
            <span className="small"><strong>{name(c.user_id)}</strong> <span className="muted xs">{formatRelative(c.created_at)}{c.at_ms != null ? `, bei ${formatDuration(Math.floor(c.at_ms / 1000))}` : ''}</span></span>
            <div className="small pre-wrap"><MentionText text={c.body} profiles={ref.profiles} /></div>
          </div>
          {c.user_id === me.id ? (
            <button type="button" className="icon-btn small" onClick={() => remove(c)} aria-label="Kommentar löschen" title="Löschen"><Trash2 /></button>
          ) : null}
        </div>
      ))}
      {open ? (
        <div className="col gap-4 mt-4">
          <MentionInput value={draft} onChange={setDraft} profiles={ref.profiles} rows={2} placeholder="Kommentar … @Name erwähnt Kollegen" onSubmit={add} ariaLabel="Kommentar" autoFocus />
          <div className="row gap-4">
            <button type="button" className="btn small primary" onClick={add} disabled={!draft.trim()}>Kommentieren</button>
            <button type="button" className="btn small ghost" onClick={() => { setOpen(false); setDraft(''); }}>Abbrechen</button>
          </div>
        </div>
      ) : (
        <button type="button" className="tl-comment-btn" onClick={() => setOpen(true)}>
          <MessageSquare size={13} /> Antworten
        </button>
      )}
    </div>
  );
}

// ---------- Anruf ----------
function CallItem({ call, thread }: { call: Call; thread: ReactNode }) {
  const { name, outcomeByKey } = useLookups();
  const connected = call.outcome ? outcomeByKey.get(call.outcome)?.counts_as_connected : call.duration > 0;
  const inbound = call.direction === 'inbound';
  const missed = inbound && !call.answered_at && call.duration === 0;
  const icon = call.is_voicemail ? <Voicemail /> : missed ? <PhoneMissed /> : inbound ? <PhoneIncoming /> : <Phone />;
  const who = call.user_id ? name(call.user_id) : 'Niemand';
  return (
    <Row
      icon={icon}
      tone={missed || call.is_voicemail ? 'red' : connected ? 'green' : undefined}
      head={
        <>
          <strong>
            {call.is_voicemail ? 'Mailbox-Nachricht erhalten' : missed ? 'Verpasster Anruf' : inbound ? `Eingehender Anruf, ${who}` : `Anruf von ${who}`}
          </strong>
          <span className="muted small" title={formatDateTime(call.started_at)}>
            {formatRelative(call.started_at)}
            {call.duration ? `, ${formatDuration(call.duration)}` : ''}
            {call.to_number && !inbound ? `, ${formatPhone(call.to_number)}` : ''}
            {inbound && call.from_number ? `, von ${formatPhone(call.from_number)}` : ''}
          </span>
          <OutcomeTag outcome={call.outcome} />
          {call.voicemail_drop_id ? <Tag tone="soft">Mailbox-Nachricht hinterlassen</Tag> : null}
          <QualityBadge quality={call.quality} />
        </>
      }
      actions={
        call.recording_path || call.transcript_status === 'ready' ? (
          <a className="icon-btn small" href={callHref(call.id)} aria-label="Gespräch öffnen" title="Gespräch öffnen (Abschrift, Kommentare)">
            <FileText />
          </a>
        ) : null
      }
      thread={thread}
    >
      {call.note ? <div className="tl-body">{call.note}</div> : null}
      <RecordingPlayer call={call} />
    </Row>
  );
}

// ---------- Notiz ----------
function NoteItem({ note, leadId, thread }: { note: Note; leadId: string; thread: ReactNode }) {
  const { store, ref } = useApp();
  const { name } = useLookups();
  const { toast, confirm } = useUi();
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(note.body);
  const mayEdit = canEditActivity(ref, note.user_id);
  const mayDelete = canDeleteActivity(ref, note.user_id);

  const save = async () => {
    try {
      await store.updateNote(note.id, { body, mentions: mentionsIn(body, ref.profiles) });
      setEditing(false);
      bus.emit('timeline', leadId);
    } catch (e) {
      toast(errMsg(e), { kind: 'error' });
    }
  };

  const pin = async () => {
    try {
      await store.updateNote(note.id, { pinned: !note.pinned });
      bus.emit('timeline', leadId);
    } catch (e) {
      toast(errMsg(e), { kind: 'error' });
    }
  };

  const remove = async () => {
    if (!(await confirm('Notiz löschen?', { danger: true, confirmLabel: 'Löschen' }))) return;
    try {
      await store.deleteNote(note.id);
      bus.emit('timeline', leadId);
    } catch (e) {
      toast(errMsg(e), { kind: 'error' });
    }
  };

  return (
    <Row
      icon={<StickyNote />}
      tone={note.pinned ? 'amber' : undefined}
      head={
        <>
          <strong>Notiz von {name(note.user_id)}</strong>
          <span className="muted small" title={formatDateTime(note.created_at)}>{formatRelative(note.created_at)}{note.updated_at > note.created_at ? ' (bearbeitet)' : ''}</span>
          {note.pinned ? <Tag tone="amber">angeheftet</Tag> : null}
        </>
      }
      actions={
        <>
          {mayEdit ? (
            <>
              <button type="button" className="icon-btn small" aria-label={note.pinned ? 'Lösen' : 'Anheften'} title={note.pinned ? 'Lösen' : 'Oben anheften'} onClick={pin}>
                {note.pinned ? <PinOff /> : <Pin />}
              </button>
              <button type="button" className="icon-btn small" aria-label="Bearbeiten" title="Bearbeiten" onClick={() => setEditing(true)}>
                <Pencil />
              </button>
            </>
          ) : null}
          {mayDelete ? (
            <button type="button" className="icon-btn small" aria-label="Löschen" title="Löschen" onClick={remove}>
              <Trash2 />
            </button>
          ) : null}
        </>
      }
      thread={thread}
    >
      {editing ? (
        <div className="col mt-8">
          <MentionInput value={body} onChange={setBody} profiles={ref.profiles} onSubmit={save} ariaLabel="Notiz bearbeiten" />
          <div className="row">
            <button type="button" className="btn small primary" onClick={save}>Speichern</button>
            <button type="button" className="btn small" onClick={() => { setBody(note.body); setEditing(false); }}>Abbrechen</button>
          </div>
        </div>
      ) : (
        <div className="tl-body"><MentionText text={note.body} profiles={ref.profiles} /></div>
      )}
    </Row>
  );
}

// ---------- E-Mail ----------
const EMAIL_STATUS: Partial<Record<Email['status'], { label: string; tone: 'green' | 'amber' | 'red' | 'blue' | 'soft' }>> = {
  draft: { label: 'Entwurf', tone: 'soft' },
  scheduled: { label: 'geplant', tone: 'blue' },
  sending: { label: 'wird gesendet', tone: 'blue' },
  failed: { label: 'fehlgeschlagen', tone: 'red' },
  logged: { label: 'protokolliert', tone: 'soft' },
};

function EmailItem({ email, onReply, thread }: { email: Email; onReply?: (e: Email) => void; thread: ReactNode }) {
  const { store } = useApp();
  const { toast } = useUi();
  const { name } = useLookups();
  const [open, setOpen] = useState(email.direction === 'inbound');
  const inbound = email.direction === 'inbound';
  const st = EMAIL_STATUS[email.status];

  const download = async (path: string) => {
    try {
      const url = await store.attachmentUrl(path);
      window.open(url, '_blank', 'noopener');
    } catch (e) {
      toast(errMsg(e), { kind: 'error' });
    }
  };

  return (
    <Row
      icon={inbound ? <CornerUpLeft /> : <Mail />}
      tone={inbound ? 'green' : email.status === 'failed' ? 'red' : 'blue'}
      head={
        <>
          <strong>{inbound ? `E-Mail von ${email.from_address ?? 'Kontakt'}` : `E-Mail von ${name(email.user_id)}`}</strong>
          <span className="muted small" title={formatDateTime(email.sent_at ?? email.created_at)}>
            {email.status === 'scheduled' && email.send_at ? `geplant für ${formatDateTime(email.send_at)}` : formatRelative(email.sent_at ?? email.created_at)}
            {!inbound && email.to_address ? `, an ${email.to_address}` : ''}
          </span>
          {st ? <Tag tone={st.tone}>{st.label}</Tag> : null}
          {!inbound && email.opens ? <Tag tone="green" title={email.last_opened_at ? `zuletzt ${formatDateTime(email.last_opened_at)}` : undefined}><Eye size={12} /> {email.opens}× geöffnet</Tag> : null}
        </>
      }
      actions={
        inbound && onReply ? (
          <button type="button" className="btn small" onClick={() => onReply(email)}>
            <CornerUpLeft size={14} /> Antworten
          </button>
        ) : null
      }
      thread={thread}
    >
      <button type="button" className="link-like tl-subject" onClick={() => setOpen(!open)} aria-expanded={open}>
        {email.subject || '(ohne Betreff)'}
      </button>
      {email.error ? <div className="small err-text"><AlertTriangle size={13} /> {email.error}</div> : null}
      {open ? (
        <div className="mt-8">
          <HtmlFrame html={email.is_html ? email.body : textToHtml(email.body)} maxHeight={420} />
          {email.attachments?.length ? (
            <div className="row wrap gap-4 mt-8">
              {email.attachments.map((a, i) =>
                a.path ? (
                  <button key={`${a.path}-${i}`} type="button" className="chip" onClick={() => download(a.path)}>
                    <Paperclip size={13} /> {a.name}
                  </button>
                ) : (
                  // eingehende Anhänge bleiben im Postfach (nur der Name wird angezeigt)
                  <span key={`${a.name}-${i}`} className="chip" title="Liegt in deinem Postfach">
                    <Paperclip size={13} /> {a.name}
                  </span>
                )
              )}
            </div>
          ) : null}
        </div>
      ) : null}
    </Row>
  );
}

// ---------- SMS ----------
function SmsItem({ sms }: { sms: SmsMessage }) {
  const { name } = useLookups();
  const inbound = sms.direction === 'inbound';
  const failed = sms.status === 'failed' || sms.status === 'undelivered';
  return (
    <Row
      icon={<MessageCircle />}
      tone={inbound ? 'green' : failed ? 'red' : undefined}
      head={
        <>
          <strong>{inbound ? `SMS von ${formatPhone(sms.from_number)}` : `SMS von ${name(sms.user_id)}`}</strong>
          <span className="muted small" title={formatDateTime(sms.created_at)}>
            {sms.status === 'scheduled' && sms.send_at ? `geplant für ${formatDateTime(sms.send_at)}` : formatRelative(sms.created_at)}
            {!inbound && sms.to_number ? `, an ${formatPhone(sms.to_number)}` : ''}
          </span>
          {failed ? <Tag tone="red">nicht zugestellt</Tag> : sms.status === 'delivered' ? <Tag tone="soft">zugestellt</Tag> : null}
        </>
      }
    >
      <div className={cx('sms-bubble', inbound ? 'in' : 'out')}>{sms.body}</div>
      {sms.error ? <div className="small err-text">{sms.error}</div> : null}
    </Row>
  );
}

// ---------- Termin ----------
const MEETING_STATUS: Record<Meeting['status'], string> = {
  scheduled: 'geplant',
  canceled: 'abgesagt',
  rescheduled: 'verschoben',
  completed: 'hat stattgefunden',
  no_show: 'nicht erschienen',
};

export function MeetingActions({ meeting }: { meeting: Meeting }) {
  const { store } = useApp();
  const { toast } = useUi();
  const set = async (status: Meeting['status']) => {
    try {
      await store.setMeetingStatus(meeting.id, status);
      bus.emit('meetings');
      bus.emit('timeline', meeting.lead_id);
      bus.emit('lead', meeting.lead_id);
    } catch (e) {
      toast(errMsg(e), { kind: 'error' });
    }
  };
  if (meeting.status !== 'scheduled' && meeting.status !== 'no_show' && meeting.status !== 'completed') return null;
  return (
    <span className="row gap-4 wrap">
      {meeting.status !== 'completed' ? (
        <button type="button" className="btn small" onClick={() => set('completed')}>
          <CalendarCheck /> Stattgefunden
        </button>
      ) : null}
      {meeting.status !== 'no_show' ? (
        <button type="button" className="btn small" onClick={() => set('no_show')}>
          <CalendarX /> Nicht erschienen
        </button>
      ) : null}
      {meeting.status !== 'scheduled' ? (
        <button type="button" className="btn small ghost" onClick={() => set('scheduled')}>
          Zurücksetzen
        </button>
      ) : null}
    </span>
  );
}

function MeetingItem({ meeting, thread }: { meeting: Meeting; thread: ReactNode }) {
  const { name } = useLookups();
  const source = meeting.source === 'calendly' ? 'Calendly' : meeting.source === 'google' ? 'Google Kalender' : 'CRM';
  const tone = meeting.status === 'canceled' || meeting.status === 'no_show' ? 'red' : meeting.status === 'completed' ? 'green' : 'blue';
  return (
    <Row
      icon={<CalendarClock />}
      tone={tone}
      head={
        <>
          <strong>Termin {meeting.status === 'scheduled' ? 'gebucht' : MEETING_STATUS[meeting.status]}: {meeting.title}</strong>
          <span className="muted small">{formatRelative(meeting.created_at)}, über {source}</span>
        </>
      }
      thread={thread}
    >
      <div className="small mt-8">
        <strong>{formatDateTime(meeting.starts_at)}</strong>
        {meeting.host_user_id || meeting.host_name ? `, mit ${meeting.host_user_id ? name(meeting.host_user_id) : meeting.host_name}` : ''}
        {meeting.set_by ? `, gelegt von ${name(meeting.set_by)}` : ''}
      </div>
      {meeting.outcome_note ? <div className="tl-body small">{meeting.outcome_note}</div> : null}
      <div className="row wrap mt-8">
        {meeting.join_url && meeting.status === 'scheduled' ? (
          <a className="btn small" href={meeting.join_url} target="_blank" rel="noopener">Beitreten</a>
        ) : null}
        {new Date(meeting.starts_at).getTime() < Date.now() ? <MeetingActions meeting={meeting} /> : null}
      </div>
    </Row>
  );
}

// ---------- Eigene Aktivität ----------
function ActivityItem({ activity, onEdit, thread }: { activity: CustomActivity; onEdit?: (a: CustomActivity) => void; thread: ReactNode }) {
  const { ref } = useApp();
  const { name } = useLookups();
  const type = ref.activityTypes.find((t) => t.id === activity.type_id);
  const filled = (type?.fields ?? []).filter((f) => {
    const v = activity.data[f.key];
    return v != null && v !== '' && !(Array.isArray(v) && !v.length);
  });
  const mayEdit = canEditActivity(ref, activity.user_id);
  return (
    <Row
      icon={<ClipboardList />}
      tone={activity.status === 'draft' ? undefined : 'violet'}
      head={
        <>
          <strong>
            {type ? <span className="dot" style={{ background: type.color, marginRight: 6 }} aria-hidden="true" /> : null}
            {type?.name ?? 'Aktivität'}
          </strong>
          <span className="muted small">{name(activity.user_id)}, {formatRelative(activity.created_at)}</span>
          {activity.status === 'draft' ? <Tag tone="amber">Entwurf</Tag> : null}
        </>
      }
      actions={
        mayEdit && onEdit ? (
          <button type="button" className="icon-btn small" onClick={() => onEdit(activity)} aria-label="Bearbeiten" title="Bearbeiten">
            <Pencil />
          </button>
        ) : null
      }
      thread={thread}
    >
      {filled.length ? (
        <dl className="kv tl-kv">
          {filled.map((f) => (
            <div key={f.key} className="kv-row">
              <dt>{f.label}</dt>
              <dd className="pre-wrap">{formatFieldValue(shapeOf(f), activity.data[f.key], ref.profiles)}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <div className="small muted">Noch nichts ausgefüllt.</div>
      )}
    </Row>
  );
}

// ---------- Änderungen ----------
function EventItem({ event }: { event: LeadEvent }) {
  const { name, statusById, oppStatusById } = useLookups();
  const d = event.data as Record<string, string | number | null>;
  let text: ReactNode = event.type;
  let icon: ReactNode = <Plus />;
  switch (event.type) {
    case 'created':
      text = <>Lead angelegt{d.source ? ` (Quelle: ${d.source})` : ''}</>;
      break;
    case 'status':
      icon = <ArrowRightLeft />;
      text = <>Status: {statusById.get(String(d.from))?.label ?? 'ohne'} → <strong>{statusById.get(String(d.to))?.label ?? 'ohne'}</strong></>;
      break;
    case 'owner':
      icon = <UserRound />;
      text = <>Zuständig: {d.to ? name(String(d.to)) : 'niemand'}</>;
      break;
    case 'opportunity_created':
      icon = <TrendingUp />;
      text = <>Opportunity angelegt: {formatMoney(Number(d.value))} {d.value_period === 'monthly' ? 'mtl.' : d.value_period === 'annual' ? 'jährl.' : ''}</>;
      break;
    case 'opportunity_status':
      icon = <TrendingUp />;
      text = <>Opportunity: {oppStatusById.get(String(d.from))?.label ?? '–'} → <strong>{oppStatusById.get(String(d.to))?.label ?? '–'}</strong></>;
      break;
    case 'merged':
      icon = <GitMerge />;
      text = <>Zusammengeführt mit „{String(d.name ?? d.merged_name ?? 'Dublette')}“</>;
      break;
    case 'recording_deleted':
      icon = <Trash2 />;
      text = <>Aufnahme gelöscht</>;
      break;
    case 'do_not_call':
      icon = <AlertTriangle />;
      text = d.to ? <>Auf „Nicht anrufen“ gesetzt</> : <>„Nicht anrufen“ aufgehoben</>;
      break;
    case 'workflow':
      icon = <ArrowRightLeft />;
      text = <>Workflow: {String(d.text ?? '')}</>;
      break;
  }
  return (
    <Row
      icon={icon}
      head={
        <>
          <span>{text}</span>
          <span className="muted small">
            {event.user_id ? `${name(event.user_id)}, ` : ''}
            {formatRelative(event.created_at)}
          </span>
        </>
      }
    />
  );
}

function TaskItem({ task }: { task: Task }) {
  const { name } = useLookups();
  return (
    <Row
      icon={<CheckCircle2 />}
      tone="green"
      head={
        <>
          <span>Aufgabe erledigt: <strong>{task.title}</strong></span>
          <span className="muted small">
            {task.done_by ? `${name(task.done_by)}, ` : ''}
            {formatRelative(task.done_at)}
          </span>
        </>
      }
    />
  );
}
