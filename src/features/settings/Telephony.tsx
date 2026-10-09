import { AlertTriangle, CheckCircle2, Circle, RefreshCw, Square, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { useApp } from '../../app/context.tsx';
import { useAsync } from '../../app/hooks.ts';
import { formatDuration, formatPhone, normalizePhone } from '../../lib/format.ts';
import type { OrgSettings } from '../../lib/types.ts';
import { toWav } from '../../lib/wav.ts';
import { errMsg, Field, Loading, useUi } from '../../ui/ui.tsx';
import { useRecorder } from './audio.tsx';

interface TwilioStatus {
  twilio: { connected: boolean; ready: boolean; account?: { name: string; status: string; type: string }; voiceUrlOk?: boolean; error?: string };
}

interface SetupResult {
  account: { name: string; status: string; type: string };
  numbers: { number: string; label: string }[];
  callerIds: { number: string; label: string; kind: string }[];
  warnings: string[];
}

export default function Telephony() {
  const { store, ref, reloadRef, demo } = useApp();
  const { toast } = useUi();
  const status = useAsync(() => store.admin<TwilioStatus>('status'), [store]);
  const [sid, setSid] = useState('');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SetupResult | null>(null);
  const org = ref.org;

  const saveOrg = async (patch: Partial<OrgSettings>) => {
    try {
      await store.updateOrg(patch);
      await reloadRef();
      toast('Gespeichert.');
    } catch (e) {
      toast(errMsg(e), { kind: 'error' });
    }
  };

  const connect = async () => {
    setBusy(true);
    try {
      const r = await store.admin<SetupResult>('twilio_connect', { accountSid: sid, authToken: token });
      setResult(r);
      setToken('');
      await reloadRef();
      status.reload();
      toast('Twilio ist verbunden.');
    } catch (e) {
      toast(errMsg(e), { kind: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const resync = async () => {
    setBusy(true);
    try {
      const r = await store.admin<SetupResult>('twilio_setup');
      setResult(r);
      await reloadRef();
      status.reload();
      toast('Twilio neu eingerichtet.');
    } catch (e) {
      toast(errMsg(e), { kind: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const tw = status.data?.twilio;

  return (
    <>
      <section className="section">
        <h2>Twilio verbinden</h2>
        <p className="muted">
          Twilio stellt die Telefonleitung. Gesprochen wird über den Server in Frankfurt (Ausweich: Dublin) – das hält die
          Verzögerung klein. Du brauchst nur Account SID und Auth Token aus der Twilio-Konsole (Startseite, Bereich
          „Account Info“). Alles Weitere richtet das CRM selbst ein.
        </p>
        {status.loading && !status.data ? (
          <Loading />
        ) : tw?.ready ? (
          <div className="callout ok" style={{ marginBottom: 12 }}>
            <CheckCircle2 />
            <span>
              Verbunden{tw.account ? ` mit „${tw.account.name}“ (${tw.account.type === 'Trial' ? 'Testkonto' : 'Vollkonto'}, ${tw.account.status === 'active' ? 'aktiv' : tw.account.status})` : ''}.
              {tw.voiceUrlOk === false ? ' Die Anruf-Adresse stimmt nicht mehr – bitte „Neu einrichten“ drücken.' : ''}
            </span>
          </div>
        ) : tw?.connected ? (
          <div className="callout warn" style={{ marginBottom: 12 }}>
            <AlertTriangle />
            <span>Zugangsdaten gespeichert, Einrichtung aber unvollständig. Bitte „Neu einrichten“ drücken.</span>
          </div>
        ) : null}
        {tw?.error ? <div className="callout err" style={{ marginBottom: 12 }}><AlertTriangle /><span>{tw.error}</span></div> : null}
        <div className="form-grid">
          <Field label="Account SID">
            <input className="input" value={sid} onChange={(e) => setSid(e.target.value.trim())} placeholder="AC…" autoComplete="off" spellCheck={false} />
          </Field>
          <Field label="Auth Token">
            <input className="input" type="password" value={token} onChange={(e) => setToken(e.target.value.trim())} autoComplete="off" />
          </Field>
        </div>
        <div className="row wrap mt-16">
          <button type="button" className="btn primary" onClick={connect} disabled={busy || !sid || !token || demo}>
            {tw?.connected ? 'Zugangsdaten ersetzen' : 'Verbinden & einrichten'}
          </button>
          {tw?.connected ? (
            <button type="button" className="btn" onClick={resync} disabled={busy}>
              <RefreshCw className={busy ? 'spin' : undefined} /> Neu einrichten
            </button>
          ) : null}
        </div>
        {result ? (
          <div className="col mt-16">
            {result.warnings.map((w) => (
              <div className="callout warn" key={w}><AlertTriangle /><span>{w}</span></div>
            ))}
            <div className="small">
              Nummern bei Twilio: {result.numbers.length ? result.numbers.map((n) => formatPhone(n.number)).join(', ') : 'keine'}
            </div>
          </div>
        ) : null}
      </section>

      <section className="section">
        <h2>Ausgehende Anrufe</h2>
        <DefaultCallerId value={org.default_caller_id} options={[...ref.phoneNumbers.map((n) => n.number), ...(result?.callerIds ?? []).map((c) => c.number)]} onSave={(v) => saveOrg({ default_caller_id: v })} />
        <div className="col gap-8 mt-16">
          <label className="check" style={{ alignItems: 'flex-start' }}>
            <input type="checkbox" checked={org.local_presence} onChange={(e) => saveOrg({ local_presence: e.target.checked })} style={{ marginTop: 3 }} />
            <span>
              <strong>Local Presence</strong>
              <br />
              <span className="small muted">
                Wenn ihr eine Nummer mit derselben Vorwahl wie der Angerufene habt, wird automatisch diese angezeigt. Ortsnahe Nummern
                werden häufiger angenommen. Telefonnummern verwaltest du unter <a href="#/settings/numbers">Telefonnummern</a>.
              </span>
            </span>
          </label>
          <label className="check" style={{ alignItems: 'flex-start' }}>
            <input type="checkbox" checked={org.conference_mode} onChange={(e) => saveOrg({ conference_mode: e.target.checked })} style={{ marginTop: 3 }} />
            <span>
              <strong>Mithören, Einflüstern, Aufschalten und Übergabe mit Rücksprache</strong>
              <br />
              <span className="small muted">
                Ausgehende Gespräche laufen dann als Konferenz über den Twilio-Server in Frankfurt. Teamleiter können live zuhören, nur
                für den Kollegen hörbar Tipps geben oder sich dazuschalten. Kostet pro Teilnehmer etwas mehr (siehe EINRICHTUNG.md,
                Kosten). Aufgenommen wird dann die Leitung des Kunden, weiter mit zwei getrennten Spuren. Sind „Wir“ und „Kunde“ in
                einer Aufnahme vertauscht, hilft im Gespräch der Knopf „Spuren tauschen“.
              </span>
            </span>
          </label>
        </div>
        <div className="form-grid mt-16">
          <Field label="Power Dialer: klingeln lassen" hint="Danach gilt der Anruf als „nicht erreicht“ und der nächste Lead kommt.">
            <select className="select" value={org.dialer_ring_timeout} onChange={(e) => saveOrg({ dialer_ring_timeout: Number(e.target.value) })}>
              {[15, 20, 25, 30, 40, 50, 60].map((s) => (
                <option key={s} value={s}>{s} Sekunden</option>
              ))}
            </select>
          </Field>
          <Field label="Power Dialer: kürzlich Angerufene überspringen">
            <select className="select" value={org.dialer_skip_recent_minutes} onChange={(e) => saveOrg({ dialer_skip_recent_minutes: Number(e.target.value) })}>
              <option value={0}>Nie überspringen</option>
              <option value={60}>Letzte Stunde</option>
              <option value={240}>Letzte 4 Stunden</option>
              <option value={1440}>Letzte 24 Stunden</option>
            </select>
          </Field>
          <Field label="Ergebnis bei „Mailbox-Nachricht hinterlassen“">
            <select className="select" value={org.voicemail_drop_outcome ?? ''} onChange={(e) => saveOrg({ voicemail_drop_outcome: e.target.value || null })}>
              <option value="">– keins –</option>
              {ref.outcomes.map((o) => (
                <option key={o.key} value={o.key}>{o.label}</option>
              ))}
            </select>
          </Field>
        </div>
      </section>

      <section className="section">
        <h2>Eingehende Anrufe & Mailbox</h2>
        <div className="form-grid">
          <Field label="Klingeln lassen">
            <select className="select" value={org.inbound_ring_timeout} onChange={(e) => saveOrg({ inbound_ring_timeout: Number(e.target.value) })}>
              {[15, 20, 25, 30, 40, 60].map((s) => (
                <option key={s} value={s}>{s} Sekunden</option>
              ))}
            </select>
          </Field>
          <Field label="Verpasste Anrufe">
            <label className="check">
              <input type="checkbox" checked={org.missed_call_tasks} onChange={(e) => saveOrg({ missed_call_tasks: e.target.checked })} />
              Als Aufgabe in die Inbox
            </label>
          </Field>
          <Field label="Erlaubte Länder für ausgehende Anrufe" hint="Schutz vor teuren Fehlwahlen, z. B. +49, +43, +41">
            <input
              className="input"
              defaultValue={org.allowed_prefixes.join(', ')}
              onBlur={(e) => {
                const list = e.target.value.split(/[,\s]+/).map((x) => x.trim()).filter((x) => /^\+\d{1,4}$/.test(x));
                if (list.join(',') !== org.allowed_prefixes.join(',')) saveOrg({ allowed_prefixes: list });
              }}
            />
          </Field>
        </div>
        <Greeting />
      </section>
    </>
  );
}

function DefaultCallerId({ value, options, onSave }: { value: string | null; options: string[]; onSave: (v: string | null) => void }) {
  const [custom, setCustom] = useState('');
  const unique = [...new Set([...(value ? [value] : []), ...options])];
  return (
    <div className="form-grid">
      <Field label="Standard-Absendernummer" hint="Diese Nummer sehen die Angerufenen, wenn für die Person keine eigene hinterlegt ist.">
        <select className="select" value={value ?? ''} onChange={(e) => onSave(e.target.value || null)}>
          <option value="">– keine –</option>
          {unique.map((n) => (
            <option key={n} value={n}>{formatPhone(n)}</option>
          ))}
        </select>
      </Field>
      <Field label="Andere bestätigte Nummer" hint="z. B. eure Festnetznummer, wenn sie in Twilio unter Verified Caller IDs bestätigt ist.">
        <div className="row">
          <input className="input" value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="069 …" />
          <button type="button" className="btn" disabled={!normalizePhone(custom)} onClick={() => onSave(normalizePhone(custom))}>
            Übernehmen
          </button>
        </div>
      </Field>
    </div>
  );
}

function Greeting() {
  const { store, ref, reloadRef } = useApp();
  const { toast } = useUi();
  const rec = useRecorder();
  const [text, setText] = useState(ref.org.voicemail_greeting_text);
  const file = useRef<HTMLInputElement>(null);

  const saveText = async () => {
    await store.updateOrg({ voicemail_greeting_text: text });
    await reloadRef();
    toast('Ansage gespeichert.');
  };

  const saveAudio = async (blob: Blob) => {
    try {
      const { wav } = await toWav(blob);
      const path = await store.uploadGreeting(wav);
      await store.updateOrg({ voicemail_greeting_path: path });
      await reloadRef();
      rec.setBlob(null);
      toast('Eigene Ansage gespeichert.');
    } catch (e) {
      toast(errMsg(e), { kind: 'error' });
    }
  };

  return (
    <div className="col mt-16">
      <div className="label">Mailbox-Ansage, wenn niemand abnimmt</div>
      {ref.org.voicemail_greeting_path ? (
        <div className="row wrap">
          <span className="small">Eigene Aufnahme aktiv.</span>
          <button type="button" className="btn small ghost" onClick={async () => { await store.updateOrg({ voicemail_greeting_path: null }); await reloadRef(); }}>
            Stattdessen Text vorlesen lassen
          </button>
        </div>
      ) : (
        <>
          <textarea className="textarea" value={text} onChange={(e) => setText(e.target.value)} />
          <div className="row wrap">
            <button type="button" className="btn small" onClick={saveText} disabled={text === ref.org.voicemail_greeting_text}>
              Text speichern
            </button>
            <span className="small muted">oder eigene Ansage:</span>
            {rec.recording ? (
              <button type="button" className="btn small danger" onClick={rec.stop}>
                <Square /> Stopp ({formatDuration(rec.seconds)})
              </button>
            ) : (
              <button type="button" className="btn small" onClick={rec.start}>
                <Circle color="var(--signal)" /> Aufnehmen
              </button>
            )}
            <button type="button" className="btn small ghost" onClick={() => file.current?.click()}>
              <Upload /> Datei
            </button>
            <input ref={file} type="file" accept="audio/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) saveAudio(f); e.target.value = ''; }} />
          </div>
          {rec.blob ? (
            <div className="row wrap">
              {rec.url ? <audio controls src={rec.url} style={{ maxWidth: '100%' }} /> : null}
              <button type="button" className="btn small primary" onClick={() => saveAudio(rec.blob!)}>Als Ansage verwenden</button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
