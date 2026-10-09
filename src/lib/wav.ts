// Audio als WAV (Twilio spielt WAV/MP3 ab, aber kein WebM/Ogg aus dem Browser).

export function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  let o = 44;
  for (let i = 0; i < samples.length; i++, o += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

// Beliebige Audiodatei (WebM, MP3, M4A …) → WAV 16 kHz mono
export async function toWav(blob: Blob, targetRate = 16000): Promise<{ wav: Blob; seconds: number }> {
  const data = await blob.arrayBuffer();
  const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new Ctx();
  try {
    const decoded = await ctx.decodeAudioData(data.slice(0));
    const length = Math.ceil(decoded.duration * targetRate);
    const offline = new OfflineAudioContext(1, length, targetRate);
    const src = offline.createBufferSource();
    src.buffer = decoded;
    src.connect(offline.destination);
    src.start();
    const rendered = await offline.startRendering();
    const samples = rendered.getChannelData(0);
    // leicht normalisieren, damit leise Aufnahmen gut hörbar sind
    let peak = 0;
    for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]));
    if (peak > 0 && peak < 0.7) {
      const gain = 0.85 / peak;
      for (let i = 0; i < samples.length; i++) samples[i] *= gain;
    }
    return { wav: encodeWav(samples, targetRate), seconds: decoded.duration };
  } finally {
    ctx.close().catch(() => undefined);
  }
}

// Kleine Demo-Aufnahme erzeugen (nur Demo-Modus)
// Data-URL statt Blob-URL: funktioniert auch in streng abgesicherten Seiten (z. B. der Demo-Vorschau).
export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error ?? new Error('Datei konnte nicht gelesen werden.'));
    r.readAsDataURL(blob);
  });
}

export function demoRecording(seconds = 8, seed = 1): Blob {
  return encodeWav(demoRecordingSamples(seconds, seed), 8000);
}

export function demoRecordingSamples(seconds = 8, seed = 1): Float32Array {
  const rate = 8000;
  const out = new Float32Array(seconds * rate);
  let x = seed * 9301 + 49297;
  const rnd = () => {
    x = (x * 9301 + 49297) % 233280;
    return x / 233280;
  };
  for (let s = 0; s < seconds; s += 0.5) {
    const speaker = Math.floor(s) % 2;
    const base = speaker ? 180 : 120;
    const start = Math.floor(s * rate);
    const len = Math.floor((0.25 + rnd() * 0.2) * rate);
    for (let i = 0; i < len && start + i < out.length; i++) {
      const t = i / rate;
      const env = Math.sin((Math.PI * i) / len);
      const f = base * (1 + 0.15 * Math.sin(2 * Math.PI * 3 * t));
      out[start + i] = 0.25 * env * (Math.sin(2 * Math.PI * f * t) + 0.4 * Math.sin(4 * Math.PI * f * t)) +
        0.02 * (rnd() - 0.5);
    }
  }
  return out;
}
