// Aufnahmen: WAV lesen, große Uploads, MP3-Ausweichlösung, Abschrift-Zuordnung, Zusammenfassung, Rufverteilung.

import { parseSummary, segmentsFrom, summaryRequest, transcriptForPrompt, transcriptRequest } from '../_shared/ai.ts';
import { berlinClock, isOpen, pickCallerId } from '../_shared/routing.ts';
import { type MediaSink, recordingPath, STANDARD_LIMIT, storeRecording } from '../_shared/recording.ts';
import { createResumableUpload, TUS_CHUNK, tusEndpoint } from '../_shared/tus.ts';
import { encodeWav16, parseWavHeader, WavAnalyzer } from '../_shared/wav.ts';
import { assert, assertEquals } from '../_shared/test_utils.ts';

function speech(seconds: number, talkFrom: number, talkTo: number, sr = 8000): Float32Array {
  const out = new Float32Array(Math.round(seconds * sr));
  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    out[i] = t >= talkFrom && t < talkTo ? 0.3 * Math.sin(2 * Math.PI * 190 * t) * (0.7 + 0.3 * Math.sin(t * 9)) : 0.0015 * Math.sin(t * 40);
  }
  return out;
}

Deno.test('WAV: Kopf auch in Einzelteilen, beliebige Stückgrößen, Redeanteile je Spur', () => {
  const wav = encodeWav16([speech(6, 0, 3), speech(6, 3, 6)], 8000);
  assertEquals(parseWavHeader(wav.subarray(0, 20)), null, 'unvollständiger Kopf');
  const a = new WavAnalyzer();
  for (let i = 0; i < wav.length; i += 4099) a.push(wav.subarray(i, Math.min(wav.length, i + 4099)));
  const r = a.finish(1);
  assertEquals(r.format.channels, 2);
  assertEquals(r.durationMs, 6000);
  assert(Math.abs(r.talk!.agent_ms - 3000) <= 300 && Math.abs(r.talk!.customer_ms - 3000) <= 300, JSON.stringify(r.talk));
  assert(r.talk!.overlap_ms <= 300, 'kaum Überlappung');
  // Spur 2 als „wir“ → Werte tauschen
  const b = new WavAnalyzer();
  b.push(wav);
  const s = b.finish(2);
  assertEquals([s.talk!.agent_ms, s.talk!.customer_ms], [r.talk!.customer_ms, r.talk!.agent_ms]);
  assertEquals(s.peaks.agent, r.peaks.customer);
});

Deno.test('WAV: Mono (Mailbox) hat eine Spur und keine Redeanteile', () => {
  const a = new WavAnalyzer();
  a.push(encodeWav16([speech(3, 0.5, 2.5)], 8000));
  const r = a.finish(null);
  assertEquals([r.peaks.customer.length, r.talk], [0, null]);
  assert(r.peaks.agent.length > 50);
});

Deno.test('WAV: lange Aufnahmen werden ausgedünnt ausgewertet (Rechenzeit), Ergebnis bleibt gleich', () => {
  const wav = encodeWav16([speech(20, 0, 10), speech(20, 10, 20)], 8000);
  const full = new WavAnalyzer();
  full.push(wav);
  const thin = new WavAnalyzer({ maxFrames: 40_000 }); // 160 000 Frames → jeder 4. Wert
  for (let i = 0; i < wav.length; i += 1001) thin.push(wav.subarray(i, Math.min(wav.length, i + 1001)));
  const a = full.finish(1);
  const b = thin.finish(1);
  assertEquals(b.durationMs, a.durationMs);
  assert(Math.abs(a.talk!.agent_ms - b.talk!.agent_ms) <= 400, `${a.talk!.agent_ms} vs ${b.talk!.agent_ms}`);
  assertEquals(b.peaks.agent.length, a.peaks.agent.length);
});

Deno.test('WAV: falsches Format wird erkannt', () => {
  let failed = false;
  try {
    new WavAnalyzer().push(new TextEncoder().encode('ID3\u0003\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000'));
  } catch (e) {
    failed = String(e).includes('Keine WAV');
  }
  assert(failed);
});

// ---------------------------------------------------------------------------
// Speichern
// ---------------------------------------------------------------------------
function source(wav: Uint8Array, mp3 = new Uint8Array([1, 2, 3])) {
  const asked: string[] = [];
  return {
    asked,
    async fetchMedia(_u: string, format: 'wav' | 'mp3', channels: number) {
      asked.push(`${format}/${channels}`);
      const bytes = format === 'wav' ? wav : mp3;
      // in kleinen Stücken liefern, wie über das Netz
      const stream = new ReadableStream<Uint8Array>({
        start(c) {
          for (let i = 0; i < bytes.length; i += 65536) c.enqueue(bytes.slice(i, i + 65536));
          c.close();
        },
      });
      return new Response(stream, { headers: { 'content-length': String(bytes.length) } });
    },
  };
}

