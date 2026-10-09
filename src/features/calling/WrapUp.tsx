// Nachbearbeitung nach jedem Anruf: Ergebnis, Notiz, Wiedervorlage, Status – in Sekunden.

import { CalendarPlus, Check, ClipboardList, Link2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../../app/context.tsx';
import { useAsync } from '../../app/hooks.ts';
import { leadHref } from '../../app/router.ts';
import { bus } from '../../lib/bus.ts';
import { fromLocalInput, nextWorkday, toLocalInput } from '../../lib/dates.ts';
import { formatDuration, formatPhone } from '../../lib/format.ts';
import type { ActiveCall } from '../../lib/phone/types.ts';
import type { ActivityType, CallOutcome, Lead } from '../../lib/types.ts';
import { cx, errMsg, Segmented, useHotkeys, useUi } from '../../ui/ui.tsx';
import { StatusSelect } from '../common/bits.tsx';
import { ActivityFormModal, LeadPicker } from '../common/forms.tsx';
import { BookMeetingModal } from '../meetings/BookMeeting.tsx';

type Follow = 'none' | '1' | '2' | '7' | 'custom';

function followTitle(o: CallOutcome | undefined): string {
  if (!o) return 'Nachfassen';
  if (!o.counts_as_connected) return 'Erneut anrufen';
  return `Nachfassen: ${o.label}`;
}

export function WrapUp({ ended, inDialer, onDone }: { ended: ActiveCall; inDialer?: boolean; onDone?: (outcome: string | null) => void }) {
  const { store, ref, me, phone } = useApp();
  const { toast } = useUi();
  const outcomes = useMemo(() => ref.outcomes.filter((o) => o.active), [ref.outcomes]);
  const [leadId, setLeadId] = useState<string | null>(ended.leadId);
  const leadQ = useAsync<Lead | null>(() => (leadId ? store.getLead(leadId) : Promise.resolve(null)), [leadId]);
  const lead = leadQ.data ?? null;

  const answered = !!ended.answeredAt;
  // Vorschlag: Mailbox-Nachricht → eingestelltes Ergebnis; nicht angenommen → erstes „nicht erreicht“-Ergebnis
  const notReached = outcomes.find((o) => !o.counts_as_connected && !o.is_meeting)?.key ?? null;
  const preset = ended.endReason === 'voicemail' ? ref.org.voicemail_drop_outcome ?? notReached : !answered && ended.direction === 'outbound' ? notReached : null;
  const [outcome, setOutcome] = useState<string | null>(preset);
  const [note, setNote] = useState('');
  const [statusId, setStatusId] = useState<string | null>(null);
  const [follow, setFollow] = useState<Follow>('none');
  const [customDue, setCustomDue] = useState(toLocalInput(nextWorkday(1, 10)));
  const [busy, setBusy] = useState(false);
  const [booking, setBooking] = useState(false);
  const [newName, setNewName] = useState('');
  const [form, setForm] = useState<ActivityType | null>(null);
  const forms = ref.activityTypes.filter((t) => !t.archived);

  // Ergebnis gewählt → Status und Wiedervorlage vorschlagen
  useEffect(() => {
    const o = outcomes.find((x) => x.key === outcome);
    if (o?.next_status_id) {
      const currentKind = ref.statuses.find((s) => s.id === lead?.status_id)?.kind;
      if (currentKind !== 'won') setStatusId(o.next_status_id);
    } else if (lead) {
      setStatusId(lead.status_id);
    }
    setFollow(o?.followup_days ? (o.followup_days <= 1 ? '1' : o.followup_days <= 2 ? '2' : '7') : 'none');
  }, [outcome, outcomes, lead, ref.statuses]);

  useEffect(() => {
    if (lead && statusId === null) setStatusId(lead.status_id);
  }, [lead, statusId]);

  const save = async (skipOutcome = false) => {
    if (busy) return;
    setBusy(true);
    const chosen = skipOutcome ? null : outcome;
    try {
      await store.finalizeCall(ended.id, {
        outcome: chosen,
        note: note.trim() || null,
        lead_id: leadId,
        contact_id: leadId === ended.leadId ? ended.contactId : null,
      });
      if (lead && statusId && statusId !== lead.status_id) await store.updateLead(lead.id, { status_id: statusId });
      if (leadId && follow !== 'none' && !skipOutcome) {
        const due = follow === 'custom' ? fromLocalInput(customDue) : nextWorkday(Number(follow), 10).toISOString();
        await store.saveTask({ title: followTitle(outcomes.find((o) => o.key === chosen)), type: 'call', lead_id: leadId, due_at: due, assigned_to: me.id, call_id: ended.id });
      }
      bus.emit('timeline', leadId);
      bus.emit('lead', leadId);
      bus.emit('tasks');
      bus.emit('calls');
      phone.clearEnded();
      onDone?.(chosen);
    } catch (e) {
      toast(errMsg(e), { kind: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const keyMap: Record<string, () => void> = {};
  outcomes.slice(0, 9).forEach((o, i) => {
    keyMap[String(i + 1)] = () => setOutcome(o.key);
  });
  keyMap['mod+enter'] = () => save();
  useHotkeys(keyMap, true);

  const createAndAssign = async () => {
    if (!newName.trim()) return;
    try {
      const l = await store.createLead(
        { name: newName.trim(), source: ended.direction === 'inbound' ? 'Eingehender Anruf' : 'Telefon' },
        [{ name: '', phones: [{ type: 'office', number: ended.number }] }],
      );
      setLeadId(l.id);
      bus.emit('leads');
    } catch (e) {
      toast(errMsg(e), { kind: 'error' });
    }
  };

  const selected = outcomes.find((o) => o.key === outcome);
  const dur = ended.answeredAt && ended.endedAt ? Math.round((ended.endedAt - ended.answeredAt) / 1000) : 0;

  return (
    <section className={cx(inDialer ? 'panel dialer-wrap' : 'wrapup')} aria-label="Anruf nachbearbeiten" style={inDialer ? { padding: 18 } : undefined}>
      <div className="wrapup-head">
        <h2>{inDialer ? 'Wie lief der Anruf?' : 'Anruf beendet'}</h2>
        <span className="muted small">
          {lead ? <a href={leadHref(lead.id)}>{lead.name}</a> : formatPhone(ended.number)}
          {answered ? `, ${formatDuration(dur)} Gespräch` : ended.direction === 'outbound' ? ', nicht angenommen' : ''}
          {ended.endReason === 'voicemail' ? ', Mailbox-Nachricht hinterlassen' : ''}
          {ended.endReason === 'transferred' ? ', weitergeleitet' : ''}
          {ended.error ? `, Fehler: ${ended.error}` : ''}
        </span>
        <span className="spacer" />
        {!inDialer ? (
          <button type="button" className="icon-btn wrapup-close" aria-label="Ohne Ergebnis schließen" title="Ohne Ergebnis schließen" onClick={() => save(true)}>
            <X />
          </button>
        ) : null}
      </div>

      {!leadId ? (
        <div className="callout mt-8" style={{ marginBottom: 12, flexDirection: 'column' }}>
          <strong>Zu welchem Lead gehört der Anruf?</strong>
          <div className="row wrap" style={{ width: '100%' }}>
            <div className="grow" style={{ minWidth: 240 }}>
              <LeadPicker onPick={(l) => setLeadId(l.id)} />
            </div>
            <div className="row" style={{ minWidth: 240 }}>
              <input className="input" placeholder="…oder neuen Lead anlegen: Firmenname" value={newName} onChange={(e) => setNewName(e.target.value)} />
              <button type="button" className="btn" onClick={createAndAssign} disabled={!newName.trim()}>
                <Link2 /> Anlegen
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="outcomes">
        {outcomes.map((o, i) => (
          <button key={o.key} type="button" className="outcome-btn" aria-pressed={outcome === o.key} onClick={() => setOutcome(o.key)}>
            <span className="dot" style={{ background: o.color }} />
            <span className="grow">{o.label}</span>
            {i < 9 ? <kbd className="hide-touch">{i + 1}</kbd> : null}
          </button>
        ))}
      </div>

      <div className="form-grid wrapup-grid mt-16">
        <div className="field full">
          <label htmlFor="wrap-note">Notiz</label>
          <textarea
            id="wrap-note"
            className="textarea"
            style={{ minHeight: 64 }}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Was wurde besprochen? Wer war dran? Einwände?"
          />
        </div>
        {lead ? (
          <div className="field">
            <label>Status danach</label>
            <StatusSelect value={statusId} onChange={setStatusId} statuses={ref.statuses} />
          </div>
        ) : null}
        {leadId ? (
          <div className="field">
            <label>Wiedervorlage</label>
            <Segmented<Follow>
              value={follow}
              onChange={setFollow}
              options={[
                { value: 'none', label: 'Keine' },
                { value: '1', label: 'Morgen' },
                { value: '2', label: 'In 2 Tagen' },
                { value: '7', label: 'In 1 Woche' },
                { value: 'custom', label: 'Datum' },
              ]}
            />
            {follow === 'custom' ? (
              <input className="input mt-8" type="datetime-local" value={customDue} onChange={(e) => setCustomDue(e.target.value)} />
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="row wrap mt-16">
        {selected?.is_meeting && lead ? (
          <button type="button" className="btn" onClick={() => setBooking(true)}>
            <CalendarPlus /> Termin buchen
          </button>
        ) : null}
        {lead
          ? forms.slice(0, 3).map((t) => (
            <button key={t.id} type="button" className="btn" onClick={() => setForm(t)} title={t.description || undefined}>
              <ClipboardList /> {t.name}
            </button>
          ))
          : null}
        <span className="spacer" />
        {inDialer ? (
          <button type="button" className="btn ghost" onClick={() => save(true)} disabled={busy}>
            Ohne Ergebnis weiter
          </button>
        ) : null}
        <button type="button" className="btn primary large" onClick={() => save()} disabled={busy || !outcome}>
          <Check /> {inDialer ? 'Speichern & nächster Lead' : 'Speichern'}
          <kbd style={{ marginLeft: 4 }} className="hide-touch">Strg ↵</kbd>
        </button>
      </div>

      {form && lead ? <ActivityFormModal lead={lead} type={form} callId={ended.id} onClose={() => setForm(null)} /> : null}
      {booking && lead ? (
        <BookMeetingModal lead={lead} contact={lead.contacts?.find((c) => c.id === ended.contactId) ?? null} onClose={() => setBooking(false)} />
      ) : null}
    </section>
  );
}
