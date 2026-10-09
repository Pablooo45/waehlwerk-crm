// Zugänge für Abschriften (AssemblyAI, Server in der EU) und KI-Zusammenfassungen (Claude).

import { CheckCircle2, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '../../app/context.tsx';
import { useAsync } from '../../app/hooks.ts';
import { Field, Loading } from '../../ui/ui.tsx';
import { useSaver } from './shared.tsx';

interface Status {
  ai?: { assemblyai: boolean; anthropic: boolean };
}

export default function Ai() {
  const { store, ref, demo } = useApp();
  const save = useSaver();
  const status = useAsync(() => store.admin<Status>('status'), [store]);
  const [aai, setAai] = useState('');
  const [ant, setAnt] = useState('');
  const ai = status.data?.ai;

  const connect = async (payload: Record<string, string>) => {
    if (await save(() => store.admin('ai_connect', payload), 'Gespeichert und geprüft.')) {
      setAai('');
      setAnt('');
      status.reload();
    }
  };

  return (
    <>
      <section className="section">
        <h2><Sparkles size={18} aria-hidden="true" /> Abschriften</h2>
        <p className="muted">
          Abschriften macht AssemblyAI auf Servern in der EU (Dublin). Die Aufnahme hat zwei Spuren, deshalb ist eindeutig, wer was gesagt
          hat. Konto anlegen auf assemblyai.com, dann unter „API Keys“ den Schlüssel kopieren und hier eintragen.
        </p>
        {status.loading && !status.data ? <Loading /> : ai?.assemblyai ? <div className="callout ok"><CheckCircle2 /><span>AssemblyAI ist verbunden.</span></div> : null}
        <div className="form-grid mt-12">
          <Field label="AssemblyAI API-Schlüssel">
            <input className="input" type="password" value={aai} onChange={(e) => setAai(e.target.value.trim())} autoComplete="off" placeholder={ai?.assemblyai ? '•••••••• (gespeichert)' : ''} />
          </Field>
        </div>
        <button type="button" className="btn primary mt-12" disabled={!aai || demo} onClick={() => connect({ assemblyai_key: aai })}>
          Speichern & prüfen
        </button>
      </section>

      <section className="section">
        <h2>KI-Zusammenfassungen</h2>
        <p className="muted">
          Die Zusammenfassung mit nächsten Schritten und Einwänden schreibt Claude von Anthropic. Schlüssel unter console.anthropic.com →
          „API Keys“ anlegen.
        </p>
        {ai?.anthropic ? <div className="callout ok"><CheckCircle2 /><span>Anthropic ist verbunden.</span></div> : null}
        <div className="form-grid mt-12">
          <Field label="Anthropic API-Schlüssel">
            <input className="input" type="password" value={ant} onChange={(e) => setAnt(e.target.value.trim())} autoComplete="off" placeholder={ai?.anthropic ? '•••••••• (gespeichert)' : 'sk-ant-…'} />
          </Field>
        </div>
        <button type="button" className="btn primary mt-12" disabled={!ant || demo} onClick={() => connect({ anthropic_key: ant })}>
          Speichern & prüfen
        </button>
        <p className="small muted mt-12">
          Ob jedes Gespräch automatisch abgeschrieben und zusammengefasst wird, stellst du unter{' '}
          <a href="#/settings/recordings">Aufnahmen & Abschriften</a> ein (zurzeit {ref.org.transcription_enabled ? 'an' : 'aus'}).
        </p>
      </section>
    </>
  );
}
