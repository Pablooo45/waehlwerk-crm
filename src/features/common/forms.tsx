// Formulare: Lead, Kontakt, Aufgabe, Opportunity, E-Mail, SMS, eigene Formulare (Close: Custom Activities).

import { Clock, Mail, MessageCircle, Paperclip, Plus, Search, Send, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../../app/context.tsx';
import { navigate, leadHref } from '../../app/router.ts';
import { bus } from '../../lib/bus.ts';
import { addDays, fromLocalInput, nextWorkday, toLocalInput } from '../../lib/dates.ts';
import { fillTemplate, formatPhone, normalizePhone } from '../../lib/format.ts';
import { config } from '../../lib/config.ts';
import type {
  ActivityType,
  Contact,
  CustomActivity,
  EmailEntry,
  Lead,
  Opportunity,
  PhoneEntry,
  PhoneType,
  Task,
} from '../../lib/types.ts';
import { templateVars } from '../../../supabase/functions/_shared/template.ts';
import { htmlToText, RichTextEditor, textToHtml } from '../../ui/RichText.tsx';
import { cx, errMsg, Field, Modal, useDebounced, useUi } from '../../ui/ui.tsx';
import { StatusSelect, UserSelect } from './bits.tsx';
import { FieldInput, isEmptyValue, shapeOf } from './fields.tsx';

const PHONE_TYPES: { value: PhoneType; label: string }[] = [
  { value: 'office', label: 'Büro' },
  { value: 'direct', label: 'Durchwahl' },
  { value: 'mobile', label: 'Mobil' },
  { value: 'fax', label: 'Fax' },
  { value: 'other', label: 'Sonstige' },
];

export function phoneTypeLabel(t: string): string {
  return PHONE_TYPES.find((p) => p.value === t)?.label ?? t;
}

export { templateVars };

// ---------- Neuer Lead ----------
export function LeadFormModal({ onClose, initial }: { onClose: () => void; initial?: { phone?: string; name?: string } }) {
  const { store, ref, me, can } = useApp();
  const { toast } = useUi();
  const [name, setName] = useState(initial?.name ?? '');
  const [contact, setContact] = useState('');
  const [title, setTitle] = useState('Inhaber/in');
  const [phone, setPhone] = useState(initial?.phone ?? '');
  const [email, setEmail] = useState('');
  const [street, setStreet] = useState('');
  const [zip, setZip] = useState('');
  const [city, setCity] = useState('');
  const [url, setUrl] = useState('');
  const [statusId, setStatusId] = useState<string | null>(ref.statuses.find((s) => s.is_default)?.id ?? null);
  const [owner, setOwner] = useState<string | null>(me.id);
  const [custom, setCustom] = useState<Record<string, unknown>>({});
  const [busy, setBusy] = useState(false);
  const [dupe, setDupe] = useState<Lead | null>(null);
  const leadFields = ref.customFields.filter((f) => f.entity === 'lead' && (!f.restricted || can('edit_restricted_fields')));
  const ownerLocked = ref.visibility !== 'all';

  const debouncedPhone = useDebounced(phone, 400);
  useEffect(() => {
    if (!normalizePhone(debouncedPhone)) {
      setDupe(null);
      return;
    }
    store.findLeadByPhone(debouncedPhone).then((r) => setDupe(r?.lead ?? null)).catch(() => setDupe(null));
  }, [debouncedPhone, store]);

  const save = async () => {
    if (!name.trim()) {
      toast('Bitte einen Firmennamen eingeben.', { kind: 'error' });
      return;
    }
    if (phone && !normalizePhone(phone)) {
      toast('Die Telefonnummer sieht ungültig aus.', { kind: 'error' });
      return;
    }
    setBusy(true);
    try {
      const clean = Object.fromEntries(Object.entries(custom).filter(([, v]) => !isEmptyValue(v)));
      const lead = await store.createLead(
        {
          name: name.trim(),
          status_id: statusId,
          owner_id: ownerLocked ? me.id : owner,
          address_street: street || null,
          address_zip: zip || null,
          address_city: city || null,
          url: url || null,
          source: 'Manuell',
          custom: clean,
        },
        contact || phone || email
          ? [
            {
              name: contact,
              title: title || null,
              phones: phone ? [{ type: 'office', number: normalizePhone(phone) ?? phone }] : [],
              emails: email ? [{ type: 'office', email }] : [],
            },
          ]
          : [],
      );
      bus.emit('leads');
      toast('Lead angelegt.');
      onClose();
      navigate(leadHref(lead.id));
    } catch (e) {
      toast(errMsg(e), { kind: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Neuer Lead"
      onClose={onClose}
      wide
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Abbrechen</button>
          <button type="button" className="btn primary" onClick={save} disabled={busy}>Lead anlegen</button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Firma / Apotheke" className="full">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="z. B. Löwen-Apotheke" />
        </Field>
        <Field label="Ansprechpartner">
          <input className="input" value={contact} onChange={(e) => setContact(e.target.value)} placeholder="Vor- und Nachname" />
        </Field>
        <Field label="Position">
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field
          label="Telefon"
          hint={dupe ? (
            <span style={{ color: 'var(--signal)' }}>
              Diese Nummer gehört schon zu „{dupe.name}“. <a href={leadHref(dupe.id)} onClick={onClose}>Öffnen</a>
            </span>
          ) : undefined}
        >
          <input className="input" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="069 123456" />
        </Field>
        <Field label="E-Mail">
          <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Straße">
          <input className="input" value={street} onChange={(e) => setStreet(e.target.value)} />
        </Field>
        <div className="row gap-12">
          <Field label="PLZ" className="grow">
            <input className="input" inputMode="numeric" value={zip} onChange={(e) => setZip(e.target.value)} />
          </Field>
          <Field label="Ort" className="grow">
            <input className="input" value={city} onChange={(e) => setCity(e.target.value)} />
          </Field>
        </div>
        <Field label="Website">
          <input className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="www.…" />
        </Field>
        <Field label="Status">
          <StatusSelect value={statusId} onChange={setStatusId} statuses={ref.statuses} />
        </Field>
        <Field label="Zuständig" hint={ownerLocked ? 'Deine Rolle sieht nur eigene Leads – du wirst zuständig.' : undefined}>
          {ownerLocked ? <input className="input" value={me.full_name} readOnly /> : <UserSelect value={owner} onChange={setOwner} />}
        </Field>
        {leadFields.length ? (
          <details className="full">
            <summary className="small">Weitere Felder ({leadFields.length})</summary>
            <div className="form-grid mt-8">
              {leadFields.map((f) => (
                <Field key={f.key} label={f.label} hint={f.description || undefined}>
                  <FieldInput field={shapeOf(f)} value={custom[f.key]} onChange={(v) => setCustom({ ...custom, [f.key]: v })} />
                </Field>
              ))}
            </div>
          </details>
        ) : null}
      </div>
    </Modal>
  );
}

// ---------- Kontakt ----------
export function ContactFormModal({ leadId, contact, onClose }: { leadId: string; contact?: Contact; onClose: () => void }) {
  const { store, ref, can } = useApp();
  const { toast, confirm } = useUi();
  const [name, setName] = useState(contact?.name ?? '');
  const [title, setTitle] = useState(contact?.title ?? '');
  const [phones, setPhones] = useState<PhoneEntry[]>(contact?.phones.length ? contact.phones.map((p) => ({ ...p, number: formatPhone(p.number) })) : [{ type: 'office', number: '' }]);
  const [emails, setEmails] = useState<EmailEntry[]>(contact?.emails.length ? contact.emails : [{ type: 'office', email: '' }]);
  const [custom, setCustom] = useState<Record<string, unknown>>(contact?.custom ?? {});
  const [busy, setBusy] = useState(false);
  const fields = ref.customFields.filter((f) => f.entity === 'contact');

  const save = async () => {
    const bad = phones.find((p) => p.number.trim() && !normalizePhone(p.number));
    if (bad) {
      toast(`Nummer „${bad.number}“ ist ungültig.`, { kind: 'error' });
      return;
    }
    setBusy(true);
    try {
      await store.saveContact({
        id: contact?.id,
        lead_id: leadId,
        name,
        title: title || null,
        sort: contact?.sort ?? 0,
        phones: phones.filter((p) => p.number.trim()).map((p) => ({ ...p, number: normalizePhone(p.number)! })),
        emails: emails.filter((e) => e.email.trim()).map((e) => ({ ...e, email: e.email.trim().toLowerCase() })),
        custom,
      });
      bus.emit('lead', leadId);
      onClose();
    } catch (e) {
      toast(errMsg(e), { kind: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!contact) return;
    if (!(await confirm(`Kontakt „${contact.name || 'ohne Namen'}“ löschen?`, { danger: true, confirmLabel: 'Löschen' }))) return;
    try {
      await store.deleteContact(contact.id);
      bus.emit('lead', leadId);
      onClose();
    } catch (e) {
      toast(errMsg(e), { kind: 'error' });
    }
  };

  return (
    <Modal
      title={contact ? 'Kontakt bearbeiten' : 'Kontakt hinzufügen'}
      onClose={onClose}
      footer={
        <>
          {contact ? (
            <button type="button" className="btn ghost danger-text" onClick={remove} style={{ marginRight: 'auto' }}>
              <Trash2 /> Löschen
            </button>
          ) : null}
          <button type="button" className="btn" onClick={onClose}>Abbrechen</button>
          <button type="button" className="btn primary" onClick={save} disabled={busy}>Speichern</button>
        </>
      }
    >
      <div className="col gap-12">
        <div className="form-grid">
          <Field label="Name">
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Position">
            <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
        </div>
        <div className="label">Telefonnummern</div>
        {phones.map((p, i) => (
          <div className="row" key={i}>
            <select
              className="select"
              style={{ width: 130 }}
              value={p.type}
              aria-label="Art der Nummer"
              onChange={(e) => setPhones(phones.map((x, j) => (j === i ? { ...x, type: e.target.value as PhoneType } : x)))}
            >
              {PHONE_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
            <input
              className="input grow"
              type="tel"
              value={p.number}
              placeholder="069 123456"
              aria-label="Telefonnummer"
              onChange={(e) => setPhones(phones.map((x, j) => (j === i ? { ...x, number: e.target.value } : x)))}
              onBlur={() => {
                const n = normalizePhone(p.number);
                if (n) setPhones(phones.map((x, j) => (j === i ? { ...x, number: formatPhone(n) } : x)));
              }}
            />
            <button type="button" className="icon-btn" aria-label="Nummer entfernen" onClick={() => setPhones(phones.filter((_, j) => j !== i))}>
              <Trash2 />
            </button>
          </div>
        ))}
        <button type="button" className="btn ghost small" style={{ alignSelf: 'flex-start' }} onClick={() => setPhones([...phones, { type: 'mobile', number: '' }])}>
          <Plus /> Nummer
        </button>
        <div className="label">E-Mail-Adressen</div>
        {emails.map((em, i) => (
          <div className="row" key={i}>
            <input
              className="input grow"
              type="email"
              value={em.email}
              aria-label="E-Mail-Adresse"
              onChange={(e) => setEmails(emails.map((x, j) => (j === i ? { ...x, email: e.target.value } : x)))}
            />
            <button type="button" className="icon-btn" aria-label="E-Mail entfernen" onClick={() => setEmails(emails.filter((_, j) => j !== i))}>
              <Trash2 />
            </button>
          </div>
        ))}
        <button type="button" className="btn ghost small" style={{ alignSelf: 'flex-start' }} onClick={() => setEmails([...emails, { type: 'office', email: '' }])}>
          <Plus /> E-Mail
        </button>
        {fields.length ? (
          <div className="form-grid">
            {fields.map((f) => (
              <Field key={f.key} label={f.label} hint={f.description || undefined} className={f.type === 'multichoice' || f.type === 'textarea' ? 'full' : undefined}>
                <FieldInput field={shapeOf(f)} value={custom[f.key]} onChange={(v) => setCustom({ ...custom, [f.key]: v })} disabled={f.restricted && !can('edit_restricted_fields')} />
              </Field>
            ))}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

// ---------- Aufgabe ----------
export function TaskFormModal({ task, leadId, onClose }: { task?: Task; leadId?: string | null; onClose: () => void }) {
  const { store, me, can } = useApp();
  const { toast } = useUi();
  const [title, setTitle] = useState(task?.title ?? 'Rückruf');
  const [due, setDue] = useState(toLocalInput(task ? task.due_at : nextWorkday(1, 10)));
  const [assignee, setAssignee] = useState<string | null>(task ? task.assigned_to : me.id);
  const [type, setType] = useState<Task['type']>(task?.type ?? 'call');
  const [note, setNote] = useState(task?.note ?? '');
  const [lead, setLead] = useState<{ id: string; name: string } | null>(task?.lead ?? null);
  const [busy, setBusy] = useState(false);
  const fixedLead = task?.lead_id ?? leadId ?? null;

  const quick = (d: Date) => setDue(toLocalInput(d));

  const save = async () => {
    if (!title.trim()) return;
    setBusy(true);
    try {
      const target = fixedLead ?? lead?.id ?? null;
      await store.saveTask({
        id: task?.id,
        title: title.trim(),
        due_at: fromLocalInput(due),
        assigned_to: assignee,
        type,
        note: note.trim() || null,
        lead_id: target,
      });
      bus.emit('tasks');
      if (target) {
        bus.emit('lead', target);
        bus.emit('timeline', target);
      }
      onClose();
    } catch (e) {
      toast(errMsg(e), { kind: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={task ? 'Aufgabe bearbeiten' : 'Neue Aufgabe'}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Abbrechen</button>
          <button type="button" className="btn primary" onClick={save} disabled={busy || !title.trim()}>Speichern</button>
        </>
      }
    >
      <div className="col gap-12">
        <Field label="Was ist zu tun?">
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} />
        </Field>
        {!fixedLead ? (
          <Field label="Lead (optional)">
            {lead ? (
              <div className="row">
                <span className="grow strong">{lead.name}</span>
                <button type="button" className="btn small ghost" onClick={() => setLead(null)}>Ändern</button>
              </div>
            ) : (
              <LeadPicker onPick={(l) => setLead({ id: l.id, name: l.name })} />
            )}
          </Field>
        ) : null}
        <Field label="Fällig">
          <input className="input" type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} />
        </Field>
        <div className="row wrap">
          <button type="button" className="btn small" onClick={() => quick(new Date(Date.now() + 2 * 3600_000))}>In 2 Std.</button>
          <button type="button" className="btn small" onClick={() => quick(nextWorkday(1, 10))}>Morgen 10 Uhr</button>
          <button type="button" className="btn small" onClick={() => quick(nextWorkday(2, 10))}>Übermorgen</button>
          <button type="button" className="btn small" onClick={() => quick(nextWorkday(7, 10))}>Nächste Woche</button>
          <button type="button" className="btn small" onClick={() => setDue('')}>Ohne Datum</button>
        </div>
        <div className="form-grid">
          <Field label="Für">
            {can('manage_others_tasks') || !task || task.assigned_to === me.id ? (
              <UserSelect value={assignee} onChange={setAssignee} emptyLabel="Team (frei)" />
            ) : (
              <input className="input" readOnly value="(nicht änderbar)" />
            )}
          </Field>
          <Field label="Art">
            <select className="select" value={type} onChange={(e) => setType(e.target.value as Task['type'])}>
              <option value="call">Anrufen</option>
              <option value="email">E-Mail</option>
              <option value="todo">Sonstiges</option>
              <option value="meeting_followup">Termin nachfassen</option>
              {type === 'missed_call' || type === 'voicemail' || type === 'workflow' ? <option value={type}>{type === 'workflow' ? 'Workflow' : type === 'voicemail' ? 'Mailbox' : 'Verpasster Anruf'}</option> : null}
            </select>
          </Field>
        </div>
        <Field label="Notiz (optional)">
          <textarea className="textarea" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

// ---------- Opportunity ----------
export function OpportunityModal({ opp, leadId, pipelineId, onClose }: { opp?: Opportunity; leadId?: string | null; pipelineId?: string | null; onClose: () => void }) {
  const { store, ref, me, can } = useApp();
  const { toast, confirm } = useUi();
  const initialPipe = ref.oppStatuses.find((s) => s.id === opp?.status_id)?.pipeline_id ?? pipelineId ?? ref.pipelines[0]?.id ?? null;
  const [pipe, setPipe] = useState<string | null>(initialPipe);
  const statuses = ref.oppStatuses.filter((s) => s.pipeline_id === pipe).sort((a, b) => a.sort - b.sort);
  const [statusId, setStatusId] = useState<string | null>(opp?.status_id ?? statuses[0]?.id ?? null);
  const [value, setValue] = useState(opp ? String(opp.value).replace('.', ',') : '');
  const [period, setPeriod] = useState<Opportunity['value_period']>(opp?.value_period ?? 'monthly');
  const [confidence, setConfidence] = useState(opp?.confidence ?? 50);
  const [close, setClose] = useState(opp?.expected_close ?? addDays(new Date(), 14).toISOString().slice(0, 10));
  const [owner, setOwner] = useState<string | null>(opp?.user_id ?? me.id);
  const [note, setNote] = useState(opp?.note ?? '');
  const [custom, setCustom] = useState<Record<string, unknown>>(opp?.custom ?? {});
  const [lead, setLead] = useState<Lead | null>(null);
  const [contactId, setContactId] = useState<string | null>(opp?.contact_id ?? null);
  const [busy, setBusy] = useState(false);
  const targetLead = opp?.lead_id ?? leadId ?? lead?.id ?? null;
  const fields = ref.customFields.filter((f) => f.entity === 'opportunity');
  const editable = !opp || opp.user_id === me.id || can('manage_others_opportunities');
  const canDelete = !!opp && (can('manage_others_opportunities') || (opp.user_id === me.id && can('delete_own_opportunities')));

  // Kontakte des Leads für die Auswahl
  const [contacts, setContacts] = useState<Contact[]>([]);
  useEffect(() => {
    if (!targetLead) {
      setContacts([]);
      return;
    }
    store.getLead(targetLead).then((l) => setContacts(l?.contacts ?? [])).catch(() => setContacts([]));
  }, [store, targetLead]);

  const changePipe = (id: string) => {
    setPipe(id);
    const first = ref.oppStatuses.filter((s) => s.pipeline_id === id).sort((a, b) => a.sort - b.sort)[0];
    setStatusId(first?.id ?? null);
  };

  const save = async () => {
    if (!targetLead) {
      toast('Bitte einen Lead auswählen.', { kind: 'error' });
      return;
    }
    setBusy(true);
    try {
      await store.saveOpportunity({
        id: opp?.id,
        lead_id: targetLead,
        contact_id: contactId,
        status_id: statusId,
        value: Number(value.replace(/\./g, '').replace(',', '.')) || 0,
        value_period: period,
        confidence,
        expected_close: close || null,
        user_id: owner,
        note: note || null,
        custom,
      });
      bus.emit('opportunities');
      bus.emit('lead', targetLead);
      bus.emit('timeline', targetLead);
      onClose();
    } catch (e) {
      toast(errMsg(e), { kind: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!opp || !(await confirm('Diese Opportunity löschen?', { danger: true, confirmLabel: 'Löschen' }))) return;
    try {
      await store.deleteOpportunity(opp.id);
      bus.emit('opportunities');
      bus.emit('lead', opp.lead_id);
      onClose();
    } catch (e) {
      toast(errMsg(e), { kind: 'error' });
    }
  };

  const st = statuses.find((s) => s.id === statusId);

  return (
    <Modal
      title={opp ? `Opportunity${opp.lead ? `: ${opp.lead.name}` : ''}` : 'Neue Opportunity'}
      onClose={onClose}
      wide
      footer={
        <>
          {canDelete ? (
            <button type="button" className="btn ghost danger-text" style={{ marginRight: 'auto' }} onClick={remove}>
              <Trash2 /> Löschen
            </button>
          ) : null}
          {opp ? <a className="btn ghost" href={leadHref(opp.lead_id)} onClick={onClose}>Zum Lead</a> : null}
          <button type="button" className="btn" onClick={onClose}>Abbrechen</button>
          <button type="button" className="btn primary" onClick={save} disabled={busy || !editable}>Speichern</button>
        </>
      }
    >
      <fieldset className="plain-fieldset" disabled={!editable}>
        {!editable ? <p className="small muted">Nur ansehen – fremde Opportunities ändern darf, wer das Recht dazu hat.</p> : null}
        <div className="form-grid">
          {!opp && !leadId ? (
            <Field label="Lead" className="full">
              {lead ? (
                <div className="row">
                  <span className="grow strong">{lead.name}</span>
                  <button type="button" className="btn small ghost" onClick={() => setLead(null)}>Ändern</button>
                </div>
              ) : (
                <LeadPicker onPick={setLead} autoFocus />
              )}
            </Field>
          ) : null}
          {ref.pipelines.length > 1 ? (
            <Field label="Pipeline">
              <select className="select" value={pipe ?? ''} onChange={(e) => changePipe(e.target.value)}>
                {ref.pipelines.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </Field>
          ) : null}
          <Field label="Phase">
            <select className="select" value={statusId ?? ''} onChange={(e) => setStatusId(e.target.value || null)} style={st ? { boxShadow: `inset 4px 0 0 ${st.color}` } : undefined}>
              {statuses.map((s) => (
                <option key={s.id} value={s.id}>{s.label}{s.kind === 'won' ? ' (gewonnen)' : s.kind === 'lost' ? ' (verloren)' : ''}</option>
              ))}
            </select>
          </Field>
          <Field label="Zuständig">
            {can('manage_others_opportunities') ? <UserSelect value={owner} onChange={setOwner} /> : <input className="input" readOnly value={ref.profiles.find((p) => p.id === owner)?.full_name ?? ''} />}
          </Field>
          <Field label="Kontakt">
            <select className="select" value={contactId ?? ''} onChange={(e) => setContactId(e.target.value || null)}>
              <option value="">– keiner –</option>
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>{c.name || 'Ohne Namen'}</option>
              ))}
            </select>
          </Field>
          <Field label={`Wert (${ref.org.currency === 'EUR' || !ref.org.currency ? '€' : ref.org.currency})`}>
            <input className="input" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} placeholder="490" />
          </Field>
          <Field label="Abrechnung">
            <select className="select" value={period} onChange={(e) => setPeriod(e.target.value as Opportunity['value_period'])}>
              <option value="monthly">monatlich</option>
              <option value="annual">jährlich</option>
              <option value="one_time">einmalig</option>
            </select>
          </Field>
          <Field label={`Wahrscheinlichkeit: ${confidence} %`}>
            <input type="range" min={0} max={100} step={5} value={confidence} onChange={(e) => setConfidence(Number(e.target.value))} />
          </Field>
          <Field label="Abschluss erwartet">
            <input className="input" type="date" value={close ?? ''} onChange={(e) => setClose(e.target.value)} />
          </Field>
          {fields.map((f) => (
            <Field key={f.key} label={f.label} hint={f.description || undefined} className={f.type === 'multichoice' || f.type === 'textarea' ? 'full' : undefined}>
              <FieldInput field={shapeOf(f)} value={custom[f.key]} onChange={(v) => setCustom({ ...custom, [f.key]: v })} disabled={f.restricted && !can('edit_restricted_fields')} />
            </Field>
          ))}
          <Field label="Notiz" className="full">
            <textarea className="textarea" value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
      </fieldset>
    </Modal>
  );
}

// ---------- E-Mail ----------
export function EmailModal({
  lead,
  contact,
  onClose,
  replyTo,
}: {
  lead: Lead;
  contact: Contact | null;
  onClose: () => void;
  replyTo?: { subject: string; to: string; body?: string } | null;
}) {
  const { store, ref, me, demo } = useApp();
  const { toast } = useUi();
  const contacts = lead.contacts ?? [];
  const firstWithMail = contact?.emails.length ? contact : contacts.find((c) => c.emails.length) ?? null;
  const account = ref.emailAccounts.find((a) => a.user_id === me.id) ?? null;
  const viaCrm = demo || !!account;
  const [to, setTo] = useState(replyTo?.to ?? firstWithMail?.emails[0]?.email ?? '');
  const [cc, setCc] = useState('');
  const [bcc, setBcc] = useState('');
  const [showCc, setShowCc] = useState(false);
  const [templateId, setTemplateId] = useState('');
  const [subject, setSubject] = useState(replyTo ? (replyTo.subject.startsWith('AW:') ? replyTo.subject : `AW: ${replyTo.subject}`) : '');
  const signature = account?.signature ? `<p>--<br>${account.signature.replace(/\n/g, '<br>')}</p>` : '';
  const [html, setHtml] = useState(signature ? `<p></p>${signature}` : '');
  const [sendAt, setSendAt] = useState('');
  const [later, setLater] = useState(false);
  const [files, setFiles] = useState<{ name: string; size: number; path: string }[]>([]);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const recipient = contacts.find((c) => c.emails.some((e) => e.email === to.trim().toLowerCase())) ?? firstWithMail;
  const vars = useMemo(() => templateVars(lead, recipient, me, ref.org.name), [lead, recipient, me, ref.org.name]);
  const templates = ref.templates.filter((t) => t.kind === 'email');

  const applyTemplate = (id: string) => {
    setTemplateId(id);
    const t = templates.find((x) => x.id === id);
    if (!t) return;
    setSubject(fillTemplate(t.subject, vars));
    const body = t.is_html ? fillTemplate(t.body, vars) : textToHtml(fillTemplate(t.body, vars));
    setHtml(`${body}${signature}`);
  };

  const attach = async (list: FileList | null) => {
    if (!list?.length) return;
    setUploading(true);
    try {
      for (const f of Array.from(list)) {
        const up = await store.uploadAttachment(f);
        setFiles((prev) => [...prev, up]);
      }
    } catch (e) {
      toast(errMsg(e), { kind: 'error' });
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const send = async () => {
    const addr = to.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(addr)) {
      toast('Bitte eine gültige E-Mail-Adresse eingeben.', { kind: 'error' });
      return;
    }
    if (!subject.trim()) {
      toast('Bitte einen Betreff eingeben.', { kind: 'error' });
      return;
    }
    setBusy(true);
    try {
      if (viaCrm) {
        const e = await store.sendEmail({
          lead_id: lead.id,
          contact_id: recipient?.id ?? null,
          to: addr,
          cc: cc.trim() || null,
          bcc: bcc.trim() || null,
          subject: subject.trim(),
          body: html,
          is_html: true,
          template_id: templateId || null,
          send_at: later && sendAt ? fromLocalInput(sendAt) : null,
          account_id: account?.id ?? null,
          attachments: files,
        });
        toast(e.status === 'scheduled' ? 'E-Mail geplant.' : demo ? 'Demo: E-Mail im Verlauf gespeichert (nicht wirklich verschickt).' : 'E-Mail gesendet.');
      } else {
        const text = htmlToText(html);
        const href = `mailto:${encodeURIComponent(addr)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}${cc ? `&cc=${encodeURIComponent(cc)}` : ''}`;
        if (!config.demoBuild) window.location.href = href;
        await store.logEmail({ lead_id: lead.id, contact_id: recipient?.id ?? null, to_address: addr, subject, body: text });
        toast('Im Mailprogramm geöffnet und im Verlauf vermerkt.');
      }
      bus.emit('lead', lead.id);
      bus.emit('timeline', lead.id);
      onClose();
    } catch (e) {
      toast(errMsg(e), { kind: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={replyTo ? 'Antworten' : 'E-Mail schreiben'}
      onClose={onClose}
      wide
      footer={
        <>
          <span className="small muted" style={{ marginRight: 'auto' }}>
            {viaCrm ? (account ? `Von ${account.display_name || me.full_name} <${account.email}>` : 'Demo: wird nicht verschickt') : (
              <>Kein Postfach verbunden – öffnet dein Mailprogramm. <a href="#/settings/mailbox" onClick={onClose}>Postfach verbinden</a></>
            )}
          </span>
          <button type="button" className="btn" onClick={onClose}>Abbrechen</button>
          <button type="button" className="btn primary" onClick={send} disabled={busy || uploading}>
            {viaCrm ? <><Send /> {later && sendAt ? 'Planen' : 'Senden'}</> : <><Mail /> Im Mailprogramm öffnen</>}
          </button>
        </>
      }
    >
      <div className="col gap-12">
        <div className="form-grid">
          <Field label="An">
            <div className="row gap-4">
              <input className="input grow" type="email" value={to} onChange={(e) => setTo(e.target.value)} list="lead-mails" />
              {!showCc ? <button type="button" className="btn small ghost" onClick={() => setShowCc(true)}>Cc/Bcc</button> : null}
            </div>
            <datalist id="lead-mails">
              {contacts.flatMap((c) => c.emails.map((m) => <option key={m.email} value={m.email}>{c.name}</option>))}
            </datalist>
          </Field>
          <Field label="Vorlage">
            <select className="select" value={templateId} onChange={(e) => applyTemplate(e.target.value)}>
              <option value="">– ohne –</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </Field>
          {showCc ? (
            <>
              <Field label="Cc"><input className="input" value={cc} onChange={(e) => setCc(e.target.value)} placeholder="mehrere mit Komma" /></Field>
              <Field label="Bcc"><input className="input" value={bcc} onChange={(e) => setBcc(e.target.value)} /></Field>
            </>
          ) : null}
        </div>
        <Field label="Betreff">
          <input className="input" value={subject} onChange={(e) => setSubject(e.target.value)} />
        </Field>
        <RichTextEditor value={html} onChange={setHtml} ariaLabel="Text der E-Mail" placeholder="Hallo …" />
        {replyTo?.body ? (
          <details className="small">
            <summary>Ursprüngliche Nachricht</summary>
            <div className="quote pre-wrap">{replyTo.body}</div>
          </details>
        ) : null}
        {viaCrm ? (
          <div className="row wrap gap-8">
            <input ref={fileInput} type="file" multiple hidden onChange={(e) => attach(e.target.files)} />
            <button type="button" className="btn small" onClick={() => fileInput.current?.click()} disabled={uploading}>
              <Paperclip size={15} /> {uploading ? 'Lädt hoch…' : 'Anhang'}
            </button>
            {files.map((f) => (
              <span key={f.path} className="chip">
                <span className="ellipsis" style={{ maxWidth: 200 }}>{f.name}</span>
                <span className="xs muted">{Math.max(1, Math.round(f.size / 1024))} KB</span>
                <button type="button" aria-label={`${f.name} entfernen`} onClick={() => setFiles(files.filter((x) => x.path !== f.path))}><X size={14} /></button>
              </span>
            ))}
            <span className="grow" />
            <label className="check small">
              <input type="checkbox" checked={later} onChange={(e) => { setLater(e.target.checked); if (e.target.checked && !sendAt) setSendAt(toLocalInput(nextWorkday(1, 8))); }} />
              <Clock size={14} /> Später senden
            </label>
            {later ? <input className="input small" type="datetime-local" value={sendAt} onChange={(e) => setSendAt(e.target.value)} aria-label="Sendezeitpunkt" /> : null}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

// ---------- SMS ----------
// GSM-7 (normale Zeichen): 160 pro SMS, 153 bei mehreren. Sonst (Emojis …): 70 / 67.
export function smsSegments(text: string): { count: number; perSms: number; unicode: boolean } {
  const gsm = /^[\n\r @£$¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ!"#¤%&'()*+,\-./0-9:;<=>?¡A-ZÄÖÑÜ§¿a-zäöñüà^{}\\[~\]|€]*$/;
  const unicode = !gsm.test(text);
  const len = unicode ? [...text].length : text.length + (text.match(/[\^{}\\[~\]|€]/g)?.length ?? 0);
  const single = unicode ? 70 : 160;
  const multi = unicode ? 67 : 153;
  const count = len === 0 ? 0 : len <= single ? 1 : Math.ceil(len / multi);
  return { count, perSms: count > 1 ? multi : single, unicode };
}

export function SmsModal({ lead, contact, onClose }: { lead: Lead; contact: Contact | null; onClose: () => void }) {
  const { store, ref, me } = useApp();
  const { toast } = useUi();
  const contacts = lead.contacts ?? [];
  const numbers = contacts.flatMap((c) => c.phones.filter((p) => p.type !== 'fax').map((p) => ({ c, p })));
  const preferred = (contact ? numbers.filter((n) => n.c.id === contact.id) : numbers).sort((a, b) => Number(b.p.type === 'mobile') - Number(a.p.type === 'mobile'))[0] ?? numbers[0];
  const [to, setTo] = useState(preferred?.p.number ?? '');
  const senders = ref.phoneNumbers.filter((n) => n.sms_capable);
  const [from, setFrom] = useState(senders.find((n) => n.number === me.phone_number)?.number ?? senders[0]?.number ?? '');
  const [templateId, setTemplateId] = useState('');
  const [body, setBody] = useState('');
  const [later, setLater] = useState(false);
  const [sendAt, setSendAt] = useState(toLocalInput(nextWorkday(1, 9)));
  const [busy, setBusy] = useState(false);
  const templates = ref.templates.filter((t) => t.kind === 'sms');
  const target = numbers.find((n) => n.p.number === to);
  const seg = smsSegments(body);
  const landline = target && target.p.type !== 'mobile' && !/^\+491[5-7]/.test(target.p.number);

  const applyTemplate = (id: string) => {
    setTemplateId(id);
    const t = templates.find((x) => x.id === id);
    if (t) setBody(fillTemplate(t.body, templateVars(lead, target?.c ?? contact, me, ref.org.name)));
  };

  const send = async () => {
    if (!normalizePhone(to)) {
      toast('Bitte eine gültige Nummer wählen.', { kind: 'error' });
      return;
    }
    if (!body.trim()) return;
    setBusy(true);
    try {
      const s = await store.sendSms({ lead_id: lead.id, contact_id: target?.c.id ?? contact?.id ?? null, to, body: body.trim(), from: from || null, send_at: later ? fromLocalInput(sendAt) : null });
      toast(s.status === 'scheduled' ? 'SMS geplant.' : 'SMS gesendet.');
      bus.emit('timeline', lead.id);
      onClose();
    } catch (e) {
      toast(errMsg(e), { kind: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="SMS schreiben"
      onClose={onClose}
      footer={
        <>
          <span className={cx('small', seg.count > 2 ? 'warn-text' : 'muted')} style={{ marginRight: 'auto' }}>
            {body.length} Zeichen, {seg.count} SMS{seg.unicode ? ' (Sonderzeichen: 70 je SMS)' : ''}
          </span>
          <button type="button" className="btn" onClick={onClose}>Abbrechen</button>
          <button type="button" className="btn primary" onClick={send} disabled={busy || !body.trim() || !to}>
            <MessageCircle /> {later ? 'Planen' : 'Senden'}
          </button>
        </>
      }
    >
      <div className="col gap-12">
        {!senders.length ? <div className="callout warn"><span>Keine SMS-fähige Nummer eingerichtet. Ein Admin kann das unter Einstellungen → Telefonnummern freischalten.</span></div> : null}
        <div className="form-grid">
          <Field label="An" hint={landline ? 'Das sieht nach Festnetz aus – SMS kommen dort meist nicht an.' : undefined}>
            <select className="select" value={to} onChange={(e) => setTo(e.target.value)}>
              {!numbers.length ? <option value="">– keine Nummer –</option> : null}
              {numbers.map(({ c, p }) => (
                <option key={`${c.id}-${p.number}`} value={p.number}>
                  {formatPhone(p.number)} ({[c.name, phoneTypeLabel(p.type)].filter(Boolean).join(', ')})
                </option>
              ))}
            </select>
          </Field>
          <Field label="Von">
            <select className="select" value={from} onChange={(e) => setFrom(e.target.value)} disabled={!senders.length}>
              {senders.map((n) => (
                <option key={n.number} value={n.number}>{formatPhone(n.number)}{n.label ? ` – ${n.label}` : ''}</option>
              ))}
            </select>
          </Field>
        </div>
        {templates.length ? (
          <Field label="Vorlage">
            <select className="select" value={templateId} onChange={(e) => applyTemplate(e.target.value)}>
              <option value="">– ohne –</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </Field>
        ) : null}
        <Field label="Nachricht">
          <textarea className="textarea" rows={5} value={body} onChange={(e) => setBody(e.target.value)} autoFocus />
        </Field>
        <div className="row wrap gap-8">
          <label className="check small">
            <input type="checkbox" checked={later} onChange={(e) => setLater(e.target.checked)} />
            <Clock size={14} /> Später senden
          </label>
          {later ? <input className="input small" type="datetime-local" value={sendAt} onChange={(e) => setSendAt(e.target.value)} aria-label="Sendezeitpunkt" /> : null}
        </div>
      </div>
    </Modal>
  );
}

// ---------- Eigene Formulare (Close: Custom Activities) ----------
export function ActivityFormModal({
  lead,
  type: initialType,
  activity,
  callId,
  onClose,
}: {
  lead: Pick<Lead, 'id' | 'name' | 'contacts'>;
  type?: ActivityType | null;
  activity?: CustomActivity | null;
  callId?: string | null;
  onClose: () => void;
}) {
  const { store, ref, me, can } = useApp();
  const { toast, confirm } = useUi();
  const types = ref.activityTypes.filter((t) => !t.archived || t.id === activity?.type_id);
  const [typeId, setTypeId] = useState(activity?.type_id ?? initialType?.id ?? types[0]?.id ?? '');
  const type = types.find((t) => t.id === typeId) ?? null;
  const [data, setData] = useState<Record<string, unknown>>(activity?.data ?? {});
  const [contactId, setContactId] = useState<string | null>(activity?.contact_id ?? lead.contacts?.[0]?.id ?? null);
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);
  const editable = !activity || activity.user_id === me.id || can('manage_others_activities');
  const missing = (type?.fields ?? []).filter((f) => f.required && isEmptyValue(data[f.key]));

  const save = async (status: 'published' | 'draft') => {
    if (!type) return;
    setTried(true);
    if (status === 'published' && missing.length) {
      toast(`Bitte ausfüllen: ${missing.map((f) => f.label).join(', ')}`, { kind: 'error' });
      return;
    }
    setBusy(true);
    try {
      await store.saveActivity({ id: activity?.id, type_id: type.id, lead_id: lead.id, contact_id: contactId, call_id: activity?.call_id ?? callId ?? null, data, status });
      bus.emit('timeline', lead.id);
      bus.emit('lead', lead.id);
      bus.emit('tasks');
      toast(status === 'draft' ? 'Als Entwurf gespeichert.' : `„${type.name}“ gespeichert.`);
      onClose();
    } catch (e) {
      toast(errMsg(e), { kind: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!activity || !(await confirm('Diesen Eintrag löschen?', { danger: true, confirmLabel: 'Löschen' }))) return;
    try {
      await store.deleteActivity(activity.id);
      bus.emit('timeline', lead.id);
      onClose();
    } catch (e) {
      toast(errMsg(e), { kind: 'error' });
    }
  };

  if (!types.length) {
    return (
      <Modal title="Formular" onClose={onClose}>
        <p className="muted">Es gibt noch keine Formulare. Wer „Einstellungen anpassen“ darf, legt sie unter Einstellungen → Formulare an.</p>
      </Modal>
    );
  }

  return (
    <Modal
      title={activity ? `${type?.name ?? 'Formular'} bearbeiten` : type?.name ?? 'Formular'}
      onClose={onClose}
      wide
      footer={
        <>
          {activity && editable ? (
            <button type="button" className="btn ghost danger-text" style={{ marginRight: 'auto' }} onClick={remove}>
              <Trash2 /> Löschen
            </button>
          ) : null}
          <button type="button" className="btn" onClick={onClose}>Abbrechen</button>
          {editable ? <button type="button" className="btn" onClick={() => save('draft')} disabled={busy}>Entwurf</button> : null}
          {editable ? <button type="button" className="btn primary" onClick={() => save('published')} disabled={busy}>Speichern</button> : null}
        </>
      }
    >
      <fieldset className="plain-fieldset col gap-12" disabled={!editable}>
        <div className="form-grid">
          {!activity && types.length > 1 ? (
            <Field label="Formular">
              <select className="select" value={typeId} onChange={(e) => { setTypeId(e.target.value); setData({}); setTried(false); }}>
                {types.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </Field>
          ) : null}
          <Field label="Kontakt">
            <select className="select" value={contactId ?? ''} onChange={(e) => setContactId(e.target.value || null)}>
              <option value="">– keiner –</option>
              {(lead.contacts ?? []).map((c) => (
                <option key={c.id} value={c.id}>{c.name || 'Ohne Namen'}</option>
              ))}
            </select>
          </Field>
        </div>
        {type?.description ? <p className="small muted">{type.description}</p> : null}
        <div className="form-grid">
          {(type?.fields ?? []).map((f) => {
            const bad = tried && f.required && isEmptyValue(data[f.key]);
            const hint = [f.description, f.creates_task ? 'Legt automatisch eine Aufgabe an.' : null, f.sets_lead_date ? 'Setzt ein Datum am Lead.' : null].filter(Boolean).join(' ');
            return (
              <Field
                key={f.key}
                label={<>{f.label}{f.required ? <span className="req" aria-label="Pflichtfeld"> *</span> : null}</>}
                hint={bad ? <span className="err-text">Pflichtfeld</span> : hint || undefined}
                className={cx(f.type === 'textarea' || f.type === 'multichoice' ? 'full' : undefined, bad && 'invalid')}
              >
                <FieldInput field={shapeOf(f)} value={data[f.key]} onChange={(v) => setData({ ...data, [f.key]: v })} />
              </Field>
            );
          })}
        </div>
      </fieldset>
    </Modal>
  );
}

// ---------- Lead suchen & auswählen ----------
export function LeadPicker({ onPick, autoFocus }: { onPick: (lead: Lead) => void; autoFocus?: boolean }) {
  const { store } = useApp();
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 200);
  const [rows, setRows] = useState<Lead[]>([]);
  useEffect(() => {
    if (!dq.trim()) {
      setRows([]);
      return;
    }
    store.searchLeads(dq, 6).then(setRows).catch(() => setRows([]));
  }, [dq, store]);
  return (
    <div className="col">
      <div className="search" style={{ maxWidth: 'none' }}>
        <Search />
        <input className="input" autoFocus={autoFocus} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Lead suchen (Name, Ort, Nummer)…" aria-label="Lead suchen" />
      </div>
      {rows.map((l) => (
        <button key={l.id} type="button" className="menu-item" onClick={() => onPick(l)}>
          <span className="grow">
            <strong>{l.name}</strong> <span className="muted">{l.address_city}</span>
          </span>
        </button>
      ))}
    </div>
  );
}
