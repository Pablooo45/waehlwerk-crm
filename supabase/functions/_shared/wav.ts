// WAV-Aufnahmen stückweise lesen und auswerten (Wellenform + Redeanteile), ohne die ganze Datei
// im Speicher zu halten. Twilio liefert 8 kHz, 16 Bit, mono oder zwei Spuren.
// Schnell genug für Edge Functions (2 s Rechenzeit je Aufruf): eine Stunde Stereo braucht ~0,2 s.

import { bucketMsFor, peakByte, type Peaks, TALK_MS, talkStats, type TalkStats } from './analysis.ts';

// Eine Spur: grobe Balken fürs Bild (Spitzenwert) + feine 100-ms-Fenster für die Redeanteile (Lautstärke)
class Lane {
  readonly peaks: number[] = [];
  readonly rms: number[] = [];
  private max = 0;
  private n = 0;
  private sq = 0;
  private tn = 0;

  constructor(private readonly perBucket: number, private readonly perTalk: number) {}

  push(v: number) {
    const a = v < 0 ? -v : v;
    if (a > this.max) this.max = a;
    this.sq += v * v;
    if (++this.tn >= this.perTalk) {
      this.rms.push(Math.sqrt(this.sq / this.tn));
      this.sq = 0;
      this.tn = 0;
    }
    if (++this.n >= this.perBucket) {
      this.peaks.push(peakByte(this.max));
      this.max = 0;
      this.n = 0;
    }
  }

  flush() {
    if (this.tn) this.rms.push(Math.sqrt(this.sq / this.tn));
    if (this.n) this.peaks.push(peakByte(this.max));
    this.sq = this.tn = this.n = this.max = 0;
  }
}

export interface WavFormat {
  channels: number;
  sampleRate: number;
  bitsPerSample: number;
  dataBytes: number | null; // null = unbekannt (Streaming ohne Längenangabe)
}

const MAX_HEADER = 1 << 16;

function ascii(b: Uint8Array, at: number, len: number): string {
  let s = '';
  for (let i = 0; i < len; i++) s += String.fromCharCode(b[at + i]);
  return s;
}

// Kopf auswerten; liefert Format und Beginn der Tondaten – oder null, wenn noch Bytes fehlen
export function parseWavHeader(b: Uint8Array): { format: WavFormat; dataOffset: number } | null {
  if (b.length < 12) return null;
  if (ascii(b, 0, 4) !== 'RIFF' || ascii(b, 8, 4) !== 'WAVE') throw new Error('Keine WAV-Datei.');
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let pos = 12;
  let fmt: Omit<WavFormat, 'dataBytes'> | null = null;
  while (pos + 8 <= b.length) {
    const id = ascii(b, pos, 4);
    const size = view.getUint32(pos + 4, true);
    if (id === 'fmt ') {
      if (pos + 8 + 16 > b.length) return null;
      const audioFormat = view.getUint16(pos + 8, true);
      const channels = view.getUint16(pos + 10, true);
      const sampleRate = view.getUint32(pos + 12, true);
      const bitsPerSample = view.getUint16(pos + 22, true);
      // 1 = PCM, 0xFFFE = Extensible (bei Telefonaufnahmen ebenfalls PCM)
      if (audioFormat !== 1 && audioFormat !== 0xfffe) throw new Error(`WAV-Format ${audioFormat} wird nicht unterstützt (nur PCM).`);
      if (bitsPerSample !== 16 && bitsPerSample !== 8) throw new Error(`${bitsPerSample} Bit werden nicht unterstützt.`);
      if (!channels || !sampleRate) throw new Error('WAV-Kopf beschädigt.');
      fmt = { channels, sampleRate, bitsPerSample };
    } else if (id === 'data') {
      if (!fmt) throw new Error('WAV ohne Formatangabe.');
      const known = size > 0 && size !== 0xffffffff;
      return { format: { ...fmt, dataBytes: known ? size : null }, dataOffset: pos + 8 };
    }
    pos += 8 + size + (size % 2);
  }
  if (b.length > MAX_HEADER) throw new Error('WAV-Kopf zu groß oder beschädigt.');
  return null;
}

export interface WavAnalysis {
  format: WavFormat;
  durationMs: number;
  peaks: Peaks;
  talk: TalkStats | null;
}

export interface AnalyzerOptions {
  // Gesamtgröße der Datei (aus Content-Length), falls der WAV-Kopf keine Länge enthält
  expectedBytes?: number | null;
  // Ab dieser Länge wird nur jeder n-te Abtastwert ausgewertet (spart Rechenzeit, Bild bleibt gleich)
  maxFrames?: number;
}

// Zählt Abtastwerte Spur für Spur in Balken (Spitzenwert + Lautstärke)
export class WavAnalyzer {
  format: WavFormat | null = null;
  bytes = 0;
  private head: Uint8Array = new Uint8Array(0);
  private rest: Uint8Array = new Uint8Array(0);
  private builders: Lane[] = [];
  private bucketMs = 20;
  private frames = 0;
  private stride = 1;

  constructor(private readonly opts: AnalyzerOptions = {}) {}

