// Abschriften (AssemblyAI, Server in der EU) und Zusammenfassungen (Claude von Anthropic).
// Reine Umwandlungen sind getrennt von den Netzwerkaufrufen, damit sie testbar bleiben.

export const ASSEMBLY_BASE = 'https://api.eu.assemblyai.com';
export const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
export const DEFAULT_SUMMARY_MODEL = 'claude-sonnet-5-5';

export interface Segment {
  speaker: 'agent' | 'customer';
  start: number; // ms
  end: number; // ms
  text: string;
}

export interface Summary {
  text: string;
  next_steps: string[];
  objections: string[];
  mood: string | null;
}

// ---------------------------------------------------------------------------
// AssemblyAI
// ---------------------------------------------------------------------------

export interface AssemblyTranscript {
  id: string;
  status: 'queued' | 'processing' | 'completed' | 'error';
  error?: string | null;
  text?: string | null;
  language_code?: string | null;
  audio_duration?: number | null;
  audio_channels?: number | null;
  utterances?: { start: number; end: number; text: string; speaker?: string | null; channel?: string | number | null }[] | null;
}

async function assembly<T>(key: string, method: 'GET' | 'POST', path: string, body?: unknown, fetchFn: typeof fetch = fetch): Promise<T> {
  const res = await fetchFn(`${ASSEMBLY_BASE}${path}`, {
    method,
    headers: { authorization: key, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: Record<string, unknown> = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    /* keine JSON-Antwort */
  }
  if (!res.ok) {
    const msg = typeof data.error === 'string' ? data.error : text.slice(0, 200);
    throw new Error(res.status === 401 ? 'AssemblyAI-Schlüssel ungültig.' : `AssemblyAI ${res.status}: ${msg}`);
  }
  return data as T;
}

export function transcriptRequest(o: {
  audioUrl: string;
  channels: number;
  webhookUrl: string | null;
  webhookToken: string | null;
  keyterms?: string[];
}): Record<string, unknown> {
  const body: Record<string, unknown> = {
    audio_url: o.audioUrl,
    language_code: 'de',
    speech_models: ['universal-3-5-pro', 'universal-2'],
    punctuate: true,
    format_text: true,
  };
  // Zwei Spuren → jede Spur getrennt abschreiben: dann ist eindeutig, wer spricht
  if (o.channels >= 2) body.multichannel = true;
  else body.speaker_labels = false;
  if (o.keyterms?.length) body.keyterms_prompt = o.keyterms.slice(0, 200);
  if (o.webhookUrl) {
    body.webhook_url = o.webhookUrl;
    if (o.webhookToken) {
      body.webhook_auth_header_name = 'x-crm-webhook';
      body.webhook_auth_header_value = o.webhookToken;
    }
  }
  return body;
}

export async function startTranscript(key: string, body: Record<string, unknown>, fetchFn?: typeof fetch): Promise<string> {
  const r = await assembly<{ id: string }>(key, 'POST', '/v2/transcript', body, fetchFn);
  if (!r.id) throw new Error('AssemblyAI hat keine Auftragsnummer geliefert.');
  return r.id;
}

export function getTranscript(key: string, id: string, fetchFn?: typeof fetch): Promise<AssemblyTranscript> {
  return assembly<AssemblyTranscript>(key, 'GET', `/v2/transcript/${encodeURIComponent(id)}`, undefined, fetchFn);
}

export async function checkAssemblyKey(key: string, fetchFn?: typeof fetch): Promise<void> {
  await assembly(key, 'GET', '/v2/transcript?limit=1', undefined, fetchFn);
}

function channelOf(u: { speaker?: string | null; channel?: string | number | null }): number | null {
  const raw = u.channel ?? u.speaker;
  if (raw == null) return null;
  const n = Number(raw);
  if (Number.isFinite(n) && n > 0) return n;
  const s = String(raw).trim().toUpperCase();
  if (s.length === 1 && s >= 'A' && s <= 'Z') return s.charCodeAt(0) - 64;
  return null;
}

// Abschrift → Abschnitte „wir“ / „Kunde“. Bei einer Spur: Mailbox = Kunde, sonst wir.
export function segmentsFrom(t: AssemblyTranscript, o: { channels: number; agentChannel: number | null; voicemail: boolean }): Segment[] {
  const utt = t.utterances ?? [];
  const agentCh = o.agentChannel ?? 1;
  if (o.channels >= 2 && utt.length) {
    return utt
      .filter((u) => (u.text ?? '').trim())
      .map((u) => ({
        speaker: channelOf(u) === agentCh ? 'agent' as const : 'customer' as const,
        start: Math.max(0, Math.round(u.start)),
        end: Math.max(0, Math.round(u.end)),
        text: u.text.trim(),
      }))
      .sort((a, b) => a.start - b.start);
  }
  const speaker = o.voicemail ? 'customer' as const : 'agent' as const;
  if (utt.length) {
    return utt.filter((u) => (u.text ?? '').trim()).map((u) => ({ speaker, start: Math.round(u.start), end: Math.round(u.end), text: u.text.trim() }));
  }
  const text = (t.text ?? '').trim();
  if (!text) return [];
  return [{ speaker, start: 0, end: Math.round((t.audio_duration ?? 0) * 1000), text }];
}

// ---------------------------------------------------------------------------
// Claude (Anthropic): Zusammenfassung mit nächsten Schritten
// ---------------------------------------------------------------------------

export function transcriptForPrompt(segments: Segment[], agentName: string, maxChars = 60_000): string {
  const fmt = (ms: number) => {
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };
  const lines = segments.map((s) => `[${fmt(s.start)}] ${s.speaker === 'agent' ? agentName || 'Vertrieb' : 'Kunde'}: ${s.text}`);
  let out = lines.join('\n');
  if (out.length > maxChars) out = out.slice(0, maxChars / 2) + '\n[…gekürzt…]\n' + out.slice(-maxChars / 2);
  return out;
}

const SUMMARY_TOOL = {
  name: 'save_summary',
  description: 'Speichert die Zusammenfassung des Verkaufsgesprächs im CRM.',
  input_schema: {
    type: 'object',
    properties: {
      text: { type: 'string', description: '2–4 Sätze: Worum ging es, was wurde vereinbart?' },
      next_steps: { type: 'array', items: { type: 'string' }, description: 'Konkrete nächste Schritte (max. 5), als kurze Aufgaben formuliert.' },
      objections: { type: 'array', items: { type: 'string' }, description: 'Einwände oder Bedenken des Kunden (max. 5).' },
      mood: { type: 'string', enum: ['positiv', 'neutral', 'skeptisch', 'negativ'], description: 'Grundstimmung des Kunden.' },
    },
    required: ['text', 'next_steps', 'objections', 'mood'],
  },
};

export function summaryRequest(o: {
  model: string;
  transcript: string;
  leadName: string | null;
  agentName: string;
  orgName: string;
  voicemail: boolean;
}): Record<string, unknown> {
  const what = o.voicemail ? 'eine Nachricht, die ein Anrufer auf der Mailbox hinterlassen hat' : 'ein Telefonat aus dem Vertrieb';
  return {
    model: o.model,
    max_tokens: 1200,
    system:
      `Du fasst für das CRM von ${o.orgName || 'einem Vertriebsteam'} ${what} zusammen. ` +
      'Schreibe sachlich auf Deutsch, ohne Floskeln. Erfinde nichts: Was nicht im Gespräch vorkommt, lässt du weg. ' +
      'Nächste Schritte nur, wenn sie sich aus dem Gespräch ergeben (z. B. Rückruf, Angebot schicken, Termin bestätigen). ' +
      'Namen, Daten und Uhrzeiten genau übernehmen.',
    tools: [SUMMARY_TOOL],
    tool_choice: { type: 'tool', name: 'save_summary' },
    messages: [
      {
        role: 'user',
        content: `${o.leadName ? `Kunde/Lead: ${o.leadName}\n` : ''}Abschrift:\n${o.transcript}`,
      },
    ],
  };
}

export function parseSummary(resp: { content?: { type: string; name?: string; input?: unknown; text?: string }[] }): Summary {
  const tool = resp.content?.find((c) => c.type === 'tool_use' && c.name === 'save_summary');
  const input = (tool?.input ?? null) as Partial<Summary> | null;
  if (!input || typeof input.text !== 'string') {
    const text = resp.content?.find((c) => c.type === 'text')?.text?.trim();
    if (!text) throw new Error('Die KI hat keine Zusammenfassung geliefert.');
    return { text, next_steps: [], objections: [], mood: null };
  }
  const list = (v: unknown) => (Array.isArray(v) ? v.map(String).map((s) => s.trim()).filter(Boolean).slice(0, 5) : []);
  return { text: input.text.trim(), next_steps: list(input.next_steps), objections: list(input.objections), mood: input.mood ? String(input.mood) : null };
}

export async function callClaude(key: string, body: Record<string, unknown>, fetchFn: typeof fetch = fetch): Promise<Record<string, unknown>> {
  let last = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetchFn(ANTHROPIC_URL, {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (res.ok) return JSON.parse(text);
    last = `${res.status}: ${text.slice(0, 200)}`;
    if (res.status === 401) throw new Error('Anthropic-Schlüssel ungültig.');
    if (res.status !== 429 && res.status !== 529 && res.status < 500) break;
    await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
  }
  throw new Error(`Anthropic ${last}`);
}

export async function checkAnthropicKey(key: string, model: string, fetchFn?: typeof fetch): Promise<void> {
  await callClaude(key, { model, max_tokens: 5, messages: [{ role: 'user', content: 'Antworte nur mit OK.' }] }, fetchFn);
}
