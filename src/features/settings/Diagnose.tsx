import { AlertTriangle, CheckCircle2, ClipboardCopy, Gauge, HelpCircle, RefreshCw, XCircle } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { useApp, usePhone } from '../../app/context.tsx';
import { useAsync } from '../../app/hooks.ts';
import { config } from '../../lib/config.ts';
import { formatDateTime, formatRelative } from '../../lib/format.ts';
import type { PreflightReport } from '../../lib/phone/types.ts';
import type { AppLog } from '../../lib/types.ts';
import { copyText, errMsg, Loading, Modal, Tag, useUi } from '../../ui/ui.tsx';
import { MicMeter } from './audio.tsx';

type State = 'ok' | 'warn' | 'err' | 'unknown';

interface Check {
  label: string;
  state: State;
  detail: string;
  action?: ReactNode;
}

interface Status {
  functionsUrl: string;
  twilio: { connected: boolean; ready: boolean; account?: { name: string; status: string; type: string }; voiceUrlOk?: boolean; error?: string };
  calendly: { connected: boolean; webhook: boolean };
  google: { connected: boolean; calendars: unknown[]; lastSync: string | null; lastError: string | null };
  ai?: { assemblyai: boolean; anthropic: boolean };
  jobs?: { scheduled: boolean; lastRun: string | null; healthy: boolean };
  recordings?: { failed: number | null };
}

const ICON: Record<State, ReactNode> = {
  ok: <CheckCircle2 color="var(--cross)" />,
  warn: <AlertTriangle color="var(--amber)" />,
  err: <XCircle color="var(--signal)" />,
  unknown: <HelpCircle color="var(--muted)" />,
};

