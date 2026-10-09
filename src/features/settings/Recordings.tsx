// Aufnahmen & Abschriften: Modus, Qualität, Ansage, Aufbewahrung, KI.

import { Info, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '../../app/context.tsx';
import type { OrgSettings, RecordingMode } from '../../lib/types.ts';
import { Field } from '../../ui/ui.tsx';
import { useSaver } from './shared.tsx';

const MODES: [RecordingMode, string, string][] = [
  ['manual', 'Auf Knopfdruck', 'Ihr fragt kurz nach dem Einverständnis und startet die Aufnahme in der Anrufleiste.'],
  ['auto', 'Automatisch, beide Seiten', 'Jedes angenommene Gespräch wird aufgezeichnet. Nur mit Einwilligung, z. B. über die Ansage unten.'],
  ['auto_agent', 'Automatisch, nur eigene Stimme', 'Zeichnet ausschließlich euren Teil auf – gut fürs eigene Coaching.'],
  ['off', 'Aus', 'Keine Aufnahmen.'],
];

const RETENTION: [number | null, string][] = [
  [null, 'Nie automatisch löschen'],
  [30, '30 Tage'],
  [90, '3 Monate'],
  [180, '6 Monate'],
  [365, '1 Jahr'],
  [730, '2 Jahre'],
];

export default function Recordings() {
  const { store, ref } = useApp();
  const save = useSaver();
  const org = ref.org;
  const [announcement, setAnnouncement] = useState(org.recording_announcement_text);
  const saveOrg = (patch: Partial<OrgSettings>) => save(() => store.updateOrg(patch), 'Gespeichert.');

  return (
    <>
      <section className="section">
        <h2>Gesprächsaufnahmen</h2>
        <div className="callout warn" style={{ marginBottom: 14 }}>
          <Info />
          <span>
            In Deutschland ist das Aufzeichnen ohne Einwilligung des Gesprächspartners strafbar (§ 201 StGB). Lasst die Variante, die ihr
            nutzt, einmal rechtlich prüfen – das CRM kann die Einwilligung per Ansage einholen.
          </span>
        </div>
        <div className="col gap-8">
          {MODES.map(([value, label, hint]) => (
            <label key={value} className="check" style={{ alignItems: 'flex-start' }}>
              <input type="radio" name="recmode" checked={org.recording_mode === value} onChange={() => saveOrg({ recording_mode: value })} style={{ marginTop: 3 }} />
              <span>
                <strong>{label}</strong>
                <br />
                <span className="small muted">{hint}</span>
              </span>
            </label>
          ))}
        </div>
      </section>

      <section className="section">
        <h2>Qualität</h2>
        <p className="muted">
          Jede Aufnahme hat zwei getrennte Spuren: eure Stimme und die des Kunden. So lässt sich jede Seite einzeln lauter stellen, die
          Redeanteile werden genau gemessen und die Abschrift weiß sicher, wer was gesagt hat.
        </p>
        <div className="col gap-8 mt-8">
          <label className="check" style={{ alignItems: 'flex-start' }}>
            <input type="radio" name="recfmt" checked={org.recording_format === 'wav'} onChange={() => saveOrg({ recording_format: 'wav' })} style={{ marginTop: 3 }} />
            <span>
              <strong>Verlustfrei (WAV, empfohlen)</strong>
              <br />
              <span className="small muted">
                Exakt das, was über die Leitung kam – ohne zusätzliche Kompression. Etwa 1,9 MB pro Gesprächsminute.
              </span>
            </span>
          </label>
          <label className="check" style={{ alignItems: 'flex-start' }}>
            <input type="radio" name="recfmt" checked={org.recording_format === 'mp3'} onChange={() => saveOrg({ recording_format: 'mp3' })} style={{ marginTop: 3 }} />
            <span>
              <strong>Platzsparend (MP3)</strong>
              <br />
              <span className="small muted">Etwa ein Achtel der Größe, dafür leicht hörbare Kompression bei leisen oder schnellen Sprechern.</span>
            </span>
          </label>
        </div>
        <div className="callout mt-12">
          <Info />
          <span className="small">
            Das Telefonnetz selbst überträgt Sprache schmalbandig (wie jedes normale Telefonat). Besser als die Leitung kann keine
            Aufnahme klingen – das CRM verliert aber nichts davon. Im Player gibt es zusätzlich „Sprache verbessern“ (Rauschen und
            Brummen weg, leise Stellen lauter).
          </span>
        </div>
      </section>

      <section className="section">
        <h2>Ansage vor der Aufnahme</h2>
        <label className="check">
          <input type="checkbox" checked={org.recording_announcement} onChange={(e) => saveOrg({ recording_announcement: e.target.checked })} />
          Gesprächspartner hört beim Abnehmen eine kurze Ansage
        </label>
        <Field label="Text der Ansage" className="mt-12" hint="Wird mit einer deutschen Computerstimme vorgelesen, bevor ihr verbunden werdet.">
          <textarea className="textarea" value={announcement} onChange={(e) => setAnnouncement(e.target.value)} disabled={!org.recording_announcement} />
        </Field>
        <button type="button" className="btn small mt-8" disabled={announcement === org.recording_announcement_text} onClick={() => saveOrg({ recording_announcement_text: announcement })}>
          Text speichern
        </button>
      </section>

      <section className="section">
        <h2>Aufbewahrung</h2>
        <div className="form-grid">
          <Field label="Aufnahmen automatisch löschen nach" hint="Gesprächsdaten (Dauer, Ergebnis, Notiz) bleiben erhalten, nur Ton und Abschrift werden gelöscht.">
            <select className="select" value={org.recording_retention_days ?? ''} onChange={(e) => saveOrg({ recording_retention_days: e.target.value ? Number(e.target.value) : null })}>
              {RETENTION.map(([v, l]) => (
                <option key={l} value={v ?? ''}>{l}</option>
              ))}
            </select>
          </Field>
          <label className="check" style={{ alignSelf: 'end', paddingBottom: 8 }}>
            <input type="checkbox" checked={org.delete_twilio_recordings} onChange={(e) => saveOrg({ delete_twilio_recordings: e.target.checked })} />
            Nach dem Speichern bei Twilio löschen (Aufnahmen liegen dann nur in eurer EU-Datenbank)
          </label>
        </div>
        <p className="small muted mt-12">
          Wer welche Aufnahmen hören, herunterladen oder löschen darf, legst du unter <a href="#/settings/roles">Rollen & Rechte</a> fest.
          Eigene Gespräche kann jede Person immer anhören.
        </p>
      </section>

      <section className="section">
        <h2>
          <Sparkles size={18} aria-hidden="true" /> Abschrift & KI-Zusammenfassung
        </h2>
        <div className="col gap-8">
          <label className="check" style={{ alignItems: 'flex-start' }}>
            <input type="checkbox" checked={org.transcription_enabled} onChange={(e) => saveOrg({ transcription_enabled: e.target.checked })} style={{ marginTop: 3 }} />
            <span>
              <strong>Jedes aufgenommene Gespräch automatisch abschreiben</strong>
              <br />
              <span className="small muted">Deutsch, getrennt nach Sprecher, durchsuchbar unter „Gespräche“. Rund ein halber Cent pro Gesprächsminute.</span>
            </span>
          </label>
          <label className="check" style={{ alignItems: 'flex-start' }}>
            <input type="checkbox" checked={org.summary_enabled} onChange={(e) => saveOrg({ summary_enabled: e.target.checked })} disabled={!org.transcription_enabled} style={{ marginTop: 3 }} />
            <span>
              <strong>KI-Zusammenfassung mit nächsten Schritten und Einwänden</strong>
              <br />
              <span className="small muted">Erscheint am Anruf und im Verlauf des Leads. Höchstens etwa 1 Cent pro Gespräch.</span>
            </span>
          </label>
        </div>
        <p className="small muted mt-12">Die Zugänge für Abschrift und KI trägst du unter <a href="#/settings/ai">KI & Abschriften</a> ein.</p>
      </section>
    </>
  );
}
