// Umzug aus Close: Einstellungen und Daten über die Close-Schnittstelle übernehmen – in Etappen,
// jederzeit fortsetzbar. Bereits übernommene Einträge werden nicht doppelt angelegt.

import { CheckCircle2, CircleDashed, Download, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '../../app/context.tsx';
import { formatNumber } from '../../lib/format.ts';
import { errMsg, Field, useUi } from '../../ui/ui.tsx';

interface ConnectResult {
  organization: string;
  counts: { leads: number; contacts: number; opportunities: number; activities: number };
  users?: { id: string; name: string; email: string; match: string | null }[];
}

interface StageResult {
  done: boolean;
  cursor?: string | null;
  processed?: number;
  total?: number;
  imported?: Record<string, number>;
  warnings?: string[];
}

const STAGES: { id: string; label: string; hint: string; default: boolean }[] = [
  { id: 'config', label: 'Einstellungen', hint: 'Status, Pipelines, Anruf-Ergebnisse, Felder, eigene Aktivitäten, Vorlagen, Smart Views', default: true },
  { id: 'leads', label: 'Leads & Kontakte', hint: 'mit allen Feldern, Zuständigen und Nummern', default: true },
  { id: 'opportunities', label: 'Opportunities', hint: 'mit Pipeline, Phase und Wert', default: true },
  { id: 'activities', label: 'Verlauf', hint: 'Notizen, Anrufe, E-Mails, SMS, eigene Aktivitäten, Statuswechsel', default: true },
  { id: 'tasks', label: 'Offene Aufgaben', hint: 'Wiedervorlagen und Rückrufe', default: true },
  { id: 'recordings', label: 'Gesprächsaufnahmen', hint: 'lädt die Tondateien aus Close herunter (dauert am längsten)', default: false },
];

export default function CloseImport() {
  const { store, reloadRef, demo } = useApp();
  const { toast } = useUi();
  const [key, setKey] = useState('');
  const [conn, setConn] = useState<ConnectResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string[]>(STAGES.filter((s) => s.default).map((s) => s.id));
  const [progress, setProgress] = useState<Record<string, { state: 'wait' | 'run' | 'done' | 'error'; processed: number; total: number; note?: string }>>({});
  const [warnings, setWarnings] = useState<string[]>([]);

  const connect = async () => {
    setBusy(true);
    try {
      const r = await store.admin<ConnectResult>('close_connect', { apiKey: key });
      setConn(r);
      setKey('');
    } catch (e) {
      toast(errMsg(e), { kind: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const run = async () => {
    setBusy(true);
    setWarnings([]);
    const init = Object.fromEntries(selected.map((s) => [s, { state: 'wait' as const, processed: 0, total: 0 }]));
    setProgress(init);
    try {
      for (const stage of STAGES.filter((s) => selected.includes(s.id))) {
        let cursor: string | null = null;
        let processed = 0;
        setProgress((p) => ({ ...p, [stage.id]: { ...p[stage.id], state: 'run' } }));
        for (let guard = 0; guard < 5000; guard++) {
          const r: StageResult = await store.admin<StageResult>('close_import', { stage: stage.id, cursor });
          processed += r.processed ?? 0;
          cursor = r.cursor ?? null;
          if (r.warnings?.length) setWarnings((w) => [...w, ...r.warnings!]);
          setProgress((p) => ({ ...p, [stage.id]: { state: r.done ? 'done' : 'run', processed, total: r.total ?? p[stage.id]?.total ?? 0 } }));
          if (r.done) break;
        }
      }
      await reloadRef();
      toast('Umzug abgeschlossen.');
    } catch (e) {
      toast(errMsg(e), { kind: 'error' });
      setProgress((p) => Object.fromEntries(Object.entries(p).map(([k, v]) => [k, v.state === 'run' ? { ...v, state: 'error', note: errMsg(e) } : v])));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <section className="section">
        <h2>Umzug aus Close</h2>
        <p className="muted">
          Übernimmt eure Einrichtung und alle Daten aus Close in Etappen. Ihr könnt Close parallel weiterbenutzen und den Umzug später
          erneut starten – schon übernommene Leads und Aktivitäten werden erkannt und nicht doppelt angelegt.
        </p>
        <ol className="steps-list">
          <li>In Close unter <strong>Settings → Developer → API Keys</strong> einen neuen Schlüssel anlegen.</li>
          <li>Hier eintragen und „Verbinden“ drücken. Der Schlüssel wird nur auf dem Server gespeichert.</li>
          <li>Auswählen, was übernommen wird, und den Umzug starten. Das Fenster dabei offen lassen.</li>
        </ol>
        {!conn ? (
          <div className="form-grid mt-12">
            <Field label="Close API-Schlüssel">
              <input className="input" type="password" value={key} onChange={(e) => setKey(e.target.value.trim())} autoComplete="off" placeholder="api_…" />
            </Field>
            <div style={{ alignSelf: 'end' }}>
              <button type="button" className="btn primary" onClick={connect} disabled={busy || !key}>
                Verbinden
              </button>
            </div>
          </div>
        ) : (
          <div className="callout ok mt-12">
            <CheckCircle2 />
            <span>
              Verbunden mit „{conn.organization}“: {formatNumber(conn.counts.leads)} Leads, {formatNumber(conn.counts.contacts)} Kontakte,{' '}
              {formatNumber(conn.counts.opportunities)} Opportunities, rund {formatNumber(conn.counts.activities)} Aktivitäten.
            </span>
          </div>
        )}
        {demo ? <p className="small muted mt-8">In der Demo wird nichts aus Close geladen.</p> : null}
      </section>

      {conn ? (
        <section className="section">
          <h2>Was soll übernommen werden?</h2>
          <div className="col gap-8">
            {STAGES.map((s) => {
              const pr = progress[s.id];
              return (
                <label key={s.id} className="check" style={{ alignItems: 'flex-start' }}>
                  <input type="checkbox" checked={selected.includes(s.id)} disabled={busy} onChange={(e) => setSelected((cur) => (e.target.checked ? [...cur, s.id] : cur.filter((x) => x !== s.id)))} style={{ marginTop: 3 }} />
                  <span className="grow">
                    <strong>{s.label}</strong>
                    <br />
                    <span className="small muted">{s.hint}</span>
                  </span>
                  {pr ? (
                    <span className="small nowrap row gap-4">
                      {pr.state === 'run' ? <Loader2 size={15} className="spin" /> : pr.state === 'done' ? <CheckCircle2 size={15} className="ok-icon" /> : <CircleDashed size={15} />}
                      {pr.total ? `${formatNumber(pr.processed)} / ${formatNumber(pr.total)}` : pr.processed ? formatNumber(pr.processed) : pr.state === 'done' ? 'fertig' : ''}
                    </span>
                  ) : null}
                </label>
              );
            })}
          </div>
          {conn.users?.length ? (
            <div className="mt-16">
              <h3>Benutzer</h3>
              <p className="small muted">Aktivitäten werden der Person mit derselben E-Mail-Adresse zugeordnet. Wer hier noch fehlt, bitte vorher unter <a href="#/settings/team">Benutzer</a> anlegen.</p>
              <ul className="plain-list">
                {conn.users.map((u) => (
                  <li key={u.id} className="small">
                    {u.name} ({u.email}): {u.match ? <strong>{u.match}</strong> : <span className="muted">kein Benutzer im CRM – wird ohne Person übernommen</span>}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <button type="button" className="btn primary mt-16" onClick={run} disabled={busy || !selected.length}>
            <Download /> {busy ? 'Umzug läuft…' : 'Umzug starten'}
          </button>
          {warnings.length ? (
            <details className="mt-12">
              <summary className="small">{warnings.length} Hinweise</summary>
              <ul className="plain-list small muted">
                {warnings.slice(0, 200).map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </details>
          ) : null}
        </section>
      ) : null}
    </>
  );
}
