// Eigenes E-Mail-Postfach verbinden (IMAP/SMTP, z. B. IONOS): Mails aus dem CRM senden,
// Antworten landen automatisch beim Lead.

import { CheckCircle2, Mail, RefreshCw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '../../app/context.tsx';
import { formatRelative } from '../../lib/format.ts';
import type { EmailAccount } from '../../lib/types.ts';
import { RichTextEditor } from '../../ui/RichText.tsx';
import { errMsg, Field, useUi } from '../../ui/ui.tsx';
import { useSaver } from './shared.tsx';

const PRESETS: Record<string, { imap: string; smtp: string; label: string }> = {
  ionos: { imap: 'imap.ionos.de', smtp: 'smtp.ionos.de', label: 'IONOS' },
  google: { imap: 'imap.gmail.com', smtp: 'smtp.gmail.com', label: 'Google Workspace (App-Passwort)' },
  microsoft: { imap: 'outlook.office365.com', smtp: 'smtp.office365.com', label: 'Microsoft 365' },
  strato: { imap: 'imap.strato.de', smtp: 'smtp.strato.de', label: 'STRATO' },
  other: { imap: '', smtp: '', label: 'Anderer Anbieter' },
};

export default function Mailbox() {
  const { ref } = useApp();
  const account = ref.emailAccounts[0] ?? null;
  return account ? <Connected account={account} /> : <ConnectForm />;
}

function ConnectForm({ existing, onDone }: { existing?: EmailAccount; onDone?: () => void }) {
  const { store, me } = useApp();
  const { toast } = useUi();
  const save = useSaver();
  const [preset, setPreset] = useState('ionos');
  const [email, setEmail] = useState(existing?.email ?? me.email);
  const [name, setName] = useState(existing?.display_name ?? me.full_name);
  const [password, setPassword] = useState('');
  const [imap, setImap] = useState(existing?.imap_host ?? PRESETS.ionos.imap);
  const [smtp, setSmtp] = useState(existing?.smtp_host ?? PRESETS.ionos.smtp);
  const [busy, setBusy] = useState(false);
  const [tested, setTested] = useState<string | null>(null);

  const payload = () => ({ id: existing?.id, email, display_name: name, password, imap_host: imap, imap_port: 993, smtp_host: smtp, smtp_port: 465, username: email });

  const test = async () => {
    setBusy(true);
    try {
      const r = await store.emailAccount<{ imap: string; smtp: string }>('test', payload());
      setTested(`Posteingang: ${r.imap}. Postausgang: ${r.smtp}.`);
    } catch (e) {
      setTested(null);
      toast(errMsg(e), { kind: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    setBusy(true);
    const ok = await save(() => store.emailAccount('save', payload()), 'Postfach verbunden.');
    setBusy(false);
    if (ok) onDone?.();
  };

  return (
    <section className="section">
      <h2><Mail size={18} aria-hidden="true" /> E-Mail-Postfach verbinden</h2>
      <p className="muted">
        Dann verschickt das CRM E-Mails direkt aus deinem Postfach (sie liegen auch in deinem „Gesendet“-Ordner) und ordnet Antworten
        automatisch dem richtigen Lead zu. Das Passwort wird verschlüsselt auf dem Server gespeichert und nie im Browser angezeigt.
      </p>
      <div className="form-grid mt-8">
        <Field label="Anbieter">
          <select
            className="select"
            value={preset}
            onChange={(e) => {
              setPreset(e.target.value);
              const p = PRESETS[e.target.value];
              if (p.imap) {
                setImap(p.imap);
                setSmtp(p.smtp);
              }
            }}
          >
            {Object.entries(PRESETS).map(([k, p]) => (
              <option key={k} value={k}>{p.label}</option>
            ))}
          </select>
        </Field>
        <Field label="Absendername">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="E-Mail-Adresse">
          <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
        </Field>
        <Field label="Passwort des Postfachs" hint={preset === 'google' ? 'Bei Google ein App-Passwort verwenden.' : undefined}>
          <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
        </Field>
        <Field label="Posteingang (IMAP, Port 993)">
          <input className="input" value={imap} onChange={(e) => setImap(e.target.value)} />
        </Field>
        <Field label="Postausgang (SMTP, Port 465)">
          <input className="input" value={smtp} onChange={(e) => setSmtp(e.target.value)} />
        </Field>
      </div>
      {tested ? (
        <div className="callout ok mt-12"><CheckCircle2 /><span>{tested}</span></div>
      ) : null}
      <div className="row wrap mt-16">
        <button type="button" className="btn" onClick={test} disabled={busy || !email || !password || !imap || !smtp}>
          Verbindung testen
        </button>
        <button type="button" className="btn primary" onClick={submit} disabled={busy || !email || !password || !imap || !smtp}>
          Speichern
        </button>
        {onDone ? <button type="button" className="btn ghost" onClick={onDone}>Abbrechen</button> : null}
      </div>
    </section>
  );
}

function Connected({ account }: { account: EmailAccount }) {
  const { store } = useApp();
  const { confirm } = useUi();
  const save = useSaver();
  const [edit, setEdit] = useState(false);
  const [signature, setSignature] = useState(account.signature);
  const [syncing, setSyncing] = useState(false);

  if (edit) return <ConnectForm existing={account} onDone={() => setEdit(false)} />;

  return (
    <>
      <section className="section">
        <h2><Mail size={18} aria-hidden="true" /> E-Mail-Postfach</h2>
        <div className="callout ok"><CheckCircle2 /><span>Verbunden: <strong>{account.email}</strong> ({account.imap_host})</span></div>
        <p className="small muted mt-8">
          {account.last_error
            ? `Letzter Abruf fehlgeschlagen: ${account.last_error}`
            : account.last_sync_at
            ? `Zuletzt abgerufen ${formatRelative(account.last_sync_at)}. Neue Antworten kommen etwa jede Minute.`
            : 'Noch nicht abgerufen.'}
        </p>
        <div className="row wrap mt-12">
          <label className="check">
            <input type="checkbox" checked={account.sync_enabled} onChange={(e) => save(() => store.emailAccount('save', { id: account.id, email: account.email, sync_enabled: e.target.checked }))} />
            Antworten automatisch abrufen und zuordnen
          </label>
        </div>
        <div className="row wrap mt-12">
          <button
            type="button"
            className="btn"
            disabled={syncing}
            onClick={async () => {
              setSyncing(true);
              await save(() => store.emailAccount('sync', { id: account.id }), 'Postfach abgerufen.');
              setSyncing(false);
            }}
          >
            <RefreshCw className={syncing ? 'spin' : undefined} /> Jetzt abrufen
          </button>
          <button type="button" className="btn" onClick={() => setEdit(true)}>Zugang ändern</button>
          <button
            type="button"
            className="btn ghost"
            onClick={async () => {
              if (await confirm('Postfach trennen? Bereits zugeordnete E-Mails bleiben im CRM.', { danger: true, confirmLabel: 'Trennen' })) {
                save(() => store.emailAccount('delete', { id: account.id }), 'Postfach getrennt.');
              }
            }}
          >
            <Trash2 /> Trennen
          </button>
        </div>
      </section>
      <section className="section">
        <h2>Signatur</h2>
        <RichTextEditor value={signature} onChange={setSignature} minHeight={120} placeholder="Beste Grüße …" ariaLabel="Signatur" />
        <button type="button" className="btn primary mt-12" disabled={signature === account.signature} onClick={() => save(() => store.emailAccount('save', { id: account.id, email: account.email, signature }), 'Signatur gespeichert.')}>
          Speichern
        </button>
      </section>
    </>
  );
}
