// Demo: erfundene Beispielgespräche mit Abschrift, synthetischer Zwei-Kanal-Aufnahme
// (wir links, Kunde rechts – wie bei Twilio-Aufnahmen mit getrennten Spuren),
// Wellenform und KI-Zusammenfassung. Nur für den Demo-Modus.

import type { CallSummary, TranscriptSegment } from '../types.ts';
import { analyzeChannels, type Peaks, type TalkStats } from './analysis.ts';

export interface DemoScript {
  key: string;
  outcome: string;
  lines: { s: 'a' | 'c'; t: string }[];
  summary: CallSummary;
}

export const DEMO_SCRIPTS: DemoScript[] = [
  {
    key: 'setting_kg',
    outcome: 'setting_gelegt',
    lines: [
      { s: 'a', t: 'Guten Tag, hier ist {agent} von Salus Digital. Spreche ich mit {kunde}, der Inhaberin?' },
      { s: 'c', t: 'Ja, am Apparat. Worum geht es denn?' },
      { s: 'a', t: 'Wir helfen Apotheken, über Google und Social Media mehr Kunden aus der Umgebung zu gewinnen, staatlich gefördert über die BAFA. Darf ich Ihnen kurz zwei Fragen stellen?' },
      { s: 'c', t: 'Zwei Minuten habe ich, dann kommt die Mittagsvertretung.' },
      { s: 'a', t: 'Wie entwickelt sich bei Ihnen gerade das OTC-Geschäft?' },
      { s: 'c', t: 'Ehrlich gesagt wandert viel zu den Versendern ab. Die Stammkunden bleiben, aber neue kommen kaum dazu.' },
      { s: 'a', t: 'Machen Sie aktuell schon Marketing, zum Beispiel bei Google oder Instagram?' },
      { s: 'c', t: 'Wir haben eine Website und ab und zu Flyer. Für mehr fehlt mir einfach die Zeit.' },
      { s: 'a', t: 'Genau da setzen wir an. Mit der Förderung tragen Sie nur einen kleinen Eigenanteil. Wollen wir uns das in einem kurzen Termin von fünfzehn Minuten genauer anschauen?' },
      { s: 'c', t: 'Und was kostet mich das am Ende?' },
      { s: 'a', t: 'Das hängt vom Umfang ab. Bei achtzig Prozent Förderung bleiben meist wenige hundert Euro Eigenanteil. Das rechnen wir im Termin konkret für Sie durch.' },
      { s: 'c', t: 'Gut, dann machen wir das. Donnerstagvormittag passt mir.' },
      { s: 'a', t: 'Donnerstag um zehn Uhr? Ich schicke Ihnen gleich die Bestätigung per E-Mail.' },
      { s: 'c', t: 'Passt. Bis Donnerstag.' },
    ],
    summary: {
      text: 'Die Inhaberin spürt, dass OTC-Kunden zu Versendern abwandern; bisher gibt es nur Website und Flyer, für mehr fehlt die Zeit. Interesse an Kundengewinnung mit BAFA-Förderung, Hauptfrage war der Eigenanteil.',
      next_steps: ['Setting Donnerstag 10:00 – Bestätigung per E-Mail schicken', 'Eigenanteil bei 80 % Förderung im Termin vorrechnen'],
      objections: ['Kosten / Eigenanteil', 'Wenig Zeit'],
      mood: 'positiv',
    },
  },
  {
    key: 'setting_mg',
    outcome: 'setting_gelegt',
    lines: [
      { s: 'a', t: 'Guten Morgen, {agent} von Salus Digital. Ist {kunde} zu sprechen?' },
      { s: 'c', t: 'Ja, das bin ich.' },
      { s: 'a', t: 'Schön, dass ich Sie direkt erreiche. Wir unterstützen Apotheken bei der Suche nach PTA und PKA über regionale Social-Media-Kampagnen. Ist Personal bei Ihnen gerade ein Thema?' },
      { s: 'c', t: 'Oh ja. Wir suchen seit über einem Jahr eine PTA, auf die Anzeigen bei den Stellenbörsen kommt fast nichts.' },
      { s: 'a', t: 'Das hören wir oft. Wer wechselwillig ist, sucht selten aktiv. Deshalb zeigen wir Ihre Apotheke dort als Arbeitgeber, wo die Leute ohnehin jeden Tag sind.' },
      { s: 'c', t: 'Wir hatten mal einen Personalvermittler, das war aber sehr teuer pro Kopf.' },
      { s: 'a', t: 'Bei uns gibt es keine Provision pro Einstellung, und einen Großteil fördert die BAFA. Wann soll die neue Kollegin denn idealerweise anfangen?' },
      { s: 'c', t: 'Am liebsten gestern. Spätestens zum Jahresanfang.' },
      { s: 'a', t: 'Dann sollten wir keine Zeit verlieren. Ich würde Ihnen gern in fünfzehn Minuten zeigen, wie das bei anderen Apotheken gelaufen ist. Passt Ihnen Dienstag um vierzehn Uhr?' },
      { s: 'c', t: 'Dienstag vierzehn Uhr geht. Schicken Sie mir bitte vorher etwas zum Lesen.' },
      { s: 'a', t: 'Mache ich, die Infos kommen gleich zusammen mit der Terminbestätigung.' },
    ],
    summary: {
      text: 'Die Apotheke sucht seit über einem Jahr eine PTA; Stellenbörsen bringen kaum Bewerbungen, ein Personalvermittler war zu teuer. Starke Dringlichkeit (Start spätestens Jahresanfang), offen für geförderte Social-Media-Recruiting-Kampagne.',
      next_steps: ['Setting Dienstag 14:00 bestätigen', 'Vorab „Cold Call: Infos Mitarbeitergewinnung“ senden'],
      objections: ['Schlechte Erfahrung mit Personalvermittler (Kosten)'],
      mood: 'positiv',
    },
  },
  {
    key: 'eg_zeit',
    outcome: 'entscheider_gesprochen',
    lines: [
      { s: 'a', t: 'Guten Tag, hier ist {agent} von Salus Digital. Spreche ich mit {kunde}?' },
      { s: 'c', t: 'Ja. Ich habe aber wirklich nur eine Minute.' },
      { s: 'a', t: 'Dann ganz kurz: Wir bringen Apotheken über Google und Social Media mehr Neukunden, mit BAFA-Förderung. Ist das für Sie grundsätzlich interessant?' },
      { s: 'c', t: 'Grundsätzlich schon, aber wir bauen gerade um und ich habe den Kopf voll bis Ende des Jahres.' },
      { s: 'a', t: 'Verstehe ich gut. Wann wäre ein besserer Zeitpunkt, um noch einmal darüber zu sprechen?' },
      { s: 'c', t: 'Rufen Sie mich im Januar wieder an, dann ist der Umbau durch.' },
      { s: 'a', t: 'Mache ich. Darf ich Ihnen bis dahin eine kurze Übersicht per E-Mail schicken?' },
      { s: 'c', t: 'Ja, gern an die Info-Adresse.' },
    ],
    summary: {
      text: 'Grundsätzliches Interesse, aber die Apotheke wird gerade umgebaut; vor Jahresende keine Kapazität. Rückruf im Januar gewünscht, Infos per E-Mail an die Info-Adresse.',
      next_steps: ['Wiedervorlage Anfang Januar', 'Info-Mail Kundengewinnung senden'],
      objections: ['Keine Zeit (Umbau)'],
      mood: 'neutral',
    },
  },
  {
    key: 'eg_agentur',
    outcome: 'entscheider_gesprochen',
    lines: [
      { s: 'a', t: 'Hallo, {agent} von Salus Digital. Ich würde gern kurz mit {kunde} sprechen.' },
      { s: 'c', t: 'Am Apparat.' },
      { s: 'a', t: 'Wir helfen Apotheken, online sichtbarer zu werden und mehr Neukunden zu gewinnen. Wie machen Sie das aktuell?' },
      { s: 'c', t: 'Wir haben schon eine Agentur für Instagram. Die Reichweite ist aber ehrlich gesagt enttäuschend.' },
      { s: 'a', t: 'Woran liegt das Ihrer Meinung nach?' },
      { s: 'c', t: 'Die posten schöne Bilder, aber es kommt niemand deswegen in die Apotheke. Und messen können wir es auch nicht.' },
      { s: 'a', t: 'Genau das ist bei uns anders: Wir zeigen Ihnen schwarz auf weiß, wie viele Neukunden über die Kampagnen kommen. Der Vertrag mit der Agentur läuft noch?' },
      { s: 'c', t: 'Bis März. Danach bin ich offen für etwas anderes.' },
      { s: 'a', t: 'Dann melde ich mich im Februar, damit wir rechtzeitig vergleichen können. Ich schicke Ihnen vorab unsere Infos.' },
      { s: 'c', t: 'Ja, machen Sie das.' },
    ],
    summary: {
      text: 'Bestehende Instagram-Agentur bis März, Inhaber unzufrieden mit Reichweite und fehlender Messbarkeit. Offen für einen Wechsel nach Vertragsende.',
      next_steps: ['Wiedervorlage im Februar (vor Vertragsende)', 'Infos mit Fokus Messbarkeit schicken'],
      objections: ['Hat schon eine Agentur (Vertrag bis März)'],
      mood: 'neutral',
    },
  },
  {
    key: 'gatekeeper',
    outcome: 'nicht_erreicht',
    lines: [
      { s: 'c', t: 'Apotheke am Markt, guten Tag.' },
      { s: 'a', t: 'Guten Tag, hier ist {agent} von Salus Digital. Ist der Inhaber heute da?' },
      { s: 'c', t: 'Der Chef ist erst ab vierzehn Uhr im Haus. Worum geht es denn?' },
      { s: 'a', t: 'Um ein Förderprogramm für Apotheken. Dann versuche ich es heute Nachmittag noch einmal. Wie war gleich Ihr Name?' },
      { s: 'c', t: 'Frau Becker. Ich sage ihm Bescheid.' },
      { s: 'a', t: 'Vielen Dank, Frau Becker. Schönen Tag noch.' },
    ],
    summary: {
      text: 'Gatekeeper (Frau Becker): Inhaber erst ab 14 Uhr da. Rückruf am Nachmittag.',
      next_steps: ['Heute nach 14 Uhr erneut anrufen, nach dem Inhaber fragen'],
      objections: [],
      mood: 'neutral',
    },
  },
];

