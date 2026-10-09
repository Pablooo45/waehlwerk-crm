// Mikrofon: Geräte auflisten, Pegel anzeigen, aufnehmen.

import { Mic, Square } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { config } from '../../lib/config.ts';
import { blobToDataUrl } from '../../lib/wav.ts';
import { errMsg, useUi } from '../../ui/ui.tsx';

export function micErrorText(e: unknown): string {
  const name = (e as { name?: string } | null)?.name ?? '';
  const msg = errMsg(e);
  if (name === 'NotAllowedError' || name === 'SecurityError' || /denied|not allowed|permission/i.test(msg)) {
    return config.demoBuild
      ? 'In der Demo-Vorschau ist das Mikrofon gesperrt. Im echten CRM fragt der Browser beim ersten Mal nach der Erlaubnis.'
      : 'Mikrofon blockiert. Bitte im Browser erlauben (Schloss-Symbol neben der Adresse) und die Seite neu laden.';
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'Kein Mikrofon gefunden. Headset anschließen und neu laden.';
  if (name === 'NotReadableError') return 'Das Mikrofon wird gerade von einem anderen Programm benutzt (z. B. Teams oder Zoom).';
  return msg;
}

export async function listDevices(): Promise<{ inputs: MediaDeviceInfo[]; outputs: MediaDeviceInfo[]; labeled: boolean }> {
  if (!navigator.mediaDevices?.enumerateDevices) return { inputs: [], outputs: [], labeled: false };
  const all = await navigator.mediaDevices.enumerateDevices();
  const inputs = all.filter((d) => d.kind === 'audioinput');
  const outputs = all.filter((d) => d.kind === 'audiooutput');
  return { inputs, outputs, labeled: inputs.some((d) => d.label) };
}

export async function askMic(): Promise<void> {
  const s = await navigator.mediaDevices.getUserMedia({ audio: true });
  s.getTracks().forEach((t) => t.stop());
}

// Pegelanzeige für ein Mikrofon
export function MicMeter({ deviceId }: { deviceId?: string }) {
  const [level, setLevel] = useState(0);
  const [active, setActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stop = useRef<() => void>(() => undefined);

  useEffect(() => () => stop.current(), []);

  const start = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: deviceId ? { deviceId: { exact: deviceId } } : true });
      const ctx = new AudioContext();
      const src = ctx.createMediaStreamSource(stream);
      const an = ctx.createAnalyser();
      an.fftSize = 512;
      src.connect(an);
      const buf = new Uint8Array(an.fftSize);
      let raf = 0;
      const tick = () => {
        an.getByteTimeDomainData(buf);
        let peak = 0;
        for (const v of buf) peak = Math.max(peak, Math.abs(v - 128));
        setLevel(Math.min(1, peak / 90));
        raf = requestAnimationFrame(tick);
      };
      tick();
      setActive(true);
      stop.current = () => {
        cancelAnimationFrame(raf);
        stream.getTracks().forEach((t) => t.stop());
        ctx.close().catch(() => undefined);
        setActive(false);
        setLevel(0);
      };
    } catch (e) {
      setError(micErrorText(e));
    }
  };

  return (
    <div className="col">
      <div className="row">
        {active ? (
          <button type="button" className="btn small" onClick={() => stop.current()}>
            <Square /> Test beenden
          </button>
        ) : (
          <button type="button" className="btn small" onClick={start}>
            <Mic /> Mikrofon testen
          </button>
        )}
        <div className="meter grow" aria-label="Pegel">
          <div style={{ width: `${Math.round(level * 100)}%` }} />
        </div>
      </div>
      {active ? <span className="xs muted">Sprich etwas – der Balken sollte deutlich ausschlagen.</span> : null}
      {error ? <span className="small" style={{ color: 'var(--signal)' }}>{error}</span> : null}
    </div>
  );
}

// Kurze Sprachaufnahme im Browser (für Mailbox-Nachrichten / Ansagen)
export function useRecorder() {
  const { toast } = useUi();
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const rec = useRef<MediaRecorder | null>(null);

  // Vorhören: als Data-URL, damit es überall abspielbar ist
  useEffect(() => {
    if (!blob) {
      setUrl(null);
      return;
    }
    let alive = true;
    blobToDataUrl(blob)
      .then((u) => alive && setUrl(u))
      .catch(() => alive && setUrl(null));
    return () => {
      alive = false;
    };
  }, [blob]);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const chunks: BlobPart[] = [];
      const mr = new MediaRecorder(stream);
      mr.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      mr.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        setBlob(new Blob(chunks, { type: mr.mimeType || 'audio/webm' }));
      };
      mr.start();
      rec.current = mr;
      setBlob(null);
      setSeconds(0);
      setRecording(true);
      const t0 = Date.now();
      timer.current = setInterval(() => {
        const s = Math.floor((Date.now() - t0) / 1000);
        setSeconds(s);
        if (s >= 60) stop();
      }, 250);
    } catch (e) {
      toast(`Aufnahme nicht möglich: ${micErrorText(e)}`, { kind: 'error' });
    }
  };

  const stop = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    rec.current?.stop();
    rec.current = null;
    setRecording(false);
  };

  useEffect(() => () => {
    if (timer.current) clearInterval(timer.current);
    rec.current?.stop();
  }, []);

  return { recording, seconds, blob, url, setBlob, start, stop };
}
