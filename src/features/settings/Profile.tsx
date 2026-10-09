import { useEffect, useState } from 'react';
import { useApp } from '../../app/context.tsx';
import { normalizePhone } from '../../lib/format.ts';
import { permissionLabel, visibilityLabel } from '../../lib/perms.ts';
import type { Profile as ProfileRow, UserSettings } from '../../lib/types.ts';
import { errMsg, Field, Segmented, useUi } from '../../ui/ui.tsx';
import { askMic, listDevices, micErrorText, MicMeter } from './audio.tsx';

// Kräftige Farben, auf denen weiße Initialen gut lesbar bleiben.
const AVATAR_COLORS = ['#2346a0', '#0e8a5f', '#2f6f5e', '#b45309', '#7c3aed', '#b42318', '#0e7490', '#be185d', '#475569'];

export default function Profile() {
  const { store, me, ref, reloadRef, phone, demo } = useApp();
  const { toast } = useUi();
  const [name, setName] = useState(me.full_name);
  const [color, setColor] = useState(me.color);
  const [pw, setPw] = useState('');
  const [forward, setForward] = useState(me.forward_number ?? '');
  const [forwardMode, setForwardMode] = useState<ProfileRow['forward_mode']>(me.forward_mode === 'never' ? 'no_answer' : me.forward_mode);
  const role = ref.roles.find((r) => r.id === me.role_id);
  const [devices, setDevices] = useState<{ inputs: MediaDeviceInfo[]; outputs: MediaDeviceInfo[]; labeled: boolean }>({ inputs: [], outputs: [], labeled: false });
  const s = me.settings;

  useEffect(() => {
    listDevices().then(setDevices).catch(() => undefined);
  }, []);

  const saveSettings = async (patch: Partial<UserSettings>) => {
    try {
      await store.updateMyProfile({ settings: { ...me.settings, ...patch } });
      await reloadRef();
      if ('inputDeviceId' in patch || 'outputDeviceId' in patch) {
        const next = { ...me.settings, ...patch };
        await phone.setDevices(next.inputDeviceId, next.outputDeviceId);
      }
      toast('Gespeichert.');
    } catch (e) {
      toast(errMsg(e), { kind: 'error' });
    }
  };

  const saveName = async () => {
    try {
      await store.updateMyProfile({ full_name: name.trim(), color });
      await reloadRef();
      toast('Gespeichert.');
    } catch (e) {
      toast(errMsg(e), { kind: 'error' });
    }
  };

  const saveCalls = async (patch: Partial<Pick<ProfileRow, 'available' | 'forward_number' | 'forward_mode'>>) => {
    try {
      await store.updateMyProfile(patch);
      await reloadRef();
      toast('Gespeichert.');
    } catch (e) {
      toast(errMsg(e), { kind: 'error' });
    }
  };

  const changePw = async () => {
    if (pw.length < 8) {
      toast('Das Passwort braucht mindestens 8 Zeichen.', { kind: 'error' });
      return;
    }
    try {
      await store.changePassword(pw);
      setPw('');
      toast('Passwort geändert.');
    } catch (e) {
      toast(errMsg(e), { kind: 'error' });
    }
  };

  const allowMic = async () => {
    try {
      await askMic();
      setDevices(await listDevices());
    } catch (e) {
      toast(micErrorText(e), { kind: 'error' });
    }
  };

  const notify = async (on: boolean) => {
    if (on && typeof Notification !== 'undefined' && Notification.permission !== 'granted') {
      const res = await Notification.requestPermission();
      if (res !== 'granted') {
        toast('Benachrichtigungen wurden im Browser nicht erlaubt.', { kind: 'error' });
        return;
      }
    }
    saveSettings({ notifications: on });
  };

  return (
    <>
      <section className="section">
        <h2>Mein Profil</h2>
        <p className="muted">{me.email}</p>
        <div className="form-grid">
          <Field label="Name">
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Farbe (Avatar)">
            <div className="swatches" role="radiogroup" aria-label="Farbe">
              {AVATAR_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={color.toLowerCase() === c}
                  aria-label={`Farbe ${c}`}
                  className="swatch"
                  style={{ background: c }}
                  onClick={() => setColor(c)}
                />
              ))}
              <input className="swatch-custom" type="color" value={color} onChange={(e) => setColor(e.target.value)} aria-label="Eigene Farbe" title="Eigene Farbe" />
            </div>
          </Field>
        </div>
        <button type="button" className="btn primary mt-16" onClick={saveName}>Speichern</button>
      </section>

      <section className="section">
        <h2>Meine Rolle</h2>
        <p>
          <strong>{role?.name ?? me.role_id}</strong>
          {role?.description ? <span className="muted"> – {role.description}</span> : null}
        </p>
        <p className="small muted mt-4">Sichtbare Leads: {visibilityLabel(ref.visibility)}. Ändern kann das ein Admin unter Einstellungen → Benutzer.</p>
        <details className="mt-8">
          <summary className="small">Meine Rechte ({ref.perms.length})</summary>
          <ul className="plain-list small mt-8 perm-list">
            {ref.perms.map((p) => (
              <li key={p}>{permissionLabel(p)}</li>
            ))}
          </ul>
        </details>
      </section>

      <section className="section">
        <h2>Erreichbarkeit</h2>
        <label className="check">
          <input type="checkbox" checked={me.available} onChange={(e) => saveCalls({ available: e.target.checked })} />
          Ich bin für eingehende Anrufe erreichbar
        </label>
        <p className="small muted mt-4">Ausgeschaltet („Nicht stören“) klingelt es bei dir nicht; Anrufe gehen an Kollegen, an dein Handy (wenn unten eingetragen) oder auf die Mailbox.</p>
        <div className="form-grid mt-12">
          <Field label="Handynummer für Weiterleitung" hint={forward && !normalizePhone(forward) ? 'Die Nummer ist ungültig.' : 'Optional. Leer lassen, wenn nichts weitergeleitet werden soll.'}>
            <input className="input" type="tel" value={forward} onChange={(e) => setForward(e.target.value)} placeholder="0151 …" />
          </Field>
          <Field label="Wann aufs Handy?">
            <select className="select" value={forwardMode} onChange={(e) => setForwardMode(e.target.value as ProfileRow['forward_mode'])} disabled={!forward}>
              <option value="no_answer">Wenn ich im CRM nicht abnehme oder nicht erreichbar bin</option>
              <option value="always">Immer direkt aufs Handy</option>
            </select>
          </Field>
        </div>
        <button
          type="button"
          className="btn mt-12"
          disabled={!!forward && !normalizePhone(forward)}
          onClick={() => saveCalls({ forward_number: forward ? normalizePhone(forward) : null, forward_mode: forward ? forwardMode : 'never' })}
        >
          Weiterleitung speichern
        </button>
      </section>

      <section className="section">
        <h2>Darstellung</h2>
        <p className="muted">Hell, dunkel oder wie dein Gerät eingestellt ist.</p>
        <Segmented
          value={s.theme ?? 'system'}
          onChange={(theme) => saveSettings({ theme })}
          options={[
            { value: 'system', label: 'Automatisch' },
            { value: 'light', label: 'Hell' },
            { value: 'dark', label: 'Dunkel' },
          ]}
        />
      </section>

      <section className="section">
        <h2>Headset & Mikrofon</h2>
        <p className="muted">
          Am besten ein kabelgebundenes USB-Headset nutzen. Bluetooth kann Verzögerungen und schlechtere Qualität verursachen.
        </p>
        {!devices.labeled ? (
          <button type="button" className="btn" onClick={allowMic}>Mikrofon erlauben & Geräte anzeigen</button>
        ) : (
          <div className="form-grid">
            <Field label="Mikrofon">
              <select className="select" value={s.inputDeviceId ?? ''} onChange={(e) => saveSettings({ inputDeviceId: e.target.value || undefined })}>
                <option value="">Standard</option>
                {devices.inputs.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>{d.label || 'Mikrofon'}</option>
                ))}
              </select>
            </Field>
            <Field label="Lautsprecher / Kopfhörer" hint={!devices.outputs.length ? 'Dein Browser erlaubt keine Auswahl – es wird das Standardgerät genutzt.' : undefined}>
              <select className="select" value={s.outputDeviceId ?? ''} onChange={(e) => saveSettings({ outputDeviceId: e.target.value || undefined })} disabled={!devices.outputs.length}>
                <option value="">Standard</option>
                {devices.outputs.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>{d.label || 'Ausgabe'}</option>
                ))}
              </select>
            </Field>
          </div>
        )}
        <div className="mt-16">
          <MicMeter deviceId={s.inputDeviceId} />
        </div>
      </section>

      <section className="section">
        <h2>Power Dialer</h2>
        <div className="form-grid">
          <Field label="Vorbereitungszeit vor dem Wählen" hint="Zeit, um den Lead kurz anzusehen.">
            <select className="select" value={s.dialerPrepare ?? 1} onChange={(e) => saveSettings({ dialerPrepare: Number(e.target.value) })}>
              {[0, 1, 2, 3, 5, 8].map((n) => (
                <option key={n} value={n}>{n === 0 ? 'sofort wählen' : n === 1 ? '1 Sekunde' : `${n} Sekunden`}</option>
              ))}
            </select>
          </Field>
          <Field label="Pause nach dem Speichern" hint="Danach wird automatisch der nächste Lead gewählt.">
            <select className="select" value={s.dialerAutoAdvance ?? 3} onChange={(e) => saveSettings({ dialerAutoAdvance: Number(e.target.value) })}>
              {[0, 2, 3, 5, 10].map((n) => (
                <option key={n} value={n}>{n === 0 ? 'sofort weiter' : `${n} Sekunden`}</option>
              ))}
            </select>
          </Field>
        </div>
        <label className="check mt-16">
          <input type="checkbox" checked={s.dialerSkipRecent !== false} onChange={(e) => saveSettings({ dialerSkipRecent: e.target.checked })} />
          Leads überspringen, die gerade erst (vom Team) angerufen wurden
        </label>
      </section>

      <section className="section">
        <h2>Benachrichtigungen</h2>
        <label className="check">
          <input type="checkbox" checked={s.notifications !== false && typeof Notification !== 'undefined' && Notification.permission === 'granted'} onChange={(e) => notify(e.target.checked)} />
          Bei eingehenden Anrufen benachrichtigen, auch wenn das CRM im Hintergrund ist
        </label>
      </section>

      {!demo ? (
        <section className="section">
          <h2>Passwort ändern</h2>
          <div className="row wrap">
            <input className="input" style={{ maxWidth: 280 }} type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Neues Passwort" />
            <button type="button" className="btn" onClick={changePw}>Ändern</button>
          </div>
        </section>
      ) : null}
    </>
  );
}
