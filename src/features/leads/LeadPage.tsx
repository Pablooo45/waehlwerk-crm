// Lead-Seite wie in Close: Kopf mit Status und Zuständigkeit, Aktionen (Anrufen, SMS, E-Mail, Termin, Formular …),
// Kontakte und Felder links, Verlauf mit Kommentaren in der Mitte, Aufgaben/Termine/Opportunities/Workflows rechts.

import {
  Ban,
  CalendarPlus,
  CheckCircle2,
  Circle,
  ClipboardList,
  Copy,
  ExternalLink,
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
  Play,
  Plus,
  StickyNote,
  Trash2,
  TrendingUp,
  UserPlus,
  Workflow as WorkflowIcon,
  X,
} from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { useApp, usePhone } from '../../app/context.tsx';
import { useAsync, useLookups } from '../../app/hooks.ts';
import { navigate, routeHref } from '../../app/router.ts';
import { bus } from '../../lib/bus.ts';
import { addDays, startOfDay } from '../../lib/dates.ts';
import { ensureUrl, fillTemplate, formatDate, formatDateTime, formatDay, formatMoney, formatPhone, formatTime, hostOf } from '../../lib/format.ts';
import type { ActivityType, Contact, CustomActivity, Email, Lead, LeadInput, Opportunity, Task, TimelineItem } from '../../lib/types.ts';
import { MentionInput, mentionsIn } from '../../ui/MentionInput.tsx';
import { copyText, Empty, errMsg, Loading, MenuItem, Modal, Popover, Tabs, Tag, useHotkeys, useMenu, useUi } from '../../ui/ui.tsx';
import { CallButton, DueTag, StatusSelect, UserSelect } from '../common/bits.tsx';
import { FieldInput, shapeOf } from '../common/fields.tsx';
import { ActivityFormModal, ContactFormModal, EmailModal, OpportunityModal, phoneTypeLabel, SmsModal, TaskFormModal } from '../common/forms.tsx';
import { firstPhone } from '../dialer/DialerContext.tsx';
import { BookMeetingModal } from '../meetings/BookMeeting.tsx';
import { PairCard } from '../settings/Duplicates.tsx';
import { EnrollInWorkflowModal } from '../workflows/WorkflowPage.tsx';
import { RUN_STATUS } from '../workflows/meta.tsx';
import { MeetingActions, Timeline } from './Timeline.tsx';

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

type ModalKind = null | 'book' | 'email' | 'sms' | 'task' | 'opp' | 'contact' | 'activity' | 'workflow' | 'dupes';

