// Lead-Seite wie in Close:
//  links  – Name, Status (+ ⋯-Menü), Website/Adresse, Beschreibung, dann Aufgaben, Opportunities, Kontakte, Felder, Workflows
//  rechts – Knöpfe Anrufen, E-Mail, SMS, Notiz, Aktivität, Termin; der Editor öffnet sich direkt über dem Verlauf
//           (kein Fenster über dem Lead), darunter Anstehend, Angeheftet und alle Aktivitäten.

import {
  Ban,
  CalendarPlus,
  CheckCircle2,
  ChevronDown,
  Circle,
  ClipboardList,
  Copy,
  ExternalLink,
  Globe,
  GitMerge,
  Lock,
  Mail,
  MapPin,
  MessageCircle,
  MoreHorizontal,
  Pause,
  Pencil,
  Phone,
  PhoneCall,
  PhoneForwarded,
  Play,
  Plus,
  StickyNote,
  Trash2,
  TrendingUp,
  UserPlus,
  Workflow as WorkflowIcon,
  X,
} from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useApp, usePhone } from '../../app/context.tsx';
import { useAsync, useLookups } from '../../app/hooks.ts';
import { navigate, routeHref } from '../../app/router.ts';
import { bus } from '../../lib/bus.ts';
import { ensureUrl, fillTemplate, formatDate, formatDateTime, formatMoney, formatPhone, hostOf } from '../../lib/format.ts';
import type { ActivityType, Comment, Contact, CustomActivity, CustomField, Email, Lead, LeadInput, Opportunity, Task, TimelineItem } from '../../lib/types.ts';
import { MentionInput, mentionsIn } from '../../ui/MentionInput.tsx';
import { copyText, cx, Empty, errMsg, Field, InlinePanel, Loading, MenuItem, Modal, Popover, Segmented, Tag, useHotkeys, useMenu, useUi } from '../../ui/ui.tsx';
import { CallButton, DueTag, StatusPill, UserSelect } from '../common/bits.tsx';
import { FieldInput, formatFieldValue, isEmptyValue, shapeOf } from '../common/fields.tsx';
import { ActivityFormModal, ContactFormModal, EmailModal, OpportunityModal, phoneTypeLabel, SmsModal, TaskFormModal } from '../common/forms.tsx';
import { firstPhone, useDialer } from '../dialer/DialerContext.tsx';
import { BookMeetingModal } from '../meetings/BookMeeting.tsx';
import { PairCard } from '../settings/Duplicates.tsx';
import { EnrollInWorkflowModal } from '../workflows/WorkflowPage.tsx';
import { RUN_STATUS } from '../workflows/meta.tsx';
import { Timeline } from './Timeline.tsx';

export default function LeadPage({ id }: { id: string }) {
  const { store } = useApp();
  const lead = useAsync(() => store.getLead(id), [id, store]);
  const timeline = useAsync(() => store.timeline(id, 400), [id, store], ['messages', 'insights']);
  const comments = useAsync(() => store.listComments(id), [id, store], ['comments']);

  const reloadLead = lead.reload;
  const reloadTimeline = timeline.reload;
  useEffect(() => {
    const offs = [
      bus.on('lead', (d) => {
        if (!d || d === id) {
          reloadLead();
          reloadTimeline();
        }
      }),
      bus.on('timeline', (d) => {
        if (!d || d === id) reloadTimeline();
      }),
      bus.on('meetings', () => reloadTimeline()),
      bus.on('calls', (row) => {
        if (!row || (row as { lead_id?: string }).lead_id === id) {
          reloadTimeline();
          reloadLead();
        }
      }),
    ];
    return () => offs.forEach((o) => o());
  }, [id, reloadLead, reloadTimeline]);

  if (lead.loading && !lead.data) return <Loading />;
  if (lead.error) return <div className="page"><div className="callout err">{lead.error}</div></div>;
  if (!lead.data) {
    return (
      <div className="page">
        <Empty title="Lead nicht gefunden" action={<a className="btn" href="#/leads">Zur Liste</a>}>
          Vielleicht wurde er gelöscht oder er ist für deine Rolle nicht sichtbar.
        </Empty>
      </div>
    );
  }
  return (
    <LeadView
      lead={lead.data}
      timeline={timeline.data ?? []}
      comments={comments.data ?? []}
      reload={() => {
        lead.reload();
        timeline.reload();
      }}
    />
  );
}

// Was gerade oben im Verlauf offen ist (wie in Close: immer nur ein Editor)
type Composer =
  | { kind: 'note' }
  | { kind: 'email'; to?: string | null; replyTo?: Email | null }
  | { kind: 'sms'; to?: string | null }
  | { kind: 'activity'; type: ActivityType | null; activity?: CustomActivity | null }
  | { kind: 'log' }
  | null;

type ModalKind = null | 'book' | 'task' | 'opp' | 'contact' | 'workflow' | 'dupes' | 'edit';

