// Auswertung von Gesprächsaufnahmen: Wellenform (Spitzenwerte je Zeitabschnitt) und Redeanteile.
// Diese Datei nutzen der Server (Edge Functions) UND der Browser (Demo) – gleiche Rechnung, gleiches Bild.
// Keine Deno- oder Browser-spezifischen Aufrufe hier.

export interface Peaks {
  bucket_ms: number;
  agent: number[]; // 0–255 (bei Mono-Aufnahmen: die ganze Aufnahme)
  customer: number[]; // 0–255 (bei Mono-Aufnahmen leer)
}

export interface TalkStats {
  agent_ms: number;
  customer_ms: number;
  overlap_ms: number;
  silence_ms: number;
  longest_customer_ms: number;
  switches: number;
}

// Redeanteile werden immer in 100-ms-Fenstern bestimmt – unabhängig davon, wie grob die Wellenform ist
export const TALK_MS = 100;

// Höchstens ~1600 Balken, mindestens 20 ms je Balken
export function bucketMsFor(durationMs: number, maxBuckets = 1600): number {
  return Math.max(20, Math.ceil(durationMs / maxBuckets / 10) * 10);
}

// Werte 0–1 (Betrag der Abtastwerte) → 0–255, Wurzel-Skala damit leise Stimmen sichtbar bleiben
export function peakByte(v: number): number {
  return Math.max(0, Math.min(255, Math.round(255 * Math.sqrt(Math.min(1, Math.max(0, v))))));
}

export class PeakBuilder {
  readonly samplesPerBucket: number;
  private max = 0;
  private sumSq = 0;
  private n = 0;
  readonly peaks: number[] = [];
  readonly rms: number[] = [];

  constructor(public readonly bucketMs: number, sampleRate: number) {
    this.samplesPerBucket = Math.max(1, Math.round((bucketMs / 1000) * sampleRate));
  }

  push(sample: number) {
    const a = sample < 0 ? -sample : sample;
    if (a > this.max) this.max = a;
    this.sumSq += sample * sample;
    if (++this.n >= this.samplesPerBucket) this.flush();
  }

  flush() {
    if (!this.n) return;
    this.peaks.push(peakByte(this.max));
    this.rms.push(Math.sqrt(this.sumSq / this.n));
    this.max = 0;
    this.sumSq = 0;
    this.n = 0;
  }
}

// Sprache erkennen: Lautstärke deutlich über dem Grundrauschen des jeweiligen Kanals
export function voiced(rms: number[]): boolean[] {
  if (!rms.length) return [];
  const sorted = [...rms].sort((a, b) => a - b);
  const floor = sorted[Math.floor(sorted.length * 0.1)] ?? 0;
  const threshold = Math.max(0.012, floor * 4);
  const raw = rms.map((v) => v > threshold);
  // kurze Lücken (Atempausen, < 300 ms) zählen noch zur Rede
  return raw;
}

export function talkStats(agentRms: number[], customerRms: number[], bucketMs: number): TalkStats {
  const a = voiced(agentRms);
  const c = voiced(customerRms);
  const len = Math.max(a.length, c.length);
  const gap = Math.ceil(300 / bucketMs);
  const smooth = (arr: boolean[]) => {
    const out = [...arr];
    let last = -1;
    for (let i = 0; i < arr.length; i++) {
      if (arr[i]) {
        if (last >= 0 && i - last - 1 <= gap) for (let j = last + 1; j < i; j++) out[j] = true;
        last = i;
      }
    }
    return out;
  };
  const sa = smooth(a);
  const sc = smooth(c);
  let agent = 0;
  let customer = 0;
  let overlap = 0;
  let silence = 0;
  let run = 0;
  let longest = 0;
  let switches = 0;
  let lastSpeaker: 'a' | 'c' | null = null;
  for (let i = 0; i < len; i++) {
    const va = !!sa[i];
    const vc = !!sc[i];
    if (va) agent++;
    if (vc) customer++;
    if (va && vc) overlap++;
    if (!va && !vc) silence++;
    run = vc ? run + 1 : 0;
    if (run > longest) longest = run;
    const speaker = va && !vc ? 'a' : vc && !va ? 'c' : null;
    if (speaker && lastSpeaker && speaker !== lastSpeaker) switches++;
    if (speaker) lastSpeaker = speaker;
  }
  return {
    agent_ms: agent * bucketMs,
    customer_ms: customer * bucketMs,
    overlap_ms: overlap * bucketMs,
    silence_ms: silence * bucketMs,
    longest_customer_ms: longest * bucketMs,
    switches,
  };
}

export function analyzeChannels(agent: Float32Array, customer: Float32Array, sampleRate: number): { peaks: Peaks; talk: TalkStats } {
  const durationMs = (Math.max(agent.length, customer.length) / sampleRate) * 1000;
  const bucketMs = bucketMsFor(durationMs);
  const pa = new PeakBuilder(bucketMs, sampleRate);
  const pc = new PeakBuilder(bucketMs, sampleRate);
  const ta = new PeakBuilder(TALK_MS, sampleRate);
  const tc = new PeakBuilder(TALK_MS, sampleRate);
  for (let i = 0; i < agent.length; i++) {
    pa.push(agent[i]);
    ta.push(agent[i]);
  }
  for (let i = 0; i < customer.length; i++) {
    pc.push(customer[i]);
    tc.push(customer[i]);
  }
  [pa, pc, ta, tc].forEach((b) => b.flush());
  return {
    peaks: { bucket_ms: bucketMs, agent: pa.peaks, customer: pc.peaks },
    talk: talkStats(ta.rms, tc.rms, TALK_MS),
  };
}

// Mono-Aufnahme (z. B. Mailbox-Nachricht): eine Spur, kein Redeanteil
export function analyzeMono(samples: Float32Array, sampleRate: number): Peaks {
  const bucketMs = bucketMsFor((samples.length / sampleRate) * 1000);
  const pb = new PeakBuilder(bucketMs, sampleRate);
  for (let i = 0; i < samples.length; i++) pb.push(samples[i]);
  pb.flush();
  return { bucket_ms: bucketMs, agent: pb.peaks, customer: [] };
}

export function talkShare(talk: { agent_ms: number; customer_ms: number } | null | undefined): number | null {
  if (!talk) return null;
  const total = talk.agent_ms + talk.customer_ms;
  return total > 0 ? talk.agent_ms / total : null;
}