function LeadView({ lead, timeline, comments, reload }: { lead: Lead; timeline: TimelineItem[]; comments: import('../../lib/types.ts').Comment[]; reload: () => void }) {
  const { store, ref, can, dial } = useApp();
  const { toast, confirm } = useUi();
  const { name } = useLookups();
  const snap = usePhone();
  const [title, setTitle] = useState(lead.name);
  const [modal, setModal] = useState<ModalKind>(null);
  const [editContact, setEditContact] = useState<Contact | null>(null);
  const [editTask, setEditTask] = useState<Task | null>(null);
  const [editOpp, setEditOpp] = useState<Opportunity | null>(null);
  const [activityType, setActivityType] = useState<ActivityType | null>(null);
  const [editActivity, setEditActivity] = useState<CustomActivity | null>(null);
  const [replyTo, setReplyTo] = useState<Email | null>(null);
  const more = useMenu();
  const callMenu = useMenu();
  const formMenu = useMenu();
  const dupes = useAsync(() => (can('merge_leads') ? store.findDuplicates(lead.id, 5) : Promise.resolve([])), [store, lead.id], ['leads']);

  useEffect(() => setTitle(lead.name), [lead.name]);

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
    dial({ number: primary.number, leadId: lead.id, contactId: primary.contact.id, leadName: lead.name, contactName: primary.contact.name });
  };

  useHotkeys({
    c: () => !snap.call && can('calling') && callPrimary(),
    n: () => document.getElementById('composer-note')?.focus(),
    e: () => setModal('email'),
    t: () => setModal('task'),
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

  const pinned = timeline.filter((t) => t.kind === 'note' && t.data.pinned);
  const activeTypes = ref.activityTypes.filter((t) => !t.archived);
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

  return (
    <div className="page lead-page">
      <div className="lead-head">
        <div className="grow" style={{ minWidth: 260 }}>
          <input
            className="lead-title"
            value={title}
            aria-label="Firmenname"
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => title.trim() && title !== lead.name && save({ name: title.trim() })}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          />
          <div className="lead-meta">
            {lead.do_not_call ? <Tag tone="red"><Ban size={12} /> Nicht anrufen</Tag> : null}
            {lead.address_city ? (
              <a href={`https://www.google.com/maps/search/${encodeURIComponent([lead.name, lead.address_street, lead.address_zip, lead.address_city].filter(Boolean).join(' '))}`} target="_blank" rel="noopener" className="row gap-4">
                <MapPin size={14} /> {[lead.address_street, [lead.address_zip, lead.address_city].filter(Boolean).join(' ')].filter(Boolean).join(', ')}
              </a>
            ) : null}
            {lead.url ? (
              <a href={ensureUrl(lead.url)} target="_blank" rel="noopener" className="row gap-4">
                <ExternalLink size={14} /> {hostOf(lead.url)}
              </a>
            ) : null}
            {lead.opener_id ? <span>Opener: {name(lead.opener_id)}</span> : null}
            <span>Angelegt {formatDate(lead.created_at)}{lead.source ? `, ${lead.source}` : ''}</span>
          </div>
        </div>
        <div className="row wrap lead-head-fields">
          <div className="field">
            <label htmlFor="lead-status">Status</label>
            <StatusSelect value={lead.status_id} onChange={(v) => save({ status_id: v })} statuses={ref.statuses} id="lead-status" />
          </div>
          <div className="field">
            <label htmlFor="lead-owner">Zuständig</label>
            <UserSelect value={lead.owner_id} onChange={(v) => save({ owner_id: v })} emptyLabel="Niemand" id="lead-owner" />
          </div>
        </div>
      </div>

      <div className="row wrap lead-actions">
        {can('calling') ? (
          <button type="button" className="btn call" onClick={allPhones.length > 1 ? callMenu.open : callPrimary} disabled={!!snap.call || !primary || lead.do_not_call} title={lead.do_not_call ? 'Nicht anrufen' : 'Anrufen (C)'}>
            <PhoneCall /> Anrufen <kbd className="hide-touch kbd-on-dark">C</kbd>
          </button>
        ) : null}
        <button type="button" className="btn" onClick={() => setModal('email')} title="E-Mail (E)">
          <Mail /> E-Mail
        </button>
        {can('calling') ? (
          <button type="button" className="btn" onClick={() => setModal('sms')} disabled={!allPhones.length || lead.do_not_call}>
            <MessageCircle /> SMS
          </button>
        ) : null}
        <button type="button" className="btn" onClick={() => setModal('book')}>
          <CalendarPlus /> Termin
        </button>
        {activeTypes.length ? (
          <button type="button" className="btn" onClick={activeTypes.length > 1 ? formMenu.open : () => { setActivityType(activeTypes[0]); setModal('activity'); }}>
            <ClipboardList /> {activeTypes.length > 1 ? 'Formular' : activeTypes[0].name}
          </button>
        ) : null}
        <button type="button" className="btn" onClick={() => setModal('task')} title="Aufgabe (T)">
          <Plus /> Aufgabe
        </button>
        <button type="button" className="btn hide-mobile" onClick={() => setModal('opp')}>
          <TrendingUp /> Opportunity
        </button>
        <button type="button" className="icon-btn" onClick={more.open} aria-label="Mehr">
          <MoreHorizontal />
        </button>
      </div>

      {dupeCount ? (
        <div className="callout warn lead-dupes">
          <GitMerge />
          <span className="grow">
            {dupeCount === 1 ? 'Möglicherweise doppelt angelegt' : `${dupeCount} mögliche Dubletten`}: {dupes.data!.map((d) => d.reasons).join('; ')}
          </span>
          <button type="button" className="btn small" onClick={() => setModal('dupes')}>Ansehen</button>
        </div>
      ) : null}

      {pinned.length ? (
        <div className="callout warn" style={{ marginBottom: 16 }}>
          <StickyNote />
          <div className="col gap-4">
            {pinned.map((p) => (
              <span key={p.id} className="pre-wrap">{p.kind === 'note' ? p.data.body : ''}</span>
            ))}
          </div>
        </div>
      ) : null}

      <div className="lead-grid">
        <div className="col">
          <ContactsPanel lead={lead} onAdd={() => setModal('contact')} onEdit={setEditContact} />
          <InfoPanel lead={lead} onSave={save} links={links} />
        </div>
        <div className="col">
          <Composer lead={lead} onEmail={() => setModal('email')} onSms={() => setModal('sms')} onForm={(t) => { setActivityType(t); setModal('activity'); }} />
          <Timeline
            items={timeline}
            leadId={lead.id}
            comments={comments}
            actions={{
              onReply: (e) => {
                setReplyTo(e);
                setModal('email');
              },
              onEditActivity: (a) => {
                setEditActivity(a);
                setModal('activity');
              },
            }}
          />
        </div>
        <div className="col right">
          <TasksPanel leadId={lead.id} onAdd={() => setModal('task')} onEdit={setEditTask} />
          <MeetingsPanel leadId={lead.id} onBook={() => setModal('book')} />
          <OppsPanel leadId={lead.id} onAdd={() => setModal('opp')} onEdit={setEditOpp} />
          <WorkflowsPanel leadId={lead.id} onAdd={() => setModal('workflow')} />
        </div>
      </div>

      {callMenu.isOpen ? (
        <Popover anchor={callMenu.anchor} onClose={callMenu.close}>
          {allPhones.map(({ c, p }) => (
            <MenuItem
              key={`${c.id}-${p.number}`}
              icon={<Phone />}
              onClick={() => {
                callMenu.close();
                dial({ number: p.number, leadId: lead.id, contactId: c.id, leadName: lead.name, contactName: c.name });
              }}
            >
              <span className="num">{formatPhone(p.number)}</span>{' '}
              <span className="muted">{[c.name, phoneTypeLabel(p.type)].filter(Boolean).join(', ')}</span>
            </MenuItem>
          ))}
        </Popover>
      ) : null}

      {formMenu.isOpen ? (
        <Popover anchor={formMenu.anchor} onClose={formMenu.close}>
          {activeTypes.map((t) => (
            <MenuItem key={t.id} icon={<span className="dot" style={{ background: t.color }} />} onClick={() => { formMenu.close(); setActivityType(t); setModal('activity'); }}>
              {t.name}
            </MenuItem>
          ))}
        </Popover>
      ) : null}

      {more.isOpen ? (
        <Popover anchor={more.anchor} onClose={more.close} align="end">
          <MenuItem icon={<UserPlus />} onClick={() => { more.close(); setModal('contact'); }}>Kontakt hinzufügen</MenuItem>
          <MenuItem icon={<TrendingUp />} onClick={() => { more.close(); setModal('opp'); }}>Opportunity anlegen</MenuItem>
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
          <div className="menu-sep" />
          <div className="menu-label">Opener (für Provision/Berichte)</div>
          <div style={{ padding: '2px 8px 8px' }}>
            <UserSelect value={lead.opener_id} onChange={(v) => { more.close(); save({ opener_id: v }); }} emptyLabel="– kein Opener –" />
          </div>
          {can('merge_leads') ? (
            <MenuItem icon={<GitMerge />} onClick={() => { more.close(); setModal('dupes'); }}>Dubletten prüfen</MenuItem>
          ) : null}
          {can('delete_leads') ? (
            <>
              <div className="menu-sep" />
              <MenuItem icon={<Trash2 />} danger onClick={() => { more.close(); remove(); }}>Lead löschen</MenuItem>
            </>
          ) : null}
        </Popover>
      ) : null}

      {modal === 'book' ? <BookMeetingModal lead={lead} onClose={() => setModal(null)} /> : null}
      {modal === 'email' ? (
        <EmailModal
          lead={lead}
          contact={contact0}
          replyTo={replyTo ? { subject: replyTo.subject, to: replyTo.from_address ?? '', body: replyTo.is_html ? undefined : replyTo.body } : null}
          onClose={() => { setModal(null); setReplyTo(null); }}
        />
      ) : null}
      {modal === 'sms' ? <SmsModal lead={lead} contact={contact0} onClose={() => setModal(null)} /> : null}
      {modal === 'task' || editTask ? <TaskFormModal task={editTask ?? undefined} leadId={lead.id} onClose={() => { setModal(null); setEditTask(null); }} /> : null}
      {modal === 'opp' || editOpp ? <OpportunityModal opp={editOpp ?? undefined} leadId={lead.id} onClose={() => { setModal(null); setEditOpp(null); }} /> : null}
      {modal === 'contact' || editContact ? <ContactFormModal leadId={lead.id} contact={editContact ?? undefined} onClose={() => { setModal(null); setEditContact(null); }} /> : null}
      {modal === 'activity' ? (
        <ActivityFormModal lead={lead} type={activityType} activity={editActivity} onClose={() => { setModal(null); setEditActivity(null); setActivityType(null); }} />
      ) : null}
      {modal === 'workflow' ? <EnrollInWorkflowModal leadIds={[lead.id]} contactId={contact0?.id ?? null} onClose={() => setModal(null)} /> : null}
      {modal === 'dupes' ? <DuplicatesModal lead={lead} onClose={() => { setModal(null); dupes.reload(); }} /> : null}
    </div>
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
    <Modal title="Mögliche Dubletten" onClose={onClose} wide>
      {q.loading && !q.data ? (
        <Loading />
      ) : !q.data?.list.length ? (
        <p className="muted">Keine Dubletten gefunden.</p>
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

function ContactsPanel({ lead, onAdd, onEdit }: { lead: Lead; onAdd: () => void; onEdit: (c: Contact) => void }) {
  const { ref, can } = useApp();
  const contacts = lead.contacts ?? [];
  const roleField = ref.customFields.find((f) => f.entity === 'contact' && f.key === 'contact_role');
  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Kontakte</h2>
        <button type="button" className="icon-btn small" onClick={onAdd} aria-label="Kontakt hinzufügen" title="Kontakt hinzufügen">
          <Plus />
        </button>
      </div>
      {!contacts.length ? (
        <div className="panel-body muted small">Noch kein Kontakt. Mit + hinzufügen.</div>
      ) : (
        contacts.map((c) => {
          const roles = roleField ? ((c.custom?.[roleField.key] as string[] | undefined) ?? []) : [];
          return (
            <div className="contact" key={c.id}>
              <div className="row">
                <span className="grow">
                  <span className="contact-name">{c.name || 'Ohne Namen'}</span>
                  {c.title ? <span className="muted small"> – {c.title}</span> : null}
                </span>
                <button type="button" className="icon-btn small" onClick={() => onEdit(c)} aria-label="Kontakt bearbeiten" title="Bearbeiten">
                  <Pencil />
                </button>
              </div>
              {roles.length ? (
                <div className="row wrap gap-4 mt-4">
                  {roles.map((r) => <Tag key={r} tone={r === 'Decision Maker' ? 'green' : 'soft'}>{r}</Tag>)}
                </div>
              ) : null}
              {c.phones.map((p) => (
                <div className="phone-line" key={p.number}>
                  <span className="number num">{formatPhone(p.number)}</span>
                  <span className="muted xs">{phoneTypeLabel(p.type)}</span>
                  <span className="spacer" />
                  {p.type !== 'fax' && can('calling') && !lead.do_not_call ? <CallButton number={p.number} leadId={lead.id} contactId={c.id} leadName={lead.name} contactName={c.name} small /> : null}
                </div>
              ))}
              {c.emails.map((e) => (
                <div className="phone-line small" key={e.email}>
                  <a href={`mailto:${e.email}`} className="ellipsis">{e.email}</a>
                </div>
              ))}
            </div>
          );
        })
      )}
    </div>
  );
}

function InlineInput({ value, onSave, type = 'text', placeholder }: { value: string; onSave: (v: string) => void; type?: string; placeholder?: string }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <input
      className="inline-edit"
      type={type}
      value={v}
      placeholder={placeholder ?? '–'}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v !== value && onSave(v)}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  );
}

// Eigenes Feld in der Seitenleiste: Text erst beim Verlassen speichern, Auswahl sofort
function CustomFieldRow({ lead, field, onSave }: { lead: Lead; field: import('../../lib/types.ts').CustomField; onSave: (p: LeadInput) => void }) {
  const { can } = useApp();
  const shape = shapeOf(field);
  const stored = lead.custom?.[field.key];
  const [v, setV] = useState<unknown>(stored);
  useEffect(() => setV(stored), [stored]);
  const locked = field.restricted && !can('edit_restricted_fields');
  const commit = (next: unknown) => {
    if (JSON.stringify(next ?? null) === JSON.stringify(stored ?? null)) return;
    onSave({ custom: { ...(lead.custom ?? {}), [field.key]: next } });
  };
  const immediate = ['choice', 'multichoice', 'checkbox', 'user', 'date', 'datetime'].includes(field.type);
  return (
    <>
      <dt title={field.description || undefined}>
        {field.label}
        {locked ? <Lock size={11} className="muted" aria-label="geschützt" /> : null}
      </dt>
      <dd onBlur={immediate ? undefined : () => commit(v)}>
        <FieldInput
          field={shape}
          value={v}
          inline
          disabled={locked}
          onChange={(next) => {
            setV(next);
            if (immediate) commit(next);
          }}
        />
      </dd>
    </>
  );
}

function InfoPanel({ lead, onSave, links }: { lead: Lead; onSave: (p: LeadInput) => void; links: { id: string; name: string; href: string }[] }) {
  const { ref } = useApp();
  const fields = ref.customFields.filter((f) => f.entity === 'lead').sort((a, b) => a.sort - b.sort);
  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Infos</h2>
      </div>
      <div className="panel-body">
        <dl className="kv">
          <dt>Straße</dt>
          <dd><InlineInput value={lead.address_street ?? ''} onSave={(v) => onSave({ address_street: v || null })} /></dd>
          <dt>PLZ</dt>
          <dd><InlineInput value={lead.address_zip ?? ''} onSave={(v) => onSave({ address_zip: v || null })} /></dd>
          <dt>Ort</dt>
          <dd><InlineInput value={lead.address_city ?? ''} onSave={(v) => onSave({ address_city: v || null })} /></dd>
          <dt>Bundesland (Adresse)</dt>
          <dd><InlineInput value={lead.address_state ?? ''} onSave={(v) => onSave({ address_state: v || null })} /></dd>
          <dt>Website</dt>
          <dd><InlineInput value={lead.url ?? ''} onSave={(v) => onSave({ url: v || null })} /></dd>
          <dt>Quelle</dt>
          <dd><InlineInput value={lead.source ?? ''} onSave={(v) => onSave({ source: v || null })} /></dd>
          {fields.map((f) => (
            <CustomFieldRow key={f.key} lead={lead} field={f} onSave={onSave} />
          ))}
          <dt>Anrufe</dt>
          <dd className="num">{lead.call_count}{lead.last_call_at ? `, zuletzt ${formatDateTime(lead.last_call_at)}` : ''}</dd>
        </dl>
        <div className="field mt-16">
          <label htmlFor="lead-desc">Beschreibung</label>
          <DescriptionBox value={lead.description ?? ''} onSave={(v) => onSave({ description: v || null })} />
        </div>
        {links.length ? (
          <div className="row wrap gap-4 mt-12">
            {links.map((l) => (
              <a key={l.id} className="btn small ghost" href={l.href} target="_blank" rel="noopener">
                <ExternalLink size={14} /> {l.name}
              </a>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function DescriptionBox({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return <textarea id="lead-desc" className="textarea" value={v} onChange={(e) => setV(e.target.value)} onBlur={() => v !== value && onSave(v)} placeholder="Was sollte jeder über diesen Lead wissen?" />;
}

function Composer({ lead, onEmail, onSms, onForm }: { lead: Lead; onEmail: () => void; onSms: () => void; onForm: (t: ActivityType) => void }) {
  const { store, ref, can } = useApp();
  const { toast } = useUi();
  const [tab, setTab] = useState<'note' | 'call'>('note');
  const [note, setNote] = useState('');
  const [outcome, setOutcome] = useState(ref.outcomes.find((o) => o.active)?.key ?? '');
  const [minutes, setMinutes] = useState('2');
  const [direction, setDirection] = useState<'outbound' | 'inbound'>('outbound');
  const [busy, setBusy] = useState(false);
  const types = ref.activityTypes.filter((t) => !t.archived);

  const saveNote = async () => {
    if (!note.trim()) return;
    setBusy(true);
    try {
      await store.addNote(lead.id, note.trim(), null, mentionsIn(note, ref.profiles));
      setNote('');
      bus.emit('timeline', lead.id);
    } catch (e) {
      toast(errMsg(e), { kind: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const logCall = async () => {
    setBusy(true);
    try {
      await store.logManualCall({
        lead_id: lead.id,
        contact_id: lead.contacts?.[0]?.id ?? null,
        direction,
        outcome: outcome || null,
        note: note.trim() || null,
        duration: Math.round((Number(minutes.replace(',', '.')) || 0) * 60),
      });
      setNote('');
      bus.emit('timeline', lead.id);
      bus.emit('lead', lead.id);
      toast('Anruf protokolliert.');
    } catch (e) {
      toast(errMsg(e), { kind: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const tabs: { value: 'note' | 'call'; label: ReactNode; icon?: ReactNode }[] = [{ value: 'note', label: 'Notiz', icon: <StickyNote /> }];
  if (can('calling')) tabs.push({ value: 'call', label: 'Anruf protokollieren', icon: <Phone /> });

  return (
    <div className="composer">
      <div className="row composer-tabs">
        <Tabs value={tab} onChange={setTab} tabs={tabs} />
        <span className="grow" />
        <div className="row gap-4 composer-quick">
          <button type="button" className="btn small ghost" onClick={onEmail} title="E-Mail schreiben (E)"><Mail size={15} /> <span className="hide-mobile">E-Mail</span></button>
          {can('calling') ? <button type="button" className="btn small ghost" onClick={onSms} title="SMS schreiben"><MessageCircle size={15} /> <span className="hide-mobile">SMS</span></button> : null}
          {types.length === 1 ? (
            <button type="button" className="btn small ghost" onClick={() => onForm(types[0])} title={types[0].name}>
              <ClipboardList size={15} /> <span className="hide-mobile">Formular</span>
            </button>
          ) : null}
        </div>
      </div>
      <div className="composer-body col">
        <MentionInput
          id="composer-note"
          className="composer-input"
          value={note}
          onChange={setNote}
          profiles={ref.profiles}
          placeholder={tab === 'note' ? 'Notiz schreiben … (N) – mit @Name erwähnst du Kollegen' : 'Was wurde besprochen? (z. B. Anruf vom Handy)'}
          onSubmit={tab === 'note' ? saveNote : logCall}
          ariaLabel={tab === 'note' ? 'Notiz' : 'Gesprächsnotiz'}
        />
        {tab === 'call' ? (
          <div className="row wrap">
            <select className="select" style={{ width: 'auto' }} value={direction} onChange={(e) => setDirection(e.target.value as 'outbound' | 'inbound')} aria-label="Richtung">
              <option value="outbound">Ausgehend</option>
              <option value="inbound">Eingehend</option>
            </select>
            <select className="select" style={{ width: 'auto' }} value={outcome} onChange={(e) => setOutcome(e.target.value)} aria-label="Ergebnis">
              {ref.outcomes.filter((o) => o.active).map((o) => (
                <option key={o.key} value={o.key}>{o.label}</option>
              ))}
            </select>
            <input className="input" style={{ width: 90 }} inputMode="decimal" value={minutes} onChange={(e) => setMinutes(e.target.value)} aria-label="Dauer in Minuten" />
            <span className="small muted">Min.</span>
          </div>
        ) : null}
        <div className="row">
          <span className="xs muted hide-touch">Strg + Enter speichert</span>
          <span className="spacer" />
          <button type="button" className="btn primary" onClick={tab === 'note' ? saveNote : logCall} disabled={busy || (tab === 'note' && !note.trim())}>
            {tab === 'note' ? 'Notiz speichern' : 'Anruf speichern'}
          </button>
        </div>
      </div>
    </div>
  );
}

function TasksPanel({ leadId, onAdd, onEdit }: { leadId: string; onAdd: () => void; onEdit: (t: Task) => void }) {
  const { store } = useApp();
  const { toast } = useUi();
  const { name } = useLookups();
  const tasks = useAsync(() => store.listTasks({ leadId, done: false, assignedTo: 'all' }), [leadId, store], ['tasks']);
  const toggle = async (t: Task) => {
    try {
      await store.setTaskDone(t.id, true);
      bus.emit('tasks');
      bus.emit('timeline', leadId);
    } catch (e) {
      toast(errMsg(e), { kind: 'error' });
    }
  };
  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Aufgaben</h2>
        <button type="button" className="icon-btn small" onClick={onAdd} aria-label="Aufgabe hinzufügen" title="Aufgabe hinzufügen">
          <Plus />
        </button>
      </div>
      <div className="list">
        {(tasks.data ?? []).map((t) => (
          <div className="list-item" key={t.id}>
            <button type="button" className="icon-btn small" onClick={() => toggle(t)} aria-label="Erledigt" title="Erledigt">
              <Circle />
            </button>
            <button type="button" className="grow plain-button" onClick={() => onEdit(t)}>
              <div className="strong">{t.title}</div>
              <span className="row gap-4 wrap">
                <DueTag due={t.due_at} />
                <span className="xs muted">{t.assigned_to ? name(t.assigned_to) : 'Team'}</span>
              </span>
            </button>
          </div>
        ))}
        {tasks.data && !tasks.data.length ? <div className="panel-body muted small">Keine offenen Aufgaben.</div> : null}
      </div>
    </div>
  );
}

function MeetingsPanel({ leadId, onBook }: { leadId: string; onBook: () => void }) {
  const { store } = useApp();
  const { name } = useLookups();
  const meetings = useAsync(
    () => store.listMeetings({ from: addDays(startOfDay(), -365), to: addDays(startOfDay(), 365), leadId, includeCanceled: true }),
    [leadId, store],
    ['meetings'],
  );
  const rows = [...(meetings.data ?? [])].sort((a, b) => (a.starts_at < b.starts_at ? 1 : -1));
  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Termine</h2>
        <button type="button" className="icon-btn small" onClick={onBook} aria-label="Termin buchen" title="Termin buchen">
          <CalendarPlus />
        </button>
      </div>
      <div className="list">
        {rows.map((m) => (
          <div className="list-item col-item" key={m.id}>
            <div className="row" style={{ width: '100%' }}>
              <strong className="grow">{formatDay(m.starts_at)}, {formatTime(m.starts_at)}</strong>
              {m.status !== 'scheduled' ? (
                <Tag tone={m.status === 'completed' ? 'green' : 'red'}>
                  {{ canceled: 'abgesagt', rescheduled: 'verschoben', completed: 'stattgefunden', no_show: 'nicht erschienen', scheduled: '' }[m.status]}
                </Tag>
              ) : (
                <Tag tone="blue">geplant</Tag>
              )}
            </div>
            <span className="small">{m.title}</span>
            <span className="xs muted">
              {[m.host_user_id ? `mit ${name(m.host_user_id)}` : m.host_name ? `mit ${m.host_name}` : null, m.set_by ? `gelegt von ${name(m.set_by)}` : null].filter(Boolean).join(', ')}
            </span>
            {new Date(m.starts_at).getTime() < Date.now() ? <MeetingActions meeting={m} /> : null}
          </div>
        ))}
        {meetings.data && !rows.length ? <div className="panel-body muted small">Noch kein Termin.</div> : null}
      </div>
    </div>
  );
}

function OppsPanel({ leadId, onAdd, onEdit }: { leadId: string; onAdd: () => void; onEdit: (o: Opportunity) => void }) {
  const { store, ref } = useApp();
  const { oppStatusById } = useLookups();
  const opps = useAsync(() => store.listOpportunities({ leadId }), [leadId, store], ['opportunities']);
  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Opportunities</h2>
        <button type="button" className="icon-btn small" onClick={onAdd} aria-label="Opportunity hinzufügen" title="Opportunity hinzufügen">
          <Plus />
        </button>
      </div>
      <div className="list">
        {(opps.data ?? []).map((o) => {
          const st = o.status_id ? oppStatusById.get(o.status_id) : undefined;
          const pipe = ref.pipelines.find((p) => p.id === st?.pipeline_id);
          return (
            <button key={o.id} type="button" className="list-item clickable plain-button full-row" onClick={() => onEdit(o)}>
              {st?.kind === 'won' ? <CheckCircle2 size={16} color="var(--cross)" /> : <TrendingUp size={16} />}
              <span className="grow">
                <strong className="num">{formatMoney(o.value)}</strong>
                <span className="muted small"> {o.value_period === 'monthly' ? 'mtl.' : o.value_period === 'annual' ? 'jährl.' : 'einmalig'}</span>
                <div className="xs muted">{[ref.pipelines.length > 1 ? pipe?.name : null, `${o.confidence} %`, o.expected_close ? `bis ${formatDate(o.expected_close)}` : null].filter(Boolean).join(', ')}</div>
              </span>
              {st ? <Tag color={st.color}>{st.label}</Tag> : null}
            </button>
          );
        })}
        {opps.data && !opps.data.length ? <div className="panel-body muted small">Keine Opportunity.</div> : null}
      </div>
    </div>
  );
}

function WorkflowsPanel({ leadId, onAdd }: { leadId: string; onAdd: () => void }) {
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
    <div className="panel">
      <div className="panel-head">
        <h2>Workflows</h2>
        <button type="button" className="icon-btn small" onClick={onAdd} aria-label="In Workflow aufnehmen" title="In Workflow aufnehmen">
          <Plus />
        </button>
      </div>
      <div className="list">
        {list.map((r) => {
          const wf = ref.workflows.find((w) => w.id === r.workflow_id);
          const st = RUN_STATUS[r.status];
          const running = r.status === 'active' || r.status === 'paused';
          return (
            <div key={r.id} className="list-item">
              <WorkflowIcon size={16} />
              <span className="grow" style={{ minWidth: 0 }}>
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
        {!list.length ? <div className="panel-body muted small">In keinem Workflow.</div> : null}
      </div>
    </div>
  );
}