function LeadView({ lead, timeline, comments, reload }: { lead: Lead; timeline: TimelineItem[]; comments: Comment[]; reload: () => void }) {
  const { store, ref, can, dial } = useApp();
  const { toast, confirm } = useUi();
  const snap = usePhone();
  const dialer = useDialer();
  // Im Power Dialer laufen Anrufe über den Dialer (damit Ergebnis und „nächster Lead“ stimmen)
  const inDialer = dialer.active && dialer.lead?.id === lead.id;
  const [modal, setModal] = useState<ModalKind>(null);
  const [composer, setComposer] = useState<Composer>(null);
  const [editContact, setEditContact] = useState<Contact | null>(null);
  const [editTask, setEditTask] = useState<Task | null>(null);
  const [editOpp, setEditOpp] = useState<Opportunity | null>(null);
  const [tab, setTab] = useState<'feed' | 'details'>('feed');
  const more = useMenu();
  const callMenu = useMenu();
  const activityMenu = useMenu();
  const mainRef = useRef<HTMLElement>(null);
  const dupes = useAsync(() => (can('merge_leads') ? store.findDuplicates(lead.id, 5) : Promise.resolve([])), [store, lead.id], ['leads']);

  const save = async (patch: LeadInput) => {
    try {
      await store.updateLead(lead.id, patch);
      bus.emit('leads');
      reload();
    } catch (e) {
      toast(errMsg(e), { kind: 'error' });
      reload();
    }
  };

  const allPhones = (lead.contacts ?? []).flatMap((c) => c.phones.filter((p) => p.type !== 'fax').map((p) => ({ c, p })));
  const primary = firstPhone(lead);
  const callPrimary = () => {
    if (lead.do_not_call) {
      toast('Dieser Lead ist auf „Nicht anrufen“ gesetzt.', { kind: 'error' });
      return;
    }
    if (!primary) {
      toast('Keine Telefonnummer hinterlegt.', { kind: 'error' });
      return;
    }
    if (inDialer) dialer.callNow(primary.number, primary.contact);
    else dial({ number: primary.number, leadId: lead.id, contactId: primary.contact.id, leadName: lead.name, contactName: primary.contact.name });
  };

  // Editor öffnen und auf dem Handy zum Verlauf wechseln
  const open = (c: Composer) => {
    setComposer(c);
    setTab('feed');
    mainRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const activeTypes = ref.activityTypes.filter((t) => !t.archived);
  const openActivity = (e?: { currentTarget: HTMLElement }) => {
    if (activeTypes.length === 1 || !e) open({ kind: 'activity', type: activeTypes[0] ?? null });
    else activityMenu.open(e);
  };

  useHotkeys({
    c: () => !snap.call && can('calling') && callPrimary(),
    n: () => open({ kind: 'note' }),
    e: () => open({ kind: 'email' }),
    s: () => can('calling') && open({ kind: 'sms' }),
    t: () => setModal('task'),
    a: () => activeTypes.length && openActivity(),
    // wie in Close: Strg/Cmd + Umschalt + D/E/K/O
    'mod+shift+d': (e) => {
      e.preventDefault();
      if (!snap.call && can('calling')) callPrimary();
    },
    'mod+shift+e': (e) => {
      e.preventDefault();
      open({ kind: 'email' });
    },
    'mod+shift+k': (e) => {
      e.preventDefault();
      if (can('calling')) open({ kind: 'sms' });
    },
    'mod+shift+o': (e) => {
      e.preventDefault();
      open({ kind: 'note' });
    },
  });

  const remove = async () => {
    if (!(await confirm(`„${lead.name}“ mit allen Kontakten, Notizen und Aufgaben löschen?`, { danger: true, confirmLabel: 'Endgültig löschen' }))) return;
    try {
      await store.deleteLeads([lead.id]);
      bus.emit('leads');
      navigate('#/leads');
    } catch (e) {
      toast(errMsg(e), { kind: 'error' });
    }
  };

  const contact0 = lead.contacts?.[0] ?? null;
  const linkVars = {
    'lead.name': lead.name,
    'lead.address_street': lead.address_street ?? '',
    'lead.address_zip': lead.address_zip ?? '',
    'lead.address_city': lead.address_city ?? '',
    'lead.url': lead.url ?? '',
    'lead.id': lead.id,
    'contact.name': contact0?.name ?? '',
    'contact.phone': contact0?.phones[0]?.number ?? '',
    'contact.email': contact0?.emails[0]?.email ?? '',
  };
  const links = ref.integrationLinks
    .filter((l) => l.scope === 'lead')
    .map((l) => ({ ...l, href: fillTemplate(l.url_template, Object.fromEntries(Object.entries(linkVars).map(([k, v]) => [k, encodeURIComponent(v)]))) }));
  const dupeCount = dupes.data?.length ?? 0;
  const closeComposer = () => setComposer(null);

  return (
    <div className="lead-page" data-tab={tab}>
      <aside className="lead-left" aria-label="Lead-Details">
        <LeadHeader lead={lead} onSave={save} onMore={more.open} onEdit={() => setModal('edit')} />

        {dupeCount ? (
          <div className="callout warn lead-dupes">
            <GitMerge />
            <span className="grow small">
              {dupeCount === 1 ? 'Möglicherweise doppelt angelegt' : `${dupeCount} mögliche Dubletten`}: {dupes.data!.map((d) => d.reasons).join('; ')}
            </span>
            <button type="button" className="btn small" onClick={() => setModal('dupes')}>Ansehen</button>
          </div>
        ) : null}

        <div className="lead-tabs show-mobile">
          <Segmented
            value={tab}
            onChange={setTab}
            label="Ansicht"
            options={[
              { value: 'feed', label: 'Aktivitäten' },
              { value: 'details', label: 'Details' },
            ]}
          />
        </div>

        <div className="lead-details">
          <TasksSection leadId={lead.id} onAdd={() => setModal('task')} onEdit={setEditTask} />
          <OppsSection leadId={lead.id} onAdd={() => setModal('opp')} onEdit={setEditOpp} />
          <ContactsSection
            lead={lead}
            onAdd={() => setModal('contact')}
            onEdit={setEditContact}
            onEmail={(to) => open({ kind: 'email', to })}
            onSms={(to) => open({ kind: 'sms', to })}
          />
          <FieldsSection lead={lead} onSave={save} />
          <WorkflowsSection leadId={lead.id} onAdd={() => setModal('workflow')} />
          {links.length ? (
            <section className="lead-sec">
              <div className="lead-sec-head"><h2>Links</h2></div>
              <div className="lead-links">
                {links.map((l) => (
                  <a key={l.id} href={l.href} target="_blank" rel="noopener">
                    <ExternalLink size={14} /> {l.name}
                  </a>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      </aside>

      <section className="lead-main" ref={mainRef} aria-label="Aktivitäten">
        <div className="lead-actions" role="toolbar" aria-label="Aktionen">
          {can('calling') ? (
            <div className="btn-split">
              <button type="button" className="btn call" onClick={callPrimary} disabled={!!snap.call || !primary || lead.do_not_call} title={lead.do_not_call ? 'Nicht anrufen' : primary ? `${formatPhone(primary.number)} anrufen (C)` : 'Keine Nummer'}>
                <PhoneCall /> Anrufen
              </button>
              <button type="button" className="btn call caret" onClick={callMenu.open} aria-label="Andere Nummer oder Anruf protokollieren" aria-haspopup="menu">
                <ChevronDown />
              </button>
            </div>
          ) : null}
          <button type="button" className={cx('btn', composer?.kind === 'email' && 'active')} onClick={() => open({ kind: 'email' })} title="E-Mail (E)">
            <Mail /> E-Mail
          </button>
          {can('calling') ? (
            <button type="button" className={cx('btn', composer?.kind === 'sms' && 'active')} onClick={() => open({ kind: 'sms' })} disabled={!allPhones.length || lead.do_not_call} title="SMS (S)">
              <MessageCircle /> SMS
            </button>
          ) : null}
          <button type="button" className={cx('btn', composer?.kind === 'note' && 'active')} onClick={() => open({ kind: 'note' })} title="Notiz (N)">
            <StickyNote /> Notiz
          </button>
          {activeTypes.length ? (
            <button type="button" className={cx('btn', composer?.kind === 'activity' && 'active')} onClick={openActivity} aria-haspopup={activeTypes.length > 1 ? 'menu' : undefined} title="Aktivität (A)">
              <ClipboardList /> Aktivität {activeTypes.length > 1 ? <ChevronDown size={14} /> : null}
            </button>
          ) : null}
          <button type="button" className="btn" onClick={() => setModal('book')}>
            <CalendarPlus /> Termin
          </button>
        </div>

        {composer?.kind === 'note' ? <NoteComposer lead={lead} onClose={closeComposer} /> : null}
        {composer?.kind === 'log' ? <LogCallComposer lead={lead} onClose={closeComposer} /> : null}
        {composer?.kind === 'email' ? (
          <EmailModal
            inline
            key={`email-${composer.to ?? ''}-${composer.replyTo?.id ?? ''}`}
            lead={lead}
            contact={contact0}
            to={composer.to}
            replyTo={composer.replyTo ? { subject: composer.replyTo.subject, to: composer.replyTo.from_address ?? '', body: composer.replyTo.is_html ? undefined : composer.replyTo.body } : null}
            onClose={closeComposer}
          />
        ) : null}
        {composer?.kind === 'sms' ? <SmsModal inline key={`sms-${composer.to ?? ''}`} lead={lead} contact={contact0} to={composer.to} onClose={closeComposer} /> : null}
        {composer?.kind === 'activity' ? (
          <ActivityFormModal
            inline
            key={`act-${composer.type?.id ?? ''}-${composer.activity?.id ?? ''}`}
            lead={lead}
            type={composer.type}
            activity={composer.activity}
            onClose={closeComposer}
          />
        ) : null}
        {!composer ? (
          <button type="button" className="note-quick" onClick={() => open({ kind: 'note' })}>
            <StickyNote size={16} aria-hidden="true" /> Notiz schreiben …
          </button>
        ) : null}

        <Timeline
          items={timeline}
          leadId={lead.id}
          comments={comments}
          actions={{
            onReply: (e) => open({ kind: 'email', replyTo: e }),
            onEditActivity: (a) => open({ kind: 'activity', type: ref.activityTypes.find((t) => t.id === a.type_id) ?? null, activity: a }),
          }}
        />
      </section>

      {callMenu.isOpen ? (
        <Popover anchor={callMenu.anchor} onClose={callMenu.close}>
          {allPhones.length ? <div className="menu-label">Anrufen</div> : null}
          {allPhones.map(({ c, p }) => (
            <MenuItem
              key={`${c.id}-${p.number}`}
              icon={<Phone />}
              onClick={() => {
                callMenu.close();
                if (lead.do_not_call) {
                  toast('Dieser Lead ist auf „Nicht anrufen“ gesetzt.', { kind: 'error' });
                  return;
                }
                if (inDialer) dialer.callNow(p.number, c);
                else dial({ number: p.number, leadId: lead.id, contactId: c.id, leadName: lead.name, contactName: c.name });
              }}
            >
              <span className="num">{formatPhone(p.number)}</span>{' '}
              <span className="muted">{[c.name, phoneTypeLabel(p.type)].filter(Boolean).join(', ')}</span>
            </MenuItem>
          ))}
          {allPhones.length ? <div className="menu-sep" /> : null}
          <MenuItem icon={<PhoneForwarded />} onClick={() => { callMenu.close(); open({ kind: 'log' }); }}>
            Anruf protokollieren
          </MenuItem>
        </Popover>
      ) : null}

      {activityMenu.isOpen ? (
        <Popover anchor={activityMenu.anchor} onClose={activityMenu.close}>
          <div className="menu-label">Aktivität erfassen</div>
          {activeTypes.map((t) => (
            <MenuItem key={t.id} icon={<span className="dot" style={{ background: t.color }} />} onClick={() => { activityMenu.close(); open({ kind: 'activity', type: t }); }}>
              {t.name}
            </MenuItem>
          ))}
        </Popover>
      ) : null}

      {more.isOpen ? (
        <Popover anchor={more.anchor} onClose={more.close} align="end">
          <MenuItem icon={<Pencil />} onClick={() => { more.close(); setModal('edit'); }}>Lead bearbeiten</MenuItem>
          <MenuItem icon={<UserPlus />} onClick={() => { more.close(); setModal('contact'); }}>Kontakt hinzufügen</MenuItem>
          <MenuItem icon={<TrendingUp />} onClick={() => { more.close(); setModal('opp'); }}>Opportunity anlegen</MenuItem>
          <MenuItem icon={<Plus />} onClick={() => { more.close(); setModal('task'); }}>Aufgabe anlegen</MenuItem>
          {ref.workflows.some((w) => w.status === 'active') ? (
            <MenuItem icon={<WorkflowIcon />} onClick={() => { more.close(); setModal('workflow'); }}>In Workflow aufnehmen</MenuItem>
          ) : null}
          <MenuItem icon={<Ban />} onClick={() => { more.close(); save({ do_not_call: !lead.do_not_call }); }}>
            {lead.do_not_call ? '„Nicht anrufen“ aufheben' : 'Nicht mehr anrufen'}
          </MenuItem>
          <MenuItem icon={<Copy />} onClick={async () => { more.close(); if (await copyText(location.href)) toast('Link kopiert.'); }}>Link kopieren</MenuItem>
          {links.length ? <div className="menu-sep" /> : null}
          {links.map((l) => (
            <a key={l.id} className="menu-item" href={l.href} target="_blank" rel="noopener" onClick={more.close}>
              <ExternalLink /> <span className="grow">{l.name}</span>
            </a>
          ))}
          {can('merge_leads') ? (
            <>
              <div className="menu-sep" />
              <MenuItem icon={<GitMerge />} onClick={() => { more.close(); setModal('dupes'); }}>Zusammenführen / Dubletten</MenuItem>
            </>
          ) : null}
          {can('delete_leads') ? (
            <MenuItem icon={<Trash2 />} danger onClick={() => { more.close(); remove(); }}>Lead löschen</MenuItem>
          ) : null}
        </Popover>
      ) : null}

      {modal === 'book' ? <BookMeetingModal lead={lead} onClose={() => setModal(null)} /> : null}
      {modal === 'task' || editTask ? <TaskFormModal task={editTask ?? undefined} leadId={lead.id} onClose={() => { setModal(null); setEditTask(null); }} /> : null}
      {modal === 'opp' || editOpp ? <OpportunityModal opp={editOpp ?? undefined} leadId={lead.id} onClose={() => { setModal(null); setEditOpp(null); }} /> : null}
      {modal === 'contact' || editContact ? <ContactFormModal leadId={lead.id} contact={editContact ?? undefined} onClose={() => { setModal(null); setEditContact(null); }} /> : null}
      {modal === 'workflow' ? <EnrollInWorkflowModal leadIds={[lead.id]} contactId={contact0?.id ?? null} onClose={() => setModal(null)} /> : null}
      {modal === 'dupes' ? <DuplicatesModal lead={lead} onClose={() => { setModal(null); dupes.reload(); }} /> : null}
      {modal === 'edit' ? <LeadEditModal lead={lead} onSave={save} onClose={() => setModal(null)} /> : null}
    </div>
  );
}

// ---------- Kopf: Name, Status, Website, Adresse, Beschreibung ----------
function LeadHeader({ lead, onSave, onMore, onEdit }: { lead: Lead; onSave: (p: LeadInput) => void; onMore: (e: { currentTarget: HTMLElement }) => void; onEdit: () => void }) {
  const { ref } = useApp();
  const [title, setTitle] = useState(lead.name);
  useEffect(() => setTitle(lead.name), [lead.name]);
  const address = [lead.address_street, [lead.address_zip, lead.address_city].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  return (
    <div className="lead-head">
      <input
        className="lead-title"
        value={title}
        aria-label="Firmenname"
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => (title.trim() && title !== lead.name ? onSave({ name: title.trim() }) : setTitle(lead.name))}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') {
            setTitle(lead.name);
            (e.target as HTMLInputElement).blur();
          }
        }}
      />
      <div className="lead-status-row">
        <StatusPill value={lead.status_id} statuses={ref.statuses} onChange={(v) => onSave({ status_id: v })} label="Lead-Status" />
        {lead.do_not_call ? <Tag tone="red"><Ban size={12} /> Nicht anrufen</Tag> : null}
        <span className="grow" />
        <button type="button" className="icon-btn" onClick={onMore} aria-label="Weitere Aktionen" title="Weitere Aktionen" aria-haspopup="menu">
          <MoreHorizontal />
        </button>
      </div>
      <div className="lead-meta">
        {lead.url ? (
          <a href={ensureUrl(lead.url)} target="_blank" rel="noopener">
            <Globe size={14} aria-hidden="true" /> {hostOf(lead.url)}
          </a>
        ) : null}
        {address ? (
          <a href={`https://www.google.com/maps/search/${encodeURIComponent([lead.name, address].join(' '))}`} target="_blank" rel="noopener">
            <MapPin size={14} aria-hidden="true" /> {address}
          </a>
        ) : null}
        <button type="button" className="link-like small" onClick={onEdit}>
          {lead.url || address ? 'Bearbeiten' : 'Website und Adresse hinzufügen'}
        </button>
      </div>
      <Description value={lead.description ?? ''} onSave={(v) => onSave({ description: v || null })} />
    </div>
  );
}

function Description({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  if (!editing) {
    return (
      <button type="button" className={cx('lead-desc', !value && 'empty')} onClick={() => setEditing(true)} title="Beschreibung bearbeiten">
        {value || 'Beschreibung hinzufügen …'}
      </button>
    );
  }
  return (
    <textarea
      className="textarea lead-desc-edit"
      autoFocus
      value={v}
      aria-label="Beschreibung"
      placeholder="Was sollte jeder über diesen Lead wissen?"
      onChange={(e) => setV(e.target.value)}
      onBlur={() => {
        setEditing(false);
        if (v !== value) onSave(v.trim());
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          setV(value);
          setEditing(false);
        }
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) (e.target as HTMLTextAreaElement).blur();
      }}
    />
  );
}

function LeadEditModal({ lead, onSave, onClose }: { lead: Lead; onSave: (p: LeadInput) => Promise<void> | void; onClose: () => void }) {
  const [f, setF] = useState({
    name: lead.name,
    url: lead.url ?? '',
    address_street: lead.address_street ?? '',
    address_zip: lead.address_zip ?? '',
    address_city: lead.address_city ?? '',
    address_state: lead.address_state ?? '',
    source: lead.source ?? '',
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const submit = async () => {
    if (!f.name.trim()) return;
    await onSave({
      name: f.name.trim(),
      url: f.url.trim() || null,
      address_street: f.address_street.trim() || null,
      address_zip: f.address_zip.trim() || null,
      address_city: f.address_city.trim() || null,
      address_state: f.address_state.trim() || null,
      source: f.source.trim() || null,
    });
    onClose();
  };
  return (
    <Modal
      title="Lead bearbeiten"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Abbrechen</button>
          <button type="button" className="btn primary" onClick={submit} disabled={!f.name.trim()}>Speichern</button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Firma / Apotheke" className="full"><input className="input" value={f.name} onChange={set('name')} /></Field>
        <Field label="Website" className="full"><input className="input" value={f.url} onChange={set('url')} placeholder="www.…" /></Field>
        <Field label="Straße" className="full"><input className="input" value={f.address_street} onChange={set('address_street')} /></Field>
        <Field label="PLZ"><input className="input" inputMode="numeric" value={f.address_zip} onChange={set('address_zip')} /></Field>
        <Field label="Ort"><input className="input" value={f.address_city} onChange={set('address_city')} /></Field>
        <Field label="Bundesland (Adresse)"><input className="input" value={f.address_state} onChange={set('address_state')} /></Field>
        <Field label="Quelle"><input className="input" value={f.source} onChange={set('source')} /></Field>
      </div>
    </Modal>
  );
}

function DuplicatesModal({ lead, onClose }: { lead: Lead; onClose: () => void }) {
  const { store } = useApp();
  // Wurde dieser Lead in einen anderen zusammengeführt, zum behaltenen wechseln
  const afterMerge = async () => {
    const still = await store.getLead(lead.id).catch(() => null);
    if (!still) {
      onClose();
      navigate('#/leads');
      return;
    }
    q.reload();
    bus.emit('lead', lead.id);
  };
  const q = useAsync(async () => {
    const list = await store.findDuplicates(lead.id, 10);
    const leads = await store.getLeads([...new Set(list.flatMap((p) => [p.lead_a, p.lead_b]))]);
    return { list, byId: new Map(leads.map((l) => [l.id, l])) };
  }, [store, lead.id]);
  return (
    <Modal title="Zusammenführen" onClose={onClose} wide>
      {q.loading && !q.data ? (
        <Loading />
      ) : !q.data?.list.length ? (
        <p className="muted">Keine möglichen Dubletten gefunden.</p>
      ) : (
        <div className="col gap-12">
          {q.data.list.map((p) => {
            const a = q.data!.byId.get(p.lead_a);
            const b = q.data!.byId.get(p.lead_b);
            return a && b ? <PairCard key={`${p.lead_a}|${p.lead_b}`} pair={p} a={a} b={b} onDone={afterMerge} /> : null;
          })}
        </div>
      )}
    </Modal>
  );
}

// ---------- Abschnitte links ----------
function Section({ title, count, onAdd, addLabel, children }: { title: string; count?: number; onAdd?: (e: { currentTarget: HTMLElement }) => void; addLabel?: string; children: ReactNode }) {
  return (
    <section className="lead-sec">
      <div className="lead-sec-head">
        <h2>
          {title}
          {count ? <span className="lead-sec-count">{count}</span> : null}
        </h2>
        {onAdd ? (
          <button type="button" className="icon-btn small" onClick={onAdd} aria-label={addLabel} title={addLabel}>
            <Plus />
          </button>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function TasksSection({ leadId, onAdd, onEdit }: { leadId: string; onAdd: () => void; onEdit: (t: Task) => void }) {
  const { store } = useApp();
  const { toast } = useUi();
  const { name } = useLookups();
  const tasks = useAsync(() => store.listTasks({ leadId, done: false, assignedTo: 'all' }), [leadId, store], ['tasks']);
  const list = tasks.data ?? [];
  const done = async (t: Task) => {
    try {
      await store.setTaskDone(t.id, true);
      bus.emit('tasks');
      bus.emit('timeline', leadId);
      toast(`„${t.title}“ erledigt.`, {
        action: {
          label: 'Rückgängig',
          run: () => {
            store.setTaskDone(t.id, false).then(() => {
              bus.emit('tasks');
              bus.emit('timeline', leadId);
            });
          },
        },
      });
    } catch (e) {
      toast(errMsg(e), { kind: 'error' });
    }
  };
  return (
    <Section title="Aufgaben" count={list.length} onAdd={onAdd} addLabel="Aufgabe hinzufügen">
      {list.map((t) => (
        <div className="lead-row" key={t.id}>
          <button type="button" className="task-check" onClick={() => done(t)} aria-label={`„${t.title}“ als erledigt markieren`} title="Erledigt">
            <Circle />
          </button>
          <button type="button" className="lead-row-main plain-button" onClick={() => onEdit(t)}>
            <span className="strong">{t.title}</span>
            <span className="row gap-6 wrap xs">
              <DueTag due={t.due_at} />
              <span className="muted">{t.assigned_to ? name(t.assigned_to) : 'Team'}</span>
            </span>
          </button>
        </div>
      ))}
      {tasks.data && !list.length ? <p className="lead-sec-empty">Keine offenen Aufgaben.</p> : null}
    </Section>
  );
}

function OppsSection({ leadId, onAdd, onEdit }: { leadId: string; onAdd: () => void; onEdit: (o: Opportunity) => void }) {
  const { store, ref } = useApp();
  const { oppStatusById, name } = useLookups();
  const opps = useAsync(() => store.listOpportunities({ leadId }), [leadId, store], ['opportunities']);
  // aktive zuerst, dann gewonnene/verlorene – wie Closes „primäre Opportunity“
  const list = [...(opps.data ?? [])].sort((a, b) => {
    const ka = oppStatusById.get(a.status_id ?? '')?.kind === 'open' ? 0 : 1;
    const kb = oppStatusById.get(b.status_id ?? '')?.kind === 'open' ? 0 : 1;
    return ka - kb || (a.created_at < b.created_at ? 1 : -1);
  });
  return (
    <Section title="Opportunities" count={list.length} onAdd={onAdd} addLabel="Opportunity hinzufügen">
      {list.map((o) => {
        const st = o.status_id ? oppStatusById.get(o.status_id) : undefined;
        const pipe = ref.pipelines.find((p) => p.id === st?.pipeline_id);
        return (
          <button key={o.id} type="button" className="lead-row plain-button lead-opp" onClick={() => onEdit(o)}>
            {st?.kind === 'won' ? <CheckCircle2 size={16} color="var(--cross)" /> : <TrendingUp size={16} />}
            <span className="lead-row-main">
              <span className="row gap-6 wrap">
                <strong className="num">{formatMoney(o.value)}</strong>
                <span className="muted small">{o.value_period === 'monthly' ? 'mtl.' : o.value_period === 'annual' ? 'jährl.' : 'einmalig'}</span>
                {st ? <Tag color={st.color}>{st.label}</Tag> : null}
              </span>
              <span className="xs muted">
                {[ref.pipelines.length > 1 ? pipe?.name : null, `${o.confidence} %`, o.expected_close ? `bis ${formatDate(o.expected_close)}` : null, o.user_id ? name(o.user_id) : null].filter(Boolean).join(', ')}
              </span>
              {o.note ? <span className="small ellipsis-2">{o.note}</span> : null}
            </span>
          </button>
        );
      })}
      {opps.data && !list.length ? <p className="lead-sec-empty">Keine Opportunity.</p> : null}
    </Section>
  );
}

function ContactsSection({
  lead,
  onAdd,
  onEdit,
  onEmail,
  onSms,
}: {
  lead: Lead;
  onAdd: () => void;
  onEdit: (c: Contact) => void;
  onEmail: (to: string) => void;
  onSms: (to: string) => void;
}) {
  const { ref, can } = useApp();
  const contacts = lead.contacts ?? [];
  const roleField = ref.customFields.find((f) => f.entity === 'contact' && f.key === 'contact_role');
  const otherFields = ref.customFields.filter((f) => f.entity === 'contact' && f.key !== 'contact_role').sort((a, b) => a.sort - b.sort);
  return (
    <Section title="Kontakte" count={contacts.length} onAdd={onAdd} addLabel="Kontakt hinzufügen">
      {!contacts.length ? <p className="lead-sec-empty">Noch kein Kontakt.</p> : null}
      {contacts.map((c) => {
        const roles = roleField ? ((c.custom?.[roleField.key] as string[] | undefined) ?? []) : [];
        const extras = otherFields.filter((f) => !isEmptyValue(c.custom?.[f.key]));
        return (
          <div className="lead-contact" key={c.id}>
            <div className="row gap-6">
              <span className="grow" style={{ minWidth: 0 }}>
                <span className="contact-name">{c.name || 'Ohne Namen'}</span>
                {c.title ? <span className="block xs muted">{c.title}</span> : null}
              </span>
              <button type="button" className="icon-btn small" onClick={() => onEdit(c)} aria-label={`${c.name || 'Kontakt'} bearbeiten`} title="Bearbeiten">
                <Pencil />
              </button>
            </div>
            {roles.length ? (
              <div className="row wrap gap-4 mt-4">
                {roles.map((r) => <Tag key={r} tone={r === 'Decision Maker' ? 'green' : 'soft'}>{r}</Tag>)}
              </div>
            ) : null}
            {c.phones.map((p) => (
              <div className="contact-line" key={p.number}>
                <Phone size={14} className="muted" aria-hidden="true" />
                <span className="number num">{formatPhone(p.number)}</span>
                <span className="muted xs">{phoneTypeLabel(p.type)}</span>
                <span className="spacer" />
                {p.type !== 'fax' && can('calling') && !lead.do_not_call ? (
                  <>
                    <button type="button" className="icon-btn small" onClick={() => onSms(p.number)} aria-label={`SMS an ${formatPhone(p.number)}`} title="SMS">
                      <MessageCircle />
                    </button>
                    <CallButton number={p.number} leadId={lead.id} contactId={c.id} leadName={lead.name} contactName={c.name} small />
                  </>
                ) : null}
              </div>
            ))}
            {c.emails.map((e) => (
              <div className="contact-line" key={e.email}>
                <Mail size={14} className="muted" aria-hidden="true" />
                <button type="button" className="link-like ellipsis" onClick={() => onEmail(e.email)} title={`E-Mail an ${e.email}`}>
                  {e.email}
                </button>
              </div>
            ))}
            {extras.length ? (
              <dl className="contact-extras">
                {extras.map((f) => (
                  <div key={f.key} className="row gap-6">
                    <dt className="muted">{f.label}</dt>
                    <dd>{formatFieldValue(shapeOf(f), c.custom?.[f.key], ref.profiles)}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
          </div>
        );
      })}
    </Section>
  );
}

// ---------- Felder (wie Closes „Custom Fields“: ausgefüllte + immer sichtbare, Rest über +) ----------
function FieldsSection({ lead, onSave }: { lead: Lead; onSave: (p: LeadInput) => void }) {
  const { ref, can } = useApp();
  const { name } = useLookups();
  const addMenu = useMenu();
  const [added, setAdded] = useState<string[]>([]);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const fields = ref.customFields.filter((f) => f.entity === 'lead').sort((a, b) => a.sort - b.sort);
  const visible = fields.filter((f) => f.always_show || !isEmptyValue(lead.custom?.[f.key]) || added.includes(f.key));
  const hidden = fields.filter((f) => !visible.includes(f) && (!f.restricted || can('edit_restricted_fields')));
  return (
    <Section title="Felder" onAdd={hidden.length ? addMenu.open : undefined} addLabel="Feld ausfüllen">
      <dl className="lead-fields">
        <dt>Zuständig</dt>
        <dd>
          <UserSelect value={lead.owner_id} onChange={(v) => onSave({ owner_id: v })} emptyLabel="Niemand" id="lead-owner" />
        </dd>
        <dt>Opener</dt>
        <dd>
          <UserSelect value={lead.opener_id} onChange={(v) => onSave({ opener_id: v })} emptyLabel="–" id="lead-opener" />
        </dd>
        {visible.map((f) => (
          <CustomFieldRow key={f.key} lead={lead} field={f} onSave={onSave} autoEdit={focusKey === f.key} onEdited={() => setFocusKey(null)} />
        ))}
      </dl>
      <p className="lead-stats xs muted">
        Angelegt {formatDate(lead.created_at)}
        {lead.created_by ? ` von ${name(lead.created_by)}` : ''}
        {lead.source ? `, Quelle: ${lead.source}` : ''}. {lead.call_count === 1 ? '1 Anruf' : `${lead.call_count} Anrufe`}
        {lead.last_call_at ? `, zuletzt ${formatDateTime(lead.last_call_at)}` : ''}.
      </p>
      {addMenu.isOpen ? (
        <Popover anchor={addMenu.anchor} onClose={addMenu.close} align="end">
          <div className="menu-label">Feld ausfüllen</div>
          {hidden.map((f) => (
            <MenuItem
              key={f.key}
              onClick={() => {
                addMenu.close();
                setAdded([...added, f.key]);
                setFocusKey(f.key);
              }}
            >
              {f.label}
            </MenuItem>
          ))}
        </Popover>
      ) : null}
    </Section>
  );
}

// Ein Feld: zeigt den Wert als Text; ein Klick macht es bearbeitbar (Auswahl speichert sofort, Text beim Verlassen).
function CustomFieldRow({ lead, field, onSave, autoEdit, onEdited }: { lead: Lead; field: CustomField; onSave: (p: LeadInput) => void; autoEdit?: boolean; onEdited?: () => void }) {
  const { can, ref } = useApp();
  const shape = shapeOf(field);
  const stored = lead.custom?.[field.key];
  const [editing, setEditing] = useState(!!autoEdit);
  const [v, setV] = useState<unknown>(stored);
  const box = useRef<HTMLElement>(null);
  useEffect(() => setV(stored), [stored]);
  useEffect(() => {
    if (!editing) return;
    const el = box.current?.querySelector<HTMLElement>('input, select, textarea, button');
    el?.focus();
    // Auswahllisten gleich aufklappen, wo der Browser das kann
    if (el instanceof HTMLSelectElement && 'showPicker' in el) {
      try {
        (el as HTMLSelectElement & { showPicker: () => void }).showPicker();
      } catch {
        /* nicht überall erlaubt */
      }
    }
  }, [editing]);
  const locked = field.restricted && !can('edit_restricted_fields');
  const commit = (next: unknown) => {
    if (JSON.stringify(next ?? null) !== JSON.stringify(stored ?? null)) onSave({ custom: { ...(lead.custom ?? {}), [field.key]: next } });
  };
  const finish = () => {
    setEditing(false);
    onEdited?.();
  };
  const immediate = ['choice', 'checkbox', 'user', 'date', 'datetime'].includes(field.type);
  const text = formatFieldValue(shape, stored, ref.profiles);
  return (
    <>
      <dt title={field.description || undefined}>
        {field.label}
        {locked ? <Lock size={11} className="muted" aria-label="geschützt" /> : null}
      </dt>
      <dd
        ref={box}
        onBlur={(e) => {
          if (!editing || box.current?.contains(e.relatedTarget as Node)) return;
          if (!immediate) commit(v);
          finish();
        }}
        onKeyDown={(e) => {
          if (!editing) return;
          if (e.key === 'Escape') {
            setV(stored);
            finish();
          }
          if (e.key === 'Enter' && field.type !== 'textarea' && !immediate) {
            commit(v);
            finish();
          }
        }}
      >
        {editing && !locked ? (
          <FieldInput
            field={shape}
            value={v}
            inline
            onChange={(next) => {
              setV(next);
              if (immediate) {
                commit(next);
                if (field.type !== 'checkbox') finish();
              } else if (field.type === 'multichoice') {
                commit(next);
              }
            }}
          />
        ) : (
          <button
            type="button"
            className={cx('field-value', !text && 'empty')}
            onClick={() => !locked && setEditing(true)}
            disabled={locked}
            aria-label={`${field.label}: ${text || 'leer'}${locked ? '' : ' – bearbeiten'}`}
          >
            {text || '–'}
          </button>
        )}
      </dd>
    </>
  );
}

function WorkflowsSection({ leadId, onAdd }: { leadId: string; onAdd: () => void }) {
  const { store, ref } = useApp();
  const { toast } = useUi();
  const runs = useAsync(() => store.listWorkflowRuns({ leadId, limit: 20 }), [store, leadId], ['workflows', 'tasks']);
  const list = runs.data ?? [];
  if (!list.length && !ref.workflows.some((w) => w.status === 'active')) return null;

  const setStatus = async (id: string, status: 'active' | 'paused' | 'canceled') => {
    try {
      await store.setWorkflowRunStatus(id, status);
      bus.emit('workflows');
    } catch (e) {
      toast(errMsg(e), { kind: 'error' });
    }
  };

  return (
    <Section title="Workflows" count={list.filter((r) => r.status === 'active' || r.status === 'paused').length} onAdd={onAdd} addLabel="In Workflow aufnehmen">
      {list.map((r) => {
        const wf = ref.workflows.find((w) => w.id === r.workflow_id);
        const st = RUN_STATUS[r.status];
        const running = r.status === 'active' || r.status === 'paused';
        return (
          <div key={r.id} className="lead-row">
            <WorkflowIcon size={16} className="muted" />
            <span className="lead-row-main">
              <a href={routeHref({ name: 'workflow', id: r.workflow_id })} className="strong ellipsis block">{wf?.name ?? 'Workflow'}</a>
              <span className="xs muted">
                {running && r.next_at ? `Schritt ${r.step_index + 1} von ${wf?.steps.length ?? '?'}, ${formatDateTime(r.next_at)}` : r.end_reason ?? ''}
              </span>
            </span>
            <Tag tone={st.tone}>{st.label}</Tag>
            {running ? (
              <>
                <button type="button" className="icon-btn small" onClick={() => setStatus(r.id, r.status === 'active' ? 'paused' : 'active')} aria-label={r.status === 'active' ? 'Pausieren' : 'Fortsetzen'}>
                  {r.status === 'active' ? <Pause /> : <Play />}
                </button>
                <button type="button" className="icon-btn small" onClick={() => setStatus(r.id, 'canceled')} aria-label="Beenden"><X /></button>
              </>
            ) : null}
          </div>
        );
      })}
      {!list.length ? <p className="lead-sec-empty">In keinem Workflow.</p> : null}
    </Section>
  );
}

// ---------- Editoren oben im Verlauf ----------
function NoteComposer({ lead, onClose }: { lead: Lead; onClose: () => void }) {
  const { store, ref } = useApp();
  const { toast } = useUi();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!note.trim()) return;
    setBusy(true);
    try {
      await store.addNote(lead.id, note.trim(), null, mentionsIn(note, ref.profiles));
      bus.emit('timeline', lead.id);
      onClose();
    } catch (e) {
      toast(errMsg(e), { kind: 'error' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <InlinePanel
      title="Notiz"
      onClose={onClose}
      footer={
        <>
          <span className="xs muted hide-touch" style={{ marginRight: 'auto' }}>Strg + Enter speichert, @Name erwähnt Kollegen</span>
          <button type="button" className="btn" onClick={onClose}>Abbrechen</button>
          <button type="button" className="btn primary" onClick={save} disabled={busy || !note.trim()}>Notiz speichern</button>
        </>
      }
    >
      <MentionInput id="composer-note" className="composer-input" value={note} onChange={setNote} profiles={ref.profiles} placeholder="Notiz schreiben …" onSubmit={save} ariaLabel="Notiz" />
    </InlinePanel>
  );
}

// Anruf nachtragen, der außerhalb des CRM stattfand (z. B. vom Handy) – Closes „Log a Call“
function LogCallComposer({ lead, onClose }: { lead: Lead; onClose: () => void }) {
  const { store, ref } = useApp();
  const { toast } = useUi();
  const outcomes = ref.outcomes.filter((o) => o.active);
  const [note, setNote] = useState('');
  const [outcome, setOutcome] = useState(outcomes[0]?.key ?? '');
  const [minutes, setMinutes] = useState('2');
  const [direction, setDirection] = useState<'outbound' | 'inbound'>('outbound');
  const [contactId, setContactId] = useState<string | null>(lead.contacts?.[0]?.id ?? null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await store.logManualCall({
        lead_id: lead.id,
        contact_id: contactId,
        direction,
        outcome: outcome || null,
        note: note.trim() || null,
        duration: Math.round((Number(minutes.replace(',', '.')) || 0) * 60),
      });
      bus.emit('timeline', lead.id);
      bus.emit('lead', lead.id);
      toast('Anruf protokolliert.');
      onClose();
    } catch (e) {
      toast(errMsg(e), { kind: 'error' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <InlinePanel
      title="Anruf protokollieren"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Abbrechen</button>
          <button type="button" className="btn primary" onClick={save} disabled={busy}>Anruf speichern</button>
        </>
      }
    >
      <div className="col gap-12">
        <div className="form-grid">
          <Field label="Kontakt">
            <select className="select" value={contactId ?? ''} onChange={(e) => setContactId(e.target.value || null)}>
              <option value="">– keiner –</option>
              {(lead.contacts ?? []).map((c) => <option key={c.id} value={c.id}>{c.name || 'Ohne Namen'}</option>)}
            </select>
          </Field>
          <Field label="Richtung">
            <select className="select" value={direction} onChange={(e) => setDirection(e.target.value as 'outbound' | 'inbound')}>
              <option value="outbound">Ausgehend</option>
              <option value="inbound">Eingehend</option>
            </select>
          </Field>
          <Field label="Ergebnis">
            <select className="select" value={outcome} onChange={(e) => setOutcome(e.target.value)}>
              {outcomes.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
            </select>
          </Field>
          <Field label="Dauer (Minuten)">
            <input className="input" inputMode="decimal" value={minutes} onChange={(e) => setMinutes(e.target.value)} />
          </Field>
        </div>
        <Field label="Notiz">
          <MentionInput value={note} onChange={setNote} profiles={ref.profiles} placeholder="Was wurde besprochen?" onSubmit={save} ariaLabel="Gesprächsnotiz" rows={3} />
        </Field>
      </div>
    </InlinePanel>
  );
}