  push(chunk: Uint8Array) {
    this.bytes += chunk.length;
    if (!this.format) {
      const joined = concat(this.head, chunk);
      const parsed = parseWavHeader(joined);
      if (!parsed) {
        this.head = joined;
        return;
      }
      const f = parsed.format;
      this.format = f;
      const bytesPerFrame = (f.bitsPerSample / 8) * f.channels;
      const expected = this.opts.expectedBytes ? this.opts.expectedBytes - parsed.dataOffset : null;
      const dataBytes = f.dataBytes ?? expected;
      const totalFrames = dataBytes ? dataBytes / bytesPerFrame : 0;
      const durationMs = totalFrames ? (totalFrames / f.sampleRate) * 1000 : 0;
      // ohne bekannte Länge: feine Balken, am Ende zusammenfassen
      this.bucketMs = durationMs ? bucketMsFor(durationMs) : 20;
      const maxFrames = this.opts.maxFrames ?? 16_000_000; // ≈ 33 Minuten bei 8 kHz
      this.stride = totalFrames > maxFrames ? Math.ceil(totalFrames / maxFrames) : 1;
      const rate = f.sampleRate / this.stride;
      const perBucket = Math.max(1, Math.round((this.bucketMs / 1000) * rate));
      const perTalk = Math.max(1, Math.round((TALK_MS / 1000) * rate));
      this.builders = Array.from({ length: Math.min(2, f.channels) }, () => new Lane(perBucket, perTalk));
      this.head = new Uint8Array(0);
      chunk = joined.subarray(parsed.dataOffset);
    }
    this.consume(chunk);
  }

  private consume(chunk: Uint8Array) {
    const f = this.format!;
    const bps = f.bitsPerSample / 8;
    const ch = f.channels;
    const frameBytes = bps * ch;
    const data = this.rest.length ? concat(this.rest, chunk) : chunk;
    const usable = data.length - (data.length % frameBytes);
    const nFrames = usable / frameBytes;
    const lanes = this.builders.length;
    const stride = this.stride;
    // erster auszuwertender Frame in diesem Stück (gezählt über alle Stücke hinweg)
    const start = (stride - (this.frames % stride)) % stride;
    if (bps === 2) {
      const aligned = data.byteOffset % 2 === 0 ? data : data.slice(0, usable);
      const s = new Int16Array(aligned.buffer, aligned.byteOffset, usable / 2);
      for (let c = 0; c < lanes; c++) {
        const b = this.builders[c];
        const step = ch * stride;
        for (let i = start * ch + c; i < s.length; i += step) b.push(s[i] / 32768);
      }
    } else {
      for (let c = 0; c < lanes; c++) {
        const b = this.builders[c];
        for (let fr = start; fr < nFrames; fr += stride) b.push((data[fr * ch + c] - 128) / 128);
      }
    }
    this.frames += nFrames;
    this.rest = usable < data.length ? data.slice(usable) : new Uint8Array(0);
  }

  // agentChannel: 1 oder 2 (auf welcher Spur ist unsere Stimme); null = unbekannt → Spur 1
  finish(agentChannel: number | null): WavAnalysis {
    if (!this.format) throw new Error('Unvollständige WAV-Datei.');
    this.builders.forEach((b) => b.flush());
    const durationMs = Math.round((this.frames / this.format.sampleRate) * 1000);
    let bucketMs = this.bucketMs;
    let peaks = this.builders.map((b) => b.peaks);
    // zu viele Balken (Länge war vorher unbekannt) → zusammenfassen
    const target = bucketMsFor(durationMs);
    if (target > bucketMs) {
      const factor = Math.ceil(target / bucketMs);
      peaks = peaks.map((p) => maxPool(p, factor));
      bucketMs = bucketMs * factor;
    }
    if (this.builders.length < 2) {
      return { format: this.format, durationMs, peaks: { bucket_ms: bucketMs, agent: peaks[0] ?? [], customer: [] }, talk: null };
    }
    const agentIdx = agentChannel === 2 ? 1 : 0;
    return {
      format: this.format,
      durationMs,
      peaks: { bucket_ms: bucketMs, agent: peaks[agentIdx], customer: peaks[1 - agentIdx] },
      talk: talkStats(this.builders[agentIdx].rms, this.builders[1 - agentIdx].rms, TALK_MS),
    };
  }
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  if (!a.length) return b;
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}

export function maxPool(values: number[], factor: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < values.length; i += factor) {
    let max = 0;
    for (let j = i; j < Math.min(values.length, i + factor); j++) if (values[j] > max) max = values[j];
    out.push(max);
  }
  return out;
}

// Für Tests: WAV (16 Bit PCM) aus Spuren erzeugen
export function encodeWav16(channels: Float32Array[], sampleRate: number): Uint8Array {
  const frames = Math.max(...channels.map((c) => c.length));
  const ch = channels.length;
  const buf = new ArrayBuffer(44 + frames * ch * 2);
  const v = new DataView(buf);
  const w = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF');
  v.setUint32(4, 36 + frames * ch * 2, true);
  w(8, 'WAVE');
  w(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, ch, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * ch * 2, true);
  v.setUint16(32, ch * 2, true);
  v.setUint16(34, 16, true);
  w(36, 'data');
  v.setUint32(40, frames * ch * 2, true);
  let o = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < ch; c++, o += 2) {
      const s = Math.max(-1, Math.min(1, channels[c][i] ?? 0));
      v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
  }
  return new Uint8Array(buf);
}