class Sink implements MediaSink {
  uploads: { path: string; size: number; type: string }[] = [];
  resumed: { path: string; size: number; written: number; finished: boolean }[] = [];
  constructor(private allowResumable = true) {}
  async upload(_b: string, path: string, bytes: Uint8Array, type: string) {
    this.uploads.push({ path, size: bytes.length, type });
  }
  async resumable(_b: string, path: string, size: number) {
    if (!this.allowResumable) throw new Error('413 Payload too large');
    const entry = { path, size, written: 0, finished: false };
    this.resumed.push(entry);
    return {
      write: async (c: Uint8Array) => void (entry.written += c.length),
      finish: async () => void (entry.finished = true),
      abort: async () => undefined,
    };
  }
}

const input = (extra: Partial<Parameters<typeof storeRecording>[2]> = {}) => ({
  recordingUrl: 'https://api.twilio.com/2010-04-01/Accounts/AC1/Recordings/RE1',
  recordingSid: 'RE1',
  callId: '20000000-0000-4000-8000-000000000001',
  startedAt: '2026-10-07T10:00:00Z',
  channels: 2,
  agentChannel: 1,
  kind: 'recording' as const,
  preferMp3: false,
  ...extra,
});

Deno.test('Speichern: normale Länge als WAV in einem Stück, beide Spuren angefordert', async () => {
  const src = source(encodeWav16([speech(5, 0, 2), speech(5, 2, 5)], 8000));
  const sink = new Sink();
  const r = await storeRecording(src, sink, input());
  assertEquals(src.asked, ['wav/2']);
  assertEquals([r.format, r.path, sink.uploads[0].type], ['wav', '2026/10/20000000-0000-4000-8000-000000000001-RE1.wav', 'audio/wav']);
  assertEquals(r.channels, 2);
});

Deno.test('Speichern: sehr lang → stückweise hochladen; Speicher lehnt ab → MP3', async () => {
  // ~46 MB Stereo (knapp 12 Minuten bei 32 kB/s … hier synthetisch über die Grenze)
  const frames = Math.ceil((STANDARD_LIMIT + 1_000_000) / 4);
  const big = encodeWav16([new Float32Array(frames), new Float32Array(frames)], 8000);
  const sink = new Sink();
  const r = await storeRecording(source(big), sink, input());
  assertEquals([r.format, sink.uploads.length, sink.resumed[0].finished, sink.resumed[0].written], ['wav', 0, true, big.length]);

  const sink2 = new Sink(false);
  const src2 = source(big);
  const r2 = await storeRecording(src2, sink2, input());
  assertEquals([r2.format, sink2.uploads[0].type, src2.asked], ['mp3', 'audio/mpeg', ['wav/2', 'mp3/2']]);
  assert(r2.note?.includes('MP3'));
  assert(r2.peaks!.agent.length > 100, 'Wellenform trotzdem aus der WAV');
});

Deno.test('Speichern: Mailbox landet im Ordner mailbox/', () => {
  assertEquals(recordingPath('voicemail', '2026-01-05T09:00:00Z', 'id', 'RE2', 'wav'), 'mailbox/2026/01/id-RE2.wav');
});

Deno.test('TUS: Stücke zu genau 6 MB, Wiederaufnahme nach Konflikt', async () => {
  const log: string[] = [];
  let serverOffset = 0;
  let failOnce = true;
  const fakeFetch = (async (url: string | URL, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const h = new Headers(init?.headers);
    if (method === 'POST') {
      log.push(`POST ${h.get('Upload-Length')} ${h.get('x-upsert')}`);
      return new Response(null, { status: 201, headers: { Location: 'https://abc.storage.supabase.co/storage/v1/upload/resumable/xyz' } });
    }
    if (method === 'HEAD') return new Response(null, { status: 200, headers: { 'Upload-Offset': String(serverOffset) } });
    if (method === 'PATCH') {
      const len = (init!.body as Uint8Array).length;
      log.push(`PATCH ${h.get('Upload-Offset')} ${len}`);
      if (failOnce && serverOffset > 0) {
        failOnce = false;
        serverOffset += 1000; // Server hat einen Teil schon bekommen
        return new Response(null, { status: 409 });
      }
      serverOffset = Number(h.get('Upload-Offset')) + len;
      return new Response(null, { status: 204, headers: { 'Upload-Offset': String(serverOffset) } });
    }
    return new Response(null, { status: 404 });
  }) as typeof fetch;
  assertEquals(tusEndpoint('https://abc.supabase.co'), 'https://abc.storage.supabase.co/storage/v1/upload/resumable');
  const size = TUS_CHUNK * 2 + 5000;
  const up = await createResumableUpload({ supabaseUrl: 'https://abc.supabase.co', key: 'k', bucket: 'recordings', path: 'a.wav', size, contentType: 'audio/wav', fetchFn: fakeFetch });
  for (let i = 0; i < size; i += 700_000) await up.write(new Uint8Array(Math.min(700_000, size - i)));
  await up.finish();
  assertEquals(log[0], `POST ${size} true`);
  assertEquals(log[1], `PATCH 0 ${TUS_CHUNK}`);
  assert(log.includes(`PATCH ${TUS_CHUNK + 1000} ${TUS_CHUNK - 1000}`), log.join(' | '));
  assertEquals(serverOffset, size);
});

