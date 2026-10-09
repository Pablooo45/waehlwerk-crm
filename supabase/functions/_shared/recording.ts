// Gesprächsaufnahme von Twilio holen, auswerten und in den eigenen Speicher (EU) legen.
//
// • Standard: WAV (verlustfrei, 8 kHz/16 Bit, bei zwei Spuren Stereo: wir + Kunde getrennt)
// • Wellenform und Redeanteile werden beim Herunterladen nebenbei berechnet (kein zweiter Durchlauf)
// • Bis 45 MB (≈ 23 Min. Stereo) in einem Rutsch; größer → stückweise (TUS);
//   lehnt der Speicher die Größe ab (z. B. 50-MB-Grenze im Free-Plan) → automatisch MP3
// • Einstellung „MP3“: Auswertung aus der WAV, gespeichert wird die kleine MP3

import type { Peaks, TalkStats } from './analysis.ts';
import type { ResumableUpload } from './tus.ts';
import { WavAnalyzer } from './wav.ts';

export const STANDARD_LIMIT = 45 * 1024 * 1024;

export interface MediaSource {
  fetchMedia(recordingUrl: string, format: 'wav' | 'mp3', channels: number): Promise<Response>;
}

export interface MediaSink {
  upload(bucket: string, path: string, bytes: Uint8Array, contentType: string): Promise<void>;
  resumable?(bucket: string, path: string, size: number, contentType: string): Promise<ResumableUpload>;
}

export interface StoreInput {
  recordingUrl: string;
  recordingSid: string;
  callId: string;
  startedAt: string | null;
  channels: number;
  agentChannel: number | null;
  kind: 'recording' | 'voicemail';
  preferMp3: boolean;
}

export interface StoredRecording {
  path: string;
  format: 'wav' | 'mp3';
  bytes: number;
  channels: number;
  durationMs: number;
  peaks: Peaks | null;
  talk: TalkStats | null;
  note?: string;
}

// recordings/2026/10/<anruf-id>-<RE…>.wav – die Anruf-ID im Namen prüft die Datenbank beim Anhören (Rechte)
export function recordingPath(kind: StoreInput['kind'], startedAt: string | null, callId: string, sid: string, ext: 'wav' | 'mp3'): string {
  const d = new Date(startedAt || Date.now());
  const folder = `${kind === 'voicemail' ? 'mailbox/' : ''}${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  return `${folder}/${callId}-${sid}.${ext}`;
}

function join(parts: Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export async function storeRecording(src: MediaSource, sink: MediaSink, input: StoreInput): Promise<StoredRecording> {
  const res = await src.fetchMedia(input.recordingUrl, 'wav', input.channels);
  const size = Number(res.headers.get('content-length')) || null;
  const analyzer = new WavAnalyzer({ expectedBytes: size });
  const wavPath = recordingPath(input.kind, input.startedAt, input.callId, input.recordingSid, 'wav');
  const reader = res.body!.getReader();

  let mode: 'buffer' | 'resumable' | 'analyze' = input.preferMp3 ? 'analyze' : 'buffer';
  let note: string | undefined;
  const buffered: Uint8Array[] = [];
  let bufBytes = 0;
  let up: ResumableUpload | null = null;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.length) continue;
      analyzer.push(value);
      if (mode === 'buffer') {
        buffered.push(value);
        bufBytes += value.length;
        if (bufBytes > STANDARD_LIMIT) {
          // Sehr langes Gespräch: stückweise weiter hochladen
          if (size && sink.resumable) {
            try {
              up = await sink.resumable('recordings', wavPath, size, 'audio/wav');
              for (const b of buffered) await up.write(b);
              mode = 'resumable';
            } catch (e) {
              await up?.abort();
              up = null;
              mode = 'analyze';
              note = `WAV zu groß für den Speicher (${e instanceof Error ? e.message : e}) – als MP3 gespeichert.`;
            }
          } else {
            mode = 'analyze';
            note = 'WAV zu groß – als MP3 gespeichert.';
          }
          buffered.length = 0;
          bufBytes = 0;
        }
      } else if (mode === 'resumable') {
        await up!.write(value);
      }
    }
  } catch (e) {
    await up?.abort();
    throw e;
  }

  const analysis = analyzer.finish(input.agentChannel);
  const channels = analysis.format.channels;
  const base = {
    channels,
    durationMs: analysis.durationMs,
    peaks: analysis.peaks,
    talk: analysis.talk,
  };

  if (mode === 'buffer') {
    const bytes = join(buffered, bufBytes);
    await sink.upload('recordings', wavPath, bytes, 'audio/wav');
    return { ...base, path: wavPath, format: 'wav', bytes: bytes.length };
  }
  if (mode === 'resumable') {
    await up!.finish();
    return { ...base, path: wavPath, format: 'wav', bytes: size ?? analyzer.bytes };
  }

  // MP3 speichern (Einstellung oder zu groß)
  const mp3 = await src.fetchMedia(input.recordingUrl, 'mp3', input.channels);
  const bytes = new Uint8Array(await mp3.arrayBuffer());
  const mp3Path = recordingPath(input.kind, input.startedAt, input.callId, input.recordingSid, 'mp3');
  await sink.upload('recordings', mp3Path, bytes, 'audio/mpeg');
  return { ...base, path: mp3Path, format: 'mp3', bytes: bytes.length, note };
}
