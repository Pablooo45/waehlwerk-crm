import { CalendarPlus, ExternalLink } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '../../app/context.tsx';
import { bus } from '../../lib/bus.ts';
import { addMinutes, isoDay, nextWorkday } from '../../lib/dates.ts';
import { formatDateTime } from '../../lib/format.ts';
import type { DemoStore } from '../../lib/store/demoStore.ts';
import type { CalendlyLink, Contact, Lead } from '../../lib/types.ts';
import { errMsg, Field, Modal, Tabs, useUi } from '../../ui/ui.tsx';
import { UserSelect } from '../common/bits.tsx';

export function calendlyUrl(link: CalendlyLink, lead: Lead, contact: Contact | null, userId: string): string {
  let u: URL;
  try {
    u = new URL(link.url);
  } catch {
    return link.url;
  }
  const email = contact?.emails[0]?.email ?? lead.contacts?.find((c) => c.emails.length)?.emails[0]?.email;
  const name = contact?.name || lead.contacts?.[0]?.name;
  if (name) u.searchParams.set('name', name);
  if (email) u.searchParams.set('email', email);
  u.searchParams.set('utm_source', 'crm');
  u.searchParams.set('utm_medium', 'telefon');
  u.searchParams.set('utm_campaign', lead.id);
  u.searchParams.set('utm_content', userId);
  return u.toString();
}

