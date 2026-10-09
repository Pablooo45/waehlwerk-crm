import { Circle, Play, Square, Trash2, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { useApp } from '../../app/context.tsx';
import { formatDuration } from '../../lib/format.ts';
import type { VoicemailDrop } from '../../lib/types.ts';
import { toWav } from '../../lib/wav.ts';
import { errMsg, Field, Tag, useUi } from '../../ui/ui.tsx';
import { useRecorder } from './audio.tsx';

export default function Voicemail() {
  const { store, ref, me, isAdmin, reloadRef } = useApp();
  const { toast, confirm } = useUi();
  const rec = useRecorder();
  const [name, setName] = useState('');
  const [shared, setShared] = useState(false);
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  const drops = ref.voicemailDrops;

  const save = async () => {
    if (!rec.blob) return;
    if (!name.trim()) {
      toast('Bitte einen Namen vergeben, z. B. „Standard – bitte Rückruf“.', { kind: 'error' });
      return;
    }
    setBusy(true);
    try {
      const { wav, seconds } = await toWav(rec.blob);
      if (seconds < 2) throw new Error('Die Aufnahme ist zu kurz.');
      await store.uploadVoicemailDrop(name.trim(), wav, seconds, shared && isAdmin);
      await reloadRef();
      rec.setBlob(null);
      setName('');
      toast('Mailbox-Nachricht gespeichert.');
    } catch (e) {
      toast(errMsg(e), { kind: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (d: VoicemailDrop) => {
    if (!(await confirm(`„${d.name}“ löschen?`, { danger: true, confirmLabel: 'Löschen' }))) return;
    await store.deleteVoicemailDrop(d);
    await reloadRef();
  };

  const play = async (d: VoicemailDrop) => {
    try {
      const url = await store.audioUrl('voicemails', d.storage_path);
      await new Audio(url).play();
    } catch (e) {
      toast(errMsg(e), { kind: 'error' });
    }
  };

  return (
    <>
      <section className="section">
        <h2>Mailbox-Nachrichten</h2>
        <p className="muted">
          Läuft beim Anruf die Mailbox, klickst du nach dem Piepton auf „Mailbox“ und wählst eine Nachricht. Sie wird
          abgespielt, während du schon den nächsten Lead anrufst.
        </p>
        {drops.length ? (
          <div className="panel">
            {drops.map((d) => (
              <div className="list-item" key={d.id}>
                <button type="button" className="icon-btn small" onClick={() => play(d)} aria-label="Anhören">
                  <Play />
                </button>
                <span className="grow">
                  <strong>{d.name}</strong>
                  <span className="muted small"> {d.duration ? formatDuration(d.duration) : ''}</span>
                </span>
                {d.shared ? <Tag tone="blue">Für alle</Tag> : null}
                {d.user_id === me.id || isAdmin ? (
                  <button type="button" className="icon-btn small" onClick={() => remove(d)} aria-label="Löschen">
                    <Trash2 />
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <p className="muted small">Noch keine Nachricht aufgenommen.</p>
        )}
      </section>

      <section className="section">
        <h2>Neue Nachricht</h2>
        <p className="muted">Kurz halten (10–25 Sekunden): Name, Firma, worum es geht, Rückrufnummer.</p>
        <div className="row wrap">
          {rec.recording ? (
            <button type="button" className="btn danger" onClick={rec.stop}>
              <Square /> Stopp ({formatDuration(rec.seconds)})
            </button>
          ) : (
            <button type="button" className="btn" onClick={() => rec.start()}>
              <Circle color="var(--signal)" /> Aufnehmen
            </button>
          )}
          <button type="button" className="btn ghost" onClick={() => file.current?.click()} disabled={rec.recording}>
            <Upload /> Datei hochladen
          </button>
          <input
            ref={file}
            type="file"
            accept="audio/*"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) {
                rec.setBlob(f);
                if (!name) setName(f.name.replace(/\.[a-z0-9]+$/i, ''));
              }
              e.target.value = '';
            }}
          />
        </div>
        {rec.blob ? (
          <div className="col mt-16">
            {rec.url ? <audio controls src={rec.url} style={{ maxWidth: '100%', width: 420 }} /> : null}
            <div className="form-grid">
              <Field label="Name">
                <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Standard – bitte Rückruf" />
              </Field>
              {isAdmin ? (
                <label className="check" style={{ alignSelf: 'end', paddingBottom: 8 }}>
                  <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} />
                  Für das ganze Team
                </label>
              ) : null}
            </div>
            <div className="row">
              <button type="button" className="btn primary" onClick={save} disabled={busy}>
                Speichern
              </button>
              <button type="button" className="btn ghost" onClick={() => rec.setBlob(null)}>
                Verwerfen
              </button>
            </div>
          </div>
        ) : null}
      </section>
    </>
  );
}
