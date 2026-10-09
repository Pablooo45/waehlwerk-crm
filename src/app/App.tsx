import { useCallback, useEffect, useState } from 'react';
import { config } from '../lib/config.ts';
import { createPhone } from '../lib/phone/index.ts';
import type { Phone } from '../lib/phone/types.ts';
import { createStore, type Store } from '../lib/store/index.ts';
import type { DemoStore } from '../lib/store/demoStore.ts';
import type { SupabaseStore } from '../lib/store/supabaseStore.ts';
import type { Profile, RefData } from '../lib/types.ts';
import { Avatar, errMsg, Field, Loading, Modal, useUi } from '../ui/ui.tsx';
import { AppProvider } from './context.tsx';
import { Shell } from './Shell.tsx';

type Phase =
  | { kind: 'boot' }
  | { kind: 'error'; message: string }
  | { kind: 'login'; store: Store }
  | { kind: 'ready'; store: Store; ref: RefData; phone: Phone };

// Bei „Automatisch“ fasst das CRM das Attribut nicht an – eine Wahl des Umfelds (z. B. der Vorschau-Ansicht) bleibt erhalten.
const HOST_THEME = typeof document !== 'undefined' ? document.documentElement.dataset.theme : undefined;
let themeSetByApp = false;

function applyTheme(theme: string | undefined) {
  const root = document.documentElement;
  if (theme === 'light' || theme === 'dark') {
    root.dataset.theme = theme;
    themeSetByApp = true;
  } else if (themeSetByApp) {
    if (HOST_THEME) root.dataset.theme = HOST_THEME;
    else delete root.dataset.theme;
    themeSetByApp = false;
  }
}