export function BookMeetingModal({
  lead,
  contact,
  onClose,
  onBooked,
}: {
  lead: Lead;
  contact?: Contact | null;
  onClose: () => void;
  onBooked?: () => void;
}) {
  const { store, ref, me, demo } = useApp();
  const { toast } = useUi();
  const links = ref.org.calendly_links ?? [];
  const google = (ref.org.gcal_calendars ?? []).length > 0;
  const [tab, setTab] = useState<'calendly' | 'manual'>(links.length ? 'calendly' : 'manual');
  const defaultHost = ref.profiles.find((p) => p.active && p.team_function === 'closer')?.id ?? me.id;
  const start0 = nextWorkday(1, 10);
  const [title, setTitle] = useState(`Erstgespräch – ${lead.name}`);
  const [day, setDay] = useState(isoDay(start0));
  const [time, setTime] = useState('10:00');
  const [minutes, setMinutes] = useState(30);
  const [host, setHost] = useState<string | null>(defaultHost);
  const [location, setLocation] = useState('');
  const [note, setNote] = useState('');
  const [toGoogle, setToGoogle] = useState(google);
  const [busy, setBusy] = useState(false);
  const c = contact ?? lead.contacts?.[0] ?? null;

  const openCalendly = (link: CalendlyLink) => {
    window.open(calendlyUrl(link, lead, c, me.id), '_blank', 'noopener');
    toast('Calendly ist geöffnet. Sobald der Termin gebucht ist, erscheint er hier automatisch – mit dir als Opener.');
  };

  const simulate = async (link: CalendlyLink) => {
    const start = nextWorkday(1 + Math.floor(Math.random() * 3), 9 + Math.floor(Math.random() * 7));
    await (store as unknown as DemoStore).demoCalendlyBooking(lead.id, c?.id ?? null, link, start);
    bus.emit('meetings');
    bus.emit('lead', lead.id);
    bus.emit('leads');
    toast(`Demo: Termin am ${formatDateTime(start)} gebucht und dir zugeordnet.`);
    onBooked?.();
    onClose();
  };

  const saveManual = async () => {
    const start = new Date(`${day}T${time}`);
    if (isNaN(start.getTime())) {
      toast('Bitte Datum und Uhrzeit prüfen.', { kind: 'error' });
      return;
    }
    const end = addMinutes(start, minutes);
    setBusy(true);
    try {
      if (toGoogle && google) {
        await store.createCalendarEvent({
          leadId: lead.id,
          contactId: c?.id ?? null,
          title,
          start: start.toISOString(),
          end: end.toISOString(),
          description: note,
          hostUserId: host,
          location: location || null,
        });
      } else {
        await store.saveMeeting({
          lead_id: lead.id,
          contact_id: c?.id ?? null,
          title,
          starts_at: start.toISOString(),
          ends_at: end.toISOString(),
          host_user_id: host,
          location: location || null,
          join_url: /^https?:\/\//.test(location) ? location : null,
          description: note || null,
          invitee_name: c?.name ?? null,
          invitee_email: c?.emails[0]?.email ?? null,
        });
      }
      bus.emit('meetings');
      bus.emit('lead', lead.id);
      bus.emit('leads');
      toast(toGoogle && google ? 'Termin im Google Kalender eingetragen.' : 'Termin gespeichert.');
      onBooked?.();
      onClose();
    } catch (e) {
      toast(errMsg(e), { kind: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Termin buchen"
      onClose={onClose}
      wide
      footer={
        tab === 'manual' ? (
          <>
            <button type="button" className="btn" onClick={onClose}>
              Abbrechen
            </button>
            <button type="button" className="btn primary" onClick={saveManual} disabled={busy}>
              <CalendarPlus /> Termin speichern
            </button>
          </>
        ) : undefined
      }
    >
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'calendly', label: 'Über Calendly' },
          { value: 'manual', label: 'Selbst eintragen' },
        ]}
      />
      <div className="mt-16">
        {tab === 'calendly' ? (
          links.length ? (
            <div className="col gap-12">
              <p className="muted small">
                Der Link wird mit Name und E-Mail vorausgefüllt. Über die Markierung im Link ordnet das CRM die Buchung
                automatisch diesem Lead und dir als Opener zu.
              </p>
              <div className="panel">
                {links.map((l) => (
                  <div className="list-item" key={l.url}>
                    <div className="grow">
                      <strong>{l.name}</strong>
                      <div className="small muted">
                        {[l.duration ? `${l.duration} Min.` : null, l.owner].filter(Boolean).join(', ')}
                      </div>
                    </div>
                    {demo ? (
                      <button type="button" className="btn primary small" onClick={() => simulate(l)}>
                        Buchung simulieren
                      </button>
                    ) : (
                      <button type="button" className="btn primary small" onClick={() => openCalendly(l)}>
                        <ExternalLink /> Öffnen
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="muted">
              Noch keine Calendly-Links hinterlegt. Ein Admin kann Calendly unter Einstellungen → Kalender verbinden. Bis
              dahin: Termin selbst eintragen.
            </p>
          )
        ) : (
          <div className="form-grid">
            <Field label="Titel" className="full">
              <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
            </Field>
            <Field label="Datum">
              <input className="input" type="date" value={day} onChange={(e) => setDay(e.target.value)} />
            </Field>
            <div className="row gap-12">
              <Field label="Uhrzeit" className="grow">
                <input className="input" type="time" step={300} value={time} onChange={(e) => setTime(e.target.value)} />
              </Field>
              <Field label="Dauer" className="grow">
                <select className="select" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
                  {[15, 20, 30, 45, 60, 90].map((m) => (
                    <option key={m} value={m}>
                      {m} Min.
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <Field label="Termin mit (Closer)">
              <UserSelect value={host} onChange={setHost} />
            </Field>
            <Field label="Ort oder Link">
              <input className="input" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Telefon, Zoom-Link, Vor Ort …" />
            </Field>
            <Field label="Notiz für den Termin" className="full">
              <textarea className="textarea" value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
            {google ? (
              <label className="check full">
                <input type="checkbox" checked={toGoogle} onChange={(e) => setToGoogle(e.target.checked)} />
                Im Google Kalender „{ref.org.gcal_calendars[0]?.label ?? 'Team'}“ eintragen
              </label>
            ) : (
              <p className="small muted full">Der Termin wird im CRM gespeichert. Mit verbundenem Google Kalender landet er auch dort.</p>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
