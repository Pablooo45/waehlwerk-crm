// Kleine Helfer für Antworten, CORS und Fehler.

export const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

export class HttpError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export function xml(body: string): Response {
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/xml; charset=utf-8' } });
}

export function errorResponse(e: unknown): Response {
  if (e instanceof HttpError) return json({ error: e.message, details: e.details ?? null }, e.status);
  const message = e instanceof Error ? e.message : String(e);
  return json({ error: message }, 500);
}

export function preflight(req: Request): Response | null {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  return null;
}

export async function readJson<T = Record<string, unknown>>(req: Request): Promise<T> {
  try {
    const text = await req.text();
    return (text ? JSON.parse(text) : {}) as T;
  } catch {
    throw new HttpError(400, 'Ungültige Anfrage (kein JSON).');
  }
}

// Twilio schickt Formulardaten (application/x-www-form-urlencoded)
export async function readForm(req: Request): Promise<{ params: Record<string, string>; raw: string }> {
  const raw = await req.text();
  const params: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(raw)) params[k] = v;
  return { params, raw };
}

// Im Hintergrund weiterarbeiten, nachdem die Antwort schon raus ist (Twilio wartet max. 15 s).
export function background(task: Promise<unknown>): void {
  const rt = (globalThis as unknown as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime;
  const safe = task.catch((e) => console.error('Hintergrundaufgabe fehlgeschlagen', e));
  if (rt?.waitUntil) rt.waitUntil(safe);
}

export function isUuid(v: unknown): v is string {
  return typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}