export default function Diagnose() {
  const { store, phone, isAdmin, demo, me, ref } = useApp();
  const snap = usePhone();
  const { toast } = useUi();
  const status = useAsync(() => store.admin<Status>('status'), [store]);
  const logs = useAsync(() => (isAdmin ? store.listLogs(100) : Promise.resolve([] as AppLog[])), [store, isAdmin]);
  const [mic, setMic] = useState<State>('unknown');
  const [pre, setPre] = useState<PreflightReport | null>(null);
  const [preBusy, setPreBusy] = useState(false);
  const [preErr, setPreErr] = useState<string | null>(null);
  const [report, setReport] = useState<string | null>(null);
  const [scheduling, setScheduling] = useState(false);

  const enableJobs = async () => {
    setScheduling(true);
    try {
      await store.scheduleJobs();
      toast('Hintergrundaufgaben sind eingeschaltet – sie laufen ab jetzt jede Minute.');
      status.reload();
    } catch (e) {
      toast(errMsg(e), { kind: 'error' });
    } finally {
      setScheduling(false);
    }
  };

  useEffect(() => {
    const perms = navigator.permissions as Permissions | undefined;
    perms
      ?.query({ name: 'microphone' as PermissionName })
      .then((p) => {
        setMic(p.state === 'granted' ? 'ok' : p.state === 'denied' ? 'err' : 'warn');
        p.onchange = () => setMic(p.state === 'granted' ? 'ok' : p.state === 'denied' ? 'err' : 'warn');
      })
      .catch(() => setMic('unknown'));
  }, []);

  const s = status.data;
  const checks: Check[] = [
    {
      label: 'Verbindung zur Datenbank',
      state: 'ok',
      detail: demo ? 'Demo-Modus – Daten liegen nur in diesem Browser.' : `Verbunden mit ${new URL(config.supabaseUrl).host}`,
    },
    {
      label: 'Server-Funktionen',
      state: status.error ? 'err' : s ? 'ok' : 'unknown',
      detail: status.error ? `${status.error} – sind die Edge Functions installiert? (EINRICHTUNG.md, Schritt 3)` : s ? 'Erreichbar' : 'Prüfe…',
    },
    {
      label: 'Twilio',
      state: !s ? 'unknown' : s.twilio.ready && s.twilio.voiceUrlOk !== false ? 'ok' : s.twilio.connected ? 'warn' : 'err',
      detail: !s
        ? 'Prüfe…'
        : s.twilio.ready
        ? `Eingerichtet${s.twilio.account ? ` (${s.twilio.account.name}, ${s.twilio.account.type === 'Trial' ? 'Testkonto' : 'Vollkonto'})` : ''}${s.twilio.voiceUrlOk === false ? ' – Anruf-Adresse veraltet, unter Telefonie „Neu einrichten“' : ''}${s.twilio.error ? ` – ${s.twilio.error}` : ''}`
        : s.twilio.connected
        ? 'Zugangsdaten da, Einrichtung unvollständig (Telefonie → Neu einrichten)'
        : 'Noch nicht verbunden (Einstellungen → Telefonie)',
    },
    {
      label: 'Telefon im Browser',
      state: snap.status === 'ready' ? 'ok' : snap.status === 'starting' ? 'unknown' : snap.status === 'unconfigured' ? 'warn' : 'err',
      detail:
        snap.status === 'ready'
          ? demo ? 'Bereit (simuliert)' : 'Bereit für Anrufe – eingehende Anrufe klingeln hier'
          : snap.message ?? snap.status,
    },
    {
      label: 'Mikrofon-Berechtigung',
      state: mic,
      detail: mic === 'ok' ? 'Erlaubt' : mic === 'err' ? 'Blockiert – im Browser über das Schloss-Symbol neben der Adresse erlauben' : mic === 'warn' ? 'Wird beim ersten Anruf abgefragt' : 'Kann nicht geprüft werden',
    },
    {
      label: 'Browser',
      state: typeof RTCPeerConnection !== 'undefined' && (location.protocol === 'https:' || location.hostname === 'localhost') ? 'ok' : 'err',
      detail: typeof RTCPeerConnection === 'undefined' ? 'Dieser Browser kann nicht telefonieren. Bitte Chrome oder Edge nutzen.' : location.protocol !== 'https:' && location.hostname !== 'localhost' ? 'Telefonieren geht nur über https://' : 'Unterstützt',
    },
    {
      label: 'Calendly',
      state: !s ? 'unknown' : s.calendly.connected && s.calendly.webhook ? 'ok' : 'warn',
      detail: !s ? 'Prüfe…' : s.calendly.connected ? (s.calendly.webhook ? 'Verbunden' : 'Webhook fehlt – neu verbinden') : 'Nicht verbunden',
    },
    {
      label: 'Google Kalender',
      state: !s ? 'unknown' : s.google.lastError ? 'err' : s.google.connected && s.google.calendars.length ? 'ok' : 'warn',
      detail: !s
        ? 'Prüfe…'
        : s.google.lastError
        ? `Fehler beim letzten Abgleich: ${s.google.lastError}`
        : s.google.connected && s.google.calendars.length
        ? `Abgeglichen ${s.google.lastSync ? formatRelative(s.google.lastSync) : 'noch nie'}`
        : 'Nicht verbunden',
    },
    {
      label: 'Hintergrundaufgaben',
      state: !s?.jobs ? 'unknown' : s.jobs.healthy ? 'ok' : s.jobs.scheduled ? 'warn' : 'err',
      detail: !s?.jobs
        ? 'Prüfe…'
        : s.jobs.healthy
        ? `Laufen jede Minute (Workflows, geplante E-Mails, Postfächer, Aufnahmen nachholen, Löschfristen) – zuletzt ${formatRelative(s.jobs.lastRun!)}`
        : s.jobs.scheduled
        ? `Eingeschaltet, aber ${s.jobs.lastRun ? `zuletzt ${formatRelative(s.jobs.lastRun)}` : 'noch nie'} gelaufen – sind pg_cron und pg_net aktiv? (EINRICHTUNG.md, Schritt 1)`
        : 'Noch aus: Workflows, geplante E-Mails, Postfach-Abruf und das Nachholen von Aufnahmen laufen erst danach.',
      action: isAdmin && s?.jobs && !s.jobs.healthy && !demo ? (
        <button type="button" className="btn small" onClick={enableJobs} disabled={scheduling}>
          {s.jobs.scheduled ? 'Neu einschalten' : 'Einschalten'}
        </button>
      ) : undefined,
    },
    {
      label: 'Aufnahmen',
      state: !s?.recordings || s.recordings.failed === null ? 'unknown' : s.recordings.failed ? 'warn' : 'ok',
      detail: !s?.recordings || s.recordings.failed === null
        ? 'Prüfe…'
        : s.recordings.failed
        ? `${s.recordings.failed === 1 ? 'Eine Aufnahme' : `${s.recordings.failed} Aufnahmen`} der letzten 7 Tage ${s.recordings.failed === 1 ? 'konnte' : 'konnten'} bisher nicht gespeichert werden. Das CRM holt sie automatisch erneut; im Gespräch geht es auch per „Erneut holen“. Grund im Fehlerprotokoll.`
        : 'Alle Aufnahmen der letzten 7 Tage sind gespeichert.',
    },
    {
      label: 'Abschriften & KI',
      state: !s?.ai ? 'unknown' : s.ai.assemblyai ? 'ok' : 'warn',
      detail: !s?.ai
        ? 'Prüfe…'
        : `${s.ai.assemblyai ? 'AssemblyAI (EU) verbunden' : 'Abschriften nicht eingerichtet'}${s.ai.anthropic ? ', Zusammenfassungen mit Claude aktiv' : ''}`,
    },
  ];

  const runPreflight = async () => {
    setPreBusy(true);
    setPreErr(null);
    try {
      setPre(await phone.preflight());
    } catch (e) {
      setPreErr(errMsg(e));
    } finally {
      setPreBusy(false);
    }
  };

  const copyReport = async () => {
    const lines = [
      `Fehlerbericht ${config.appName} CRM (Version ${config.version})`,
      `Zeit: ${new Date().toISOString()}`,
      `Nutzer: ${me.email} (Rolle: ${ref.roles.find((r) => r.id === me.role_id)?.name ?? me.role_id})`,
      `Modus: ${demo ? 'Demo' : 'Live'}, Server: ${config.supabaseUrl || '-'}`,
      `Browser: ${navigator.userAgent}`,
      `Telefon: ${snap.status}${snap.message ? ` – ${snap.message}` : ''}`,
      '',
      'Prüfungen:',
      ...checks.map((c) => `- ${c.label}: ${c.state.toUpperCase()} – ${c.detail}`),
      pre ? `\nNetztest: Qualität ${pre.quality}, Verzögerung ${pre.rttMs ?? '?'} ms, Jitter ${pre.jitterMs ?? '?'} ms, MOS ${pre.mos ?? '?'}, Edge ${pre.edge ?? '?'}` : '',
      '',
      'Letzte Fehler:',
      ...(logs.data ?? []).slice(0, 30).map((l) => `- ${l.at} [${l.source}/${l.level}] ${l.message} ${JSON.stringify(l.details).slice(0, 300)}`),
    ];
    const text = lines.join('\n');
    if (await copyText(text)) toast('Fehlerbericht kopiert – einfach in den Chat mit Claude einfügen.');
    else setReport(text);
  };

  const quality = (r: PreflightReport): { state: State; text: string } => {
    if (r.rttMs !== null && r.rttMs > 300) return { state: 'err', text: 'Hohe Verzögerung – Gesprächspartner fallen sich ins Wort. LAN-Kabel statt WLAN nutzen.' };
    if (r.mos !== null && r.mos < 3.5) return { state: 'warn', text: 'Mäßige Sprachqualität. Andere Downloads/Streams pausieren, WLAN prüfen.' };
    return { state: 'ok', text: 'Gute Verbindung für Telefonate.' };
  };

  return (
    <>
      <section className="section">
        <div className="row" style={{ marginBottom: 6 }}>
          <h2 className="grow">Systemprüfung</h2>
          <button type="button" className="btn small" onClick={() => { status.reload(); logs.reload(); }}>
            <RefreshCw /> Neu prüfen
          </button>
          <button type="button" className="btn small primary" onClick={copyReport}>
            <ClipboardCopy /> Fehlerbericht kopieren
          </button>
        </div>
        <p className="muted">Wenn etwas nicht klappt: „Fehlerbericht kopieren“ und an Claude schicken – damit lässt sich das Problem schnell finden.</p>
        <div className="panel check-list">
          {checks.map((c) => (
            <div className="list-item" key={c.label}>
              {ICON[c.state]}
              <span className="grow">
                <strong>{c.label}</strong>
                <div className="small muted">{c.detail}</div>
              </span>
              {c.action ?? null}
            </div>
          ))}
        </div>
      </section>

      <section className="section">
        <h2>Netz- und Audiotest</h2>
        <p className="muted">Testet die Verbindung zu Twilio wie ein echter Anruf (ca. 15 Sekunden) und zeigt Verzögerung und Qualität.</p>
        <div className="row wrap">
          <button type="button" className="btn" onClick={runPreflight} disabled={preBusy || snap.status === 'unconfigured' || !!snap.call}>
            <Gauge className={preBusy ? 'spin' : undefined} /> {preBusy ? 'Teste…' : 'Verbindung testen'}
          </button>
        </div>
        {preErr ? <div className="callout err mt-16"><XCircle /><span>{preErr}</span></div> : null}
        {pre ? (
          <div className="col mt-16">
            <div className="stat-row">
              <div className="stat"><div className="v">{pre.rttMs !== null ? `${Math.round(pre.rttMs)} ms` : '–'}</div><div className="k">Verzögerung (hin und zurück)</div></div>
              <div className="stat"><div className="v">{pre.jitterMs !== null ? `${pre.jitterMs.toFixed(1)} ms` : '–'}</div><div className="k">Jitter</div></div>
              <div className="stat"><div className="v">{pre.mos !== null ? pre.mos.toFixed(2).replace('.', ',') : '–'}</div><div className="k">Sprachqualität (MOS, max. 4,5)</div></div>
            </div>
            <div className={`callout ${quality(pre).state === 'ok' ? 'ok' : quality(pre).state === 'warn' ? 'warn' : 'err'}`}>
              {ICON[quality(pre).state]}
              <span>
                {quality(pre).text} Server: {pre.edge ?? '–'}.
                {pre.warnings.length ? ` Hinweise: ${pre.warnings.join(', ')}` : ''}
              </span>
            </div>
          </div>
        ) : null}
        <div className="mt-16">
          <MicMeter />
        </div>
      </section>

      {isAdmin ? (
        <section className="section">
          <h2>Fehlerprotokoll</h2>
          <p className="muted">Fehler aus allen Browsern des Teams und von den Server-Funktionen (Twilio, Calendly, Kalender).</p>
          {logs.loading && !logs.data ? (
            <Loading />
          ) : !(logs.data ?? []).length ? (
            <p className="small muted">Keine Einträge. Sehr gut.</p>
          ) : (
            <div className="panel">
              {(logs.data ?? []).map((l) => (
                <details key={l.id} className="list-item" style={{ display: 'block' }}>
                  <summary style={{ cursor: 'pointer' }}>
                    <span className="small muted">{formatDateTime(l.at)}</span>{' '}
                    <Tag tone={l.level === 'error' ? 'red' : l.level === 'warn' ? 'amber' : 'soft'}>{l.source}</Tag>{' '}
                    {l.message}
                  </summary>
                  <pre className="xs" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', margin: '8px 0 0' }}>{JSON.stringify(l.details, null, 2)}</pre>
                </details>
              ))}
            </div>
          )}
        </section>
      ) : null}

      {report ? (
        <Modal title="Fehlerbericht" onClose={() => setReport(null)} wide>
          <p className="small muted" style={{ marginBottom: 8 }}>
            Automatisches Kopieren ist hier gesperrt. Text markieren, kopieren und in den Chat mit Claude einfügen.
          </p>
          <textarea
            id="report-text"
            className="textarea num"
            readOnly
            value={report}
            style={{ minHeight: 260, fontSize: 12 }}
            onFocus={(e) => e.target.select()}
            autoFocus
          />
        </Modal>
      ) : null}
    </>
  );
}