export function App() {
  const [phase, setPhase] = useState<Phase>({ kind: 'boot' });
  const [recovery, setRecovery] = useState(false);

  const enter = useCallback(async (store: Store) => {
    const ref = await store.loadRef();
    applyTheme(ref.me.settings.theme);
    const phone = await createPhone(store, () => ref.me.id, (msg, details) => store.logClientError(msg, details ?? {}));
    setPhase({ kind: 'ready', store, ref, phone });
    // Nur wer telefonieren darf, bekommt das Browser-Telefon (und damit auch eingehende Anrufe)
    if (ref.perms.includes('calling')) phone.start().catch((e) => store.logClientError(`Telefon-Start: ${errMsg(e)}`));
    const s = ref.me.settings;
    if (s.inputDeviceId || s.outputDeviceId) phone.setDevices(s.inputDeviceId, s.outputDeviceId).catch(() => undefined);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const store = await createStore();
        if (cancelled) return;
        if (store.mode === 'live') {
          (store as SupabaseStore).onPasswordRecovery?.(() => setRecovery(true));
        }
        window.addEventListener('error', (ev) => store.logClientError(ev.message, { file: ev.filename, line: ev.lineno, page: location.hash }));
        window.addEventListener('unhandledrejection', (ev) => store.logClientError(`Unbehandelt: ${errMsg(ev.reason)}`, { page: location.hash }));
        const me = await store.currentUser().catch((e) => {
          setPhase({ kind: 'error', message: errMsg(e) });
          return undefined;
        });
        if (me === undefined || cancelled) return;
        if (!me) setPhase({ kind: 'login', store });
        else await enter(store);
      } catch (e) {
        setPhase({ kind: 'error', message: errMsg(e) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enter]);

  if (phase.kind === 'boot') return <Loading label="Starte…" />;
  if (phase.kind === 'error') {
    return (
      <div className="center" style={{ minHeight: '100%' }}>
        <div className="section" style={{ maxWidth: 520 }}>
          <h2>Das CRM konnte nicht starten</h2>
          <p className="muted mt-8">{phase.message}</p>
          <button type="button" className="btn primary mt-16" onClick={() => location.reload()}>
            Neu laden
          </button>
        </div>
      </div>
    );
  }
  if (phase.kind === 'login') {
    return (
      <Login
        store={phase.store}
        onSignedIn={async () => {
          try {
            await enter(phase.store);
          } catch (e) {
            setPhase({ kind: 'error', message: errMsg(e) });
          }
        }}
      />
    );
  }
  return (
    <>
      <AppProvider
        store={phase.store}
        refData={phase.ref}
        setRefData={(ref) => {
          applyTheme(ref.me.settings.theme);
          setPhase((p) => (p.kind === 'ready' ? { ...p, ref } : p));
        }}
        phone={phase.phone}
        onSignOut={() => setPhase({ kind: 'login', store: phase.store })}
      >
        <Shell />
      </AppProvider>
      {recovery ? <NewPasswordModal store={phase.store} onClose={() => setRecovery(false)} /> : null}
    </>
  );
}

function NewPasswordModal({ store, onClose }: { store: Store; onClose: () => void }) {
  const { toast } = useUi();
  const [pw, setPw] = useState('');
  const save = async () => {
    if (pw.length < 8) {
      toast('Mindestens 8 Zeichen.', { kind: 'error' });
      return;
    }
    try {
      await store.changePassword(pw);
      toast('Neues Passwort gespeichert.');
      onClose();
    } catch (e) {
      toast(errMsg(e), { kind: 'error' });
    }
  };
  return (
    <Modal
      title="Neues Passwort festlegen"
      onClose={onClose}
      footer={
        <button type="button" className="btn primary" onClick={save}>
          Passwort speichern
        </button>
      }
    >
      <Field label="Neues Passwort">
        <input className="input" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
      </Field>
    </Modal>
  );
}

function Switchboard() {
  // Lämpchen wie an einem alten Vermittlungsschrank
  const lamps = Array.from({ length: 32 }, (_, i) => (i % 7 === 2 || i % 11 === 5 ? 'on' : i % 13 === 8 ? 'ring' : ''));
  return (
    <div className="switchboard" aria-hidden="true">
      {lamps.map((c, i) => (
        <span key={i} className={c} />
      ))}
    </div>
  );
}

function Login({ store, onSignedIn }: { store: Store; onSignedIn: () => void }) {
  const { toast } = useUi();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [forgot, setForgot] = useState(false);
  const demoUsers: (Profile & { roleName: string })[] = store.mode === 'demo' ? (store as unknown as DemoStore).demoUsers() : [];

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setBusy(true);
    try {
      if (forgot) {
        await store.sendPasswordReset(email);
        toast('Wenn die Adresse bekannt ist, kommt gleich eine E-Mail zum Zurücksetzen.');
        setForgot(false);
      } else {
        await store.signIn(email, password);
        onSignedIn();
      }
    } catch (err) {
      toast(errMsg(err), { kind: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const demoLogin = async (id: string) => {
    setBusy(true);
    await store.signIn(id, '');
    onSignedIn();
  };

  return (
    <div className="login">
      <div className="login-art">
        <div className="row">
          <span className="line-dot ready" />
          <span className="brand-name">{config.appName}</span>
        </div>
        <div>
          <h1>Anrufen, notieren, Termin legen.</h1>
          <p>
            Das CRM fürs Telefon-Team: Power Dialer, Gesprächsaufnahmen und Termine aus Calendly und Google Kalender an
            einem Ort.
          </p>
        </div>
        <Switchboard />
      </div>
      <div className="login-form">
        <div className="login-card">
          {store.mode === 'demo' ? (
            <>
              <h2>Demo ansehen</h2>
              <p className="muted">
                Wähle, als wer du dich umsehen willst. Jede Person hat eine andere Rolle – so siehst du, was die Rechte bewirken.
                Es werden keine echten Anrufe geführt.
              </p>
              <div className="user-pick mt-16">
                {demoUsers.map((u) => (
                  <button key={u.id} type="button" onClick={() => demoLogin(u.id)} disabled={busy}>
                    <Avatar name={u.full_name} color={u.color} large />
                    <span className="grow">
                      <strong>{u.full_name}</strong>
                      <br />
                      <span className="small muted">
                        {{ opener: 'Opener', setter: 'Setter', closer: 'Closer', manager: 'Teamleitung', other: 'Team' }[u.team_function]}
                        , Rolle „{u.roleName}“
                      </span>
                    </span>
                  </button>
                ))}
              </div>
              <p className="small muted mt-12">
                Tipp: Als <strong>Alex (Admin)</strong> findest du unter Einstellungen → Team die Benutzer, Rollen &amp; Rechte und Gruppen.
              </p>
            </>
          ) : (
            <form onSubmit={submit} className="col gap-12">
              <h2>{forgot ? 'Passwort zurücksetzen' : 'Anmelden'}</h2>
              <Field label="E-Mail">
                <input className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </Field>
              {!forgot ? (
                <Field label="Passwort">
                  <input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
                </Field>
              ) : null}
              <button type="submit" className="btn primary large" disabled={busy}>
                {forgot ? 'Link zum Zurücksetzen senden' : 'Anmelden'}
              </button>
              <button type="button" className="btn ghost" onClick={() => setForgot(!forgot)}>
                {forgot ? 'Zurück zur Anmeldung' : 'Passwort vergessen?'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