export interface BuiltScript {
  script: DemoScript;
  segments: TranscriptSegment[];
  durationMs: number;
}

function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildScript(key: string, names: { agent: string; kunde: string }, seed = 1): BuiltScript {
  const script = DEMO_SCRIPTS.find((s) => s.key === key) ?? DEMO_SCRIPTS[0];
  const r = rng(seed);
  let t = 600;
  const segments: TranscriptSegment[] = script.lines.map((l) => {
    const text = l.t.replace('{agent}', names.agent).replace('{kunde}', names.kunde);
    const dur = Math.round((text.length / 14.5) * 1000 * (0.92 + r() * 0.16));
    const seg: TranscriptSegment = { speaker: l.s === 'a' ? 'agent' : 'customer', start: t, end: t + dur, text };
    t += dur + Math.round(350 + r() * 650);
    return seg;
  });
  return { script, segments, durationMs: t + 400 };
}

// ---------- Synthetische „Sprache“ (klingt wie Gemurmel, zeigt aber echte Sprechpausen) ----------

const VOWELS: [number, number][] = [
  [730, 1090], // a
  [530, 1840], // e
  [300, 2200], // i
  [570, 840], // o
  [320, 870], // u
  [480, 1600], // ö/ä
];

export function synthDialog(built: BuiltScript, rate = 8000, seed = 1): { agent: Float32Array; customer: Float32Array } {
  const total = Math.ceil((built.durationMs / 1000) * rate);
  const agent = new Float32Array(total);
  const customer = new Float32Array(total);
  const r = rng(seed * 7919 + 13);
  // leises Grundrauschen der Leitung
  for (let i = 0; i < total; i++) {
    agent[i] = (r() - 0.5) * 0.004;
    customer[i] = (r() - 0.5) * 0.006;
  }
  for (const seg of built.segments) {
    const out = seg.speaker === 'agent' ? agent : customer;
    const baseF0 = seg.speaker === 'agent' ? 122 : 208;
    const loud = seg.speaker === 'agent' ? 0.32 : 0.27;
    const start = Math.floor((seg.start / 1000) * rate);
    const end = Math.min(total, Math.floor((seg.end / 1000) * rate));
    let i = start;
    const phases = new Float64Array(15); // Obertöne 1…14
    while (i < end) {
      // Silbe
      const sylLen = Math.floor((0.11 + r() * 0.15) * rate);
      const [f1, f2] = VOWELS[Math.floor(r() * VOWELS.length)];
      const pos = (i - start) / Math.max(1, end - start);
      const f0 = baseF0 * (1.08 - 0.16 * pos) * (0.94 + r() * 0.12);
      const nh = Math.min(14, Math.floor(3400 / f0));
      const amps = new Float64Array(nh + 1);
      let norm = 0;
      for (let k = 1; k <= nh; k++) {
        const f = k * f0;
        const a = Math.exp(-(((f - f1) / 160) ** 2)) + 0.6 * Math.exp(-(((f - f2) / 220) ** 2)) + 0.25 / k;
        amps[k] = a;
        norm += a;
      }
      const consonant = r() < 0.55 ? Math.floor(0.03 * rate) : 0;
      for (let j = 0; j < sylLen && i < end; j++, i++) {
        const env = Math.sin((Math.PI * j) / sylLen) ** 0.7;
        let v = 0;
        const inc = (2 * Math.PI * f0) / rate;
        for (let k = 1; k <= nh; k++) {
          phases[k] += inc * k;
          v += amps[k] * Math.sin(phases[k]);
        }
        v = (v / norm) * env * loud;
        if (j < consonant) v += (r() - 0.5) * 0.18 * (1 - j / consonant);
        out[i] += v;
      }
      // kleine Pause zwischen Wörtern
      if (r() < 0.3) i += Math.floor((0.03 + r() * 0.06) * rate);
    }
  }
  return { agent, customer };
}

