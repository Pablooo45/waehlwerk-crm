import { CheckCircle2, Copy, Plus, RefreshCw, Trash2, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { useApp } from '../../app/context.tsx';
import { useAsync } from '../../app/hooks.ts';
import { formatDateTime, formatRelative } from '../../lib/format.ts';
import type { CalendlyLink } from '../../lib/types.ts';
import { copyText, errMsg, Field, Loading, Tag, useUi } from '../../ui/ui.tsx';
import { StatusSelect } from '../common/bits.tsx';

interface Status {
  calendly: { connected: boolean; webhook: boolean; connectedAt: string | null };
  google: { connected: boolean; email: string | null; calendars: { id: string; label?: string }[]; lastSync: string | null; lastError: string | null };
}

export default function Calendar() {
  const { store, ref, reloadRef, demo } = useApp();
  const { toast, confirm } = useUi();
  const status = useAsync(() => store.admin<Status>('status'), [store]);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [linkName, setLinkName] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [calId, setCalId] = useState('');
  const [calLabel, setCalLabel] = useState('');
  const [saEmail, setSaEmail] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const org = ref.org;

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      await reloadRef();
      status.reload();
      toast(ok);
    } catch (e) {
      toast(errMsg(e), { kind: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const addLink = () => {
    if (!linkName.trim() || !/^https:\/\/calendly\.com\//.test(linkUrl.trim())) {
      toast('Bitte Name und einen Link wie https://calendly.com/… eingeben.', { kind: 'error' });
      return;
    }
    const links: CalendlyLink[] = [...org.calendly_links, { name: linkName.trim(), url: linkUrl.trim(), source: 'manual' }];
    run(() => store.updateOrg({ calendly_links: links }), 'Link hinzugefügt.').then(() => {
      setLinkName('');
      setLinkUrl('');
    });
  };

  const removeLink = (l: CalendlyLink) =>
    run(() => store.updateOrg({ calendly_links: org.calendly_links.filter((x) => x.url !== l.url) }), 'Link entfernt.');

  const uploadKey = async (f: File) => {
    const text = await f.text();
    setBusy(true);
    try {
      const r = await store.admin<{ email: string }>('google_connect', { serviceAccountJson: text });
      setSaEmail(r.email);
      status.reload();
      toast('Google-Schlüssel gespeichert.');
    } catch (e) {
      toast(errMsg(e), { kind: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const s = status.data;
  const email = saEmail ?? s?.google.email ?? null;

  return (
    <>
      <section className="section">
        <h2>Calendly</h2>
        <p className="muted">
          Gebuchte und abgesagte Termine kommen automatisch ins CRM. Bucht ein Opener über „Termin buchen“ im CRM, wird
          der Termin ihm und dem Lead zugeordnet – auch wenn der Kunde selbst bucht. Buchungen ohne passenden Lead (z. B.
          über eure Landingpage) legen auf Wunsch einen neuen Lead an.
        </p>
        {status.loading && !s ? (
          <Loading />
        ) : s?.calendly.connected ? (
          <div className="callout ok" style={{ marginBottom: 12 }}>
            <CheckCircle2 />
            <span>Verbunden{org.calendly_connected_at ? ` seit ${formatDateTime(org.calendly_connected_at)}` : ''}. {s.calendly.webhook ? 'Termine werden automatisch übertragen.' : 'Webhook fehlt – bitte neu verbinden.'}</span>
          </div>
        ) : null}
        <Field label="Persönlicher Zugangs-Token" hint="Calendly → Integrationen → API und Webhooks → Persönlichen Zugangs-Token erstellen. Für Webhooks braucht das Calendly-Konto einen bezahlten Tarif (z. B. Standard).">
          <div className="row">
            <input className="input" type="password" value={token} onChange={(e) => setToken(e.target.value.trim())} autoComplete="off" />
            <button type="button" className="btn primary" disabled={busy || token.length < 20 || demo} onClick={() => run(() => store.admin('calendly_connect', { token }), 'Calendly verbunden.').then(() => setToken(''))}>
              {s?.calendly.connected ? 'Neu verbinden' : 'Verbinden'}
            </button>
          </div>
        </Field>
        {s?.calendly.connected ? (
          <div className="row wrap mt-8">
            <button type="button" className="btn small" disabled={busy} onClick={() => run(() => store.admin('calendly_refresh'), 'Links aktualisiert.')}>
              <RefreshCw /> Links neu laden
            </button>
            <button
              type="button"
              className="btn small ghost"
              disabled={busy}
              onClick={async () => {
                if (await confirm('Calendly trennen? Neue Buchungen kommen dann nicht mehr ins CRM.', { danger: true, confirmLabel: 'Trennen' })) {
                  run(() => store.admin('calendly_disconnect'), 'Calendly getrennt.');
                }
              }}
            >
              Trennen
            </button>
          </div>
        ) : null}

        <h3 className="mt-24">Buchungslinks im CRM</h3>
        <p className="small muted">Diese Links bietet „Termin buchen“ an.</p>
        <div className="panel mt-8">
          {org.calendly_links.map((l) => (
            <div className="list-item" key={l.url}>
              <span className="grow">
                <strong>{l.name}</strong>
                <div className="xs muted ellipsis">{l.url}</div>
              </span>
              {l.source === 'calendly' ? <Tag tone="soft">aus Calendly</Tag> : null}
              <button type="button" className="icon-btn small" onClick={() => removeLink(l)} aria-label="Entfernen">
                <Trash2 />
              </button>
            </div>
          ))}
          {!org.calendly_links.length ? <div className="panel-body small muted">Noch keine Links.</div> : null}
        </div>
        <div className="row wrap mt-8">
          <input className="input" style={{ maxWidth: 200 }} value={linkName} onChange={(e) => setLinkName(e.target.value)} placeholder="Name, z. B. Erstgespräch" />
          <input className="input grow" style={{ minWidth: 220 }} value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder="https://calendly.com/…" />
          <button type="button" className="btn" onClick={addLink}>
            <Plus /> Link
          </button>
        </div>

        <div className="form-grid mt-16">
          <label className="check">
            <input type="checkbox" checked={org.calendly_create_leads} onChange={(e) => run(() => store.updateOrg({ calendly_create_leads: e.target.checked }), 'Gespeichert.')} />
            Neuen Lead anlegen, wenn eine Buchung zu keinem Lead passt
          </label>
          <Field label="Status nach gebuchtem Termin">
            <StatusSelect value={org.meeting_status_id} onChange={(v) => run(() => store.updateOrg({ meeting_status_id: v }), 'Gespeichert.')} statuses={ref.statuses} allowEmpty />
          </Field>
        </div>
      </section>

      <section className="section">
        <h2>Google Kalender</h2>
        <p className="muted">
          Euer Team-Kalender wird alle 5 Minuten abgeglichen: Termine erscheinen im CRM beim passenden Lead (erkannt an
          E-Mail, Telefonnummer oder CRM-Link), und Termine aus dem CRM landen im Kalender.
        </p>
        {s?.google.connected || saEmail ? (
          <div className="callout ok" style={{ marginBottom: 12 }}>
            <CheckCircle2 />
            <span>
              Schlüssel hinterlegt. Teile den Kalender in Google mit
              <strong> {email}</strong> (Berechtigung „Änderungen an Terminen vornehmen“).
              {email ? (
                <button type="button" className="icon-btn small" aria-label="E-Mail kopieren" onClick={async () => toast((await copyText(email)) ? 'Kopiert.' : `Bitte von Hand kopieren: ${email}`)}>
                  <Copy />
                </button>
              ) : null}
            </span>
          </div>
        ) : null}
        <div className="row wrap">
          <button type="button" className="btn" onClick={() => file.current?.click()} disabled={busy || demo}>
            <Upload /> Schlüsseldatei (.json) hochladen
          </button>
          <input ref={file} type="file" accept="application/json,.json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadKey(f); e.target.value = ''; }} />
          <span className="small muted">Aus der Google Cloud Console: Dienstkonto → Schlüssel → JSON (siehe Anleitung).</span>
        </div>

        <h3 className="mt-24">Verbundene Kalender</h3>
        <div className="panel mt-8">
          {org.gcal_calendars.map((c) => (
            <div className="list-item" key={c.id}>
              <span className="grow">
                <strong>{c.label || c.id}</strong>
                <div className="xs muted">{c.id}</div>
              </span>
              <button type="button" className="icon-btn small" aria-label="Entfernen" onClick={() => run(() => store.admin('google_remove_calendar', { calendarId: c.id }), 'Kalender entfernt.')}>
                <Trash2 />
              </button>
            </div>
          ))}
          {!org.gcal_calendars.length ? <div className="panel-body small muted">Noch kein Kalender verbunden.</div> : null}
        </div>
        <div className="row wrap mt-8">
          <input className="input grow" style={{ minWidth: 240 }} value={calId} onChange={(e) => setCalId(e.target.value.trim())} placeholder="Kalender-ID, z. B. …@group.calendar.google.com" />
          <input className="input" style={{ maxWidth: 180 }} value={calLabel} onChange={(e) => setCalLabel(e.target.value)} placeholder="Name (optional)" />
          <button type="button" className="btn" disabled={busy || !calId || !(s?.google.connected || saEmail)} onClick={() => run(() => store.admin('google_add_calendar', { calendarId: calId, label: calLabel }), 'Kalender verbunden.').then(() => { setCalId(''); setCalLabel(''); })}>
            <Plus /> Verbinden
          </button>
        </div>
        <p className="xs muted mt-8">Die Kalender-ID findest du in Google Kalender → Einstellungen des Kalenders → „Kalender integrieren“.</p>

        {org.gcal_calendars.length ? (
          <div className="col mt-16">
            <div className="small">
              Letzter Abgleich: {org.gcal_last_sync ? formatRelative(org.gcal_last_sync) : 'noch nie'}
              {org.gcal_last_error ? <span style={{ color: 'var(--signal)' }}> – Fehler: {org.gcal_last_error}</span> : null}
            </div>
            <div className="row wrap">
              <button type="button" className="btn" disabled={busy} onClick={() => run(() => store.syncCalendars(true), 'Abgeglichen.')}>
                <RefreshCw /> Jetzt abgleichen
              </button>
              <button type="button" className="btn" disabled={busy} onClick={() => run(() => store.scheduleJobs(), 'Automatischer Abgleich ist aktiv (Kalender alle 5 Minuten, Workflows und Postfächer jede Minute).')}>
                Automatischen Abgleich aktivieren
              </button>
            </div>
          </div>
        ) : null}
      </section>
    </>
  );
}