// ---------------------------------------------------------------------------
// Abschrift & Zusammenfassung
// ---------------------------------------------------------------------------
Deno.test('Abschrift: zwei Spuren → wir/Kunde nach Spur, Anfrage in der EU mit Deutsch', () => {
  const body = transcriptRequest({ audioUrl: 'https://x/a.wav', channels: 2, webhookUrl: 'https://f/ai-webhook?callId=1', webhookToken: 'tok' });
  assertEquals([body.language_code, body.multichannel, body.webhook_auth_header_name], ['de', true, 'x-crm-webhook']);
  const t = {
    id: 't',
    status: 'completed' as const,
    utterances: [
      { start: 2500, end: 4000, text: 'Ja, gerne.', channel: '2' },
      { start: 0, end: 2000, text: 'Guten Tag, Salus Digital.', channel: '1' },
    ],
  };
  const seg = segmentsFrom(t, { channels: 2, agentChannel: 1, voicemail: false });
  assertEquals(seg.map((s) => s.speaker), ['agent', 'customer']);
  const swapped = segmentsFrom(t, { channels: 2, agentChannel: 2, voicemail: false });
  assertEquals(swapped.map((s) => s.speaker), ['customer', 'agent']);
  const vm = segmentsFrom({ id: 'v', status: 'completed', text: 'Bitte zurückrufen.', audio_duration: 4 }, { channels: 1, agentChannel: null, voicemail: true });
  assertEquals(vm, [{ speaker: 'customer', start: 0, end: 4000, text: 'Bitte zurückrufen.' }]);
});

Deno.test('Zusammenfassung: Anfrage erzwingt das Werkzeug, Antwort wird sauber gelesen', () => {
  const req = summaryRequest({ model: 'claude-sonnet-5-5', transcript: transcriptForPrompt([{ speaker: 'agent', start: 61000, end: 62000, text: 'Hallo' }], 'Max'), leadName: 'Löwen-Apotheke', agentName: 'Max', orgName: 'Salus', voicemail: false });
  assertEquals((req.tool_choice as { name: string }).name, 'save_summary');
  assert(String((req.messages as { content: string }[])[0].content).includes('[1:01] Max: Hallo'));
  const s = parseSummary({ content: [{ type: 'tool_use', name: 'save_summary', input: { text: ' Termin vereinbart. ', next_steps: ['Angebot schicken', ''], objections: [], mood: 'positiv' } }] });
  assertEquals(s, { text: 'Termin vereinbart.', next_steps: ['Angebot schicken'], objections: [], mood: 'positiv' });
});

// ---------------------------------------------------------------------------
// Rufzeiten & Absender
// ---------------------------------------------------------------------------
Deno.test('Rufzeiten: Berliner Zeit inkl. Sommer-/Winterzeit', () => {
  assertEquals(berlinClock(new Date('2026-07-01T06:30:00Z')), { day: 'wed', hm: '08:30' }); // Sommerzeit
  assertEquals(berlinClock(new Date('2026-12-02T07:30:00Z')), { day: 'wed', hm: '08:30' }); // Winterzeit
  const hours = { wed: [['08:00', '12:00'], ['13:00', '18:00']] as [string, string][] };
  assert(isOpen(hours, new Date('2026-07-01T06:30:00Z')));
  assert(!isOpen(hours, new Date('2026-07-01T10:30:00Z')), 'Mittagspause');
  assert(!isOpen(hours, new Date('2026-07-02T08:00:00Z')), 'Donnerstag nicht eingetragen');
  assert(isOpen(null, new Date()), 'ohne Rufzeiten immer');
});

Deno.test('Absender: angefragte Nummer nur, wenn sie uns gehört; Local Presence mit längster Vorwahl', () => {
  const numbers = [
    { number: '+4969000000', available_to_all: true, members: [] },
    { number: '+49618199000', available_to_all: true, members: [] },
    { number: '+4930111111', available_to_all: false, members: ['u2'] },
  ];
  const base = { profileNumber: null, orgDefault: '+4969000000', numbers, userId: 'u1', to: '+496181555', localPresence: false };
  assertEquals(pickCallerId({ ...base, requested: '+4930111111' }), '+4969000000', 'gehört u1 nicht');
  assertEquals(pickCallerId({ ...base, requested: '+49618199000' }), '+49618199000');
  assertEquals(pickCallerId({ ...base, requested: null, localPresence: true }), '+49618199000');
  assertEquals(pickCallerId({ ...base, requested: null, localPresence: true, to: '+4940123456' }), '+4969000000', 'keine passende Vorwahl');
});