export function encodeWavStereo(left: Float32Array, right: Float32Array, rate: number): Blob {
  const frames = Math.max(left.length, right.length);
  const buffer = new ArrayBuffer(44 + frames * 4);
  const view = new DataView(buffer);
  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + frames * 4, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 2, true); // stereo
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 4, true);
  view.setUint16(32, 4, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, frames * 4, true);
  let o = 44;
  const clamp = (s: number) => (s < -1 ? -1 : s > 1 ? 1 : s);
  for (let i = 0; i < frames; i++, o += 4) {
    const l = clamp(left[i] ?? 0);
    const rr = clamp(right[i] ?? 0);
    view.setInt16(o, l < 0 ? l * 0x8000 : l * 0x7fff, true);
    view.setInt16(o + 2, rr < 0 ? rr * 0x8000 : rr * 0x7fff, true);
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

export interface DemoRecording {
  built: BuiltScript;
  wav: Blob;
  peaks: Peaks;
  talk: TalkStats;
}

export function demoDialogRecording(key: string, names: { agent: string; kunde: string }, seed = 1): DemoRecording {
  const built = buildScript(key, names, seed);
  const rate = 8000;
  const { agent, customer } = synthDialog(built, rate, seed);
  const { peaks, talk } = analyzeChannels(agent, customer, rate);
  return { built, wav: encodeWavStereo(agent, customer, rate), peaks, talk };
}

export function scriptDurationSeconds(key: string, names: { agent: string; kunde: string }, seed = 1): number {
  return Math.round(buildScript(key, names, seed).durationMs / 1000);
}
