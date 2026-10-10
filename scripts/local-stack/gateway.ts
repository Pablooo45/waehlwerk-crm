// Lokales Supabase-Gateway (nur zum Testen, siehe scripts/local-stack.sh):
//   /rest/v1/*      → PostgREST
//   /auth/v1/*      → Supabase Auth
//   /functions/v1/* → die eigenen Server-Funktionen, direkt in diesem Prozess
//   /storage/v1/*   → einfacher Dateispeicher auf der Festplatte
//   /realtime/v1/*  → Realtime-Attrappe (nimmt Abos an, sendet keine Änderungen)
// Dazu auf einem zweiten Port die gebaute Website (dist/).

const PORT = Number(Deno.env.get('GATEWAY_PORT') ?? 54321);
const APP_PORT = Number(Deno.env.get('APP_PORT') ?? 54320);
const REST = Deno.env.get('REST_URL') ?? 'http://127.0.0.1:54331';
const AUTH = Deno.env.get('AUTH_URL') ?? 'http://127.0.0.1:54332';
const STORAGE_DIR = Deno.env.get('STORAGE_DIR') ?? './.local-stack/storage';
const APP_DIR = Deno.env.get('APP_DIR') ?? '';
const JWT_SECRET = Deno.env.get('JWT_SECRET') ?? '';
const FUNCTIONS_DIR = new URL('../../supabase/functions/', import.meta.url);

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, prefer, range, accept-profile, content-profile, x-upsert, x-supabase-api-version, cache-control, x-region, x-requested-with',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD',
  'Access-Control-Expose-Headers': 'content-range, content-location, x-total-count, x-supabase-api-version',
  'Access-Control-Max-Age': '86400',
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

// ---------------------------------------------------------------------------
// Server-Funktionen laden: Deno.serve abfangen, damit jede Funktion ihren Handler hergibt
// ---------------------------------------------------------------------------
type Handler = (req: Request) => Response | Promise<Response>;
const handlers = new Map<string, Handler>();
// deno-lint-ignore no-explicit-any
const D = Deno as any;
const realServe = D.serve;
let loading = '';
D.serve = (a: unknown, b?: unknown) => {
  // deno-lint-ignore no-explicit-any
  const h = (typeof a === 'function' ? a : typeof b === 'function' ? b : (a as any)?.handler) as Handler;
  handlers.set(loading, h);
  return { finished: Promise.resolve(), shutdown: async () => {}, ref() {}, unref() {}, addr: { hostname: '127.0.0.1', port: 0, transport: 'tcp' } };
};
for await (const e of Deno.readDir(FUNCTIONS_DIR)) {
  if (!e.isDirectory || e.name.startsWith('_')) continue;
  loading = e.name;
  try {
    await import(new URL(`${e.name}/index.ts`, FUNCTIONS_DIR).href);
  } catch (err) {
    console.error(`Funktion ${e.name} lässt sich nicht laden:`, err);
  }
}
D.serve = realServe;
console.log(`Server-Funktionen: ${[...handlers.keys()].sort().join(', ')}`);

// ---------------------------------------------------------------------------
// JWT prüfen (HS256) – für Speicher und Realtime
// ---------------------------------------------------------------------------
const enc = new TextEncoder();
function b64urlDecode(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}
async function verifyJwt(token: string | null): Promise<Record<string, unknown> | null> {
  if (!token) return null;
  const [h, p, s] = token.split('.');
  if (!h || !p || !s) return null;
  const key = await crypto.subtle.importKey('raw', enc.encode(JWT_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('HMAC', key, b64urlDecode(s), enc.encode(`${h}.${p}`));
  if (!ok) return null;
  const claims = JSON.parse(new TextDecoder().decode(b64urlDecode(p)));
  if (claims.exp && claims.exp * 1000 < Date.now()) return null;
  return claims;
}
const bearer = (req: Request) => req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? null;

// ---------------------------------------------------------------------------
// Weiterleiten an PostgREST / Auth
// ---------------------------------------------------------------------------
async function proxy(req: Request, base: string, path: string): Promise<Response> {
  const url = new URL(req.url);
  const headers = new Headers(req.headers);
  headers.delete('host');
  const init: RequestInit & { duplex?: string } = { method: req.method, headers, redirect: 'manual' };
  if (!['GET', 'HEAD'].includes(req.method)) {
    init.body = req.body;
    init.duplex = 'half';
  }
  const res = await fetch(base + path + url.search, init);
  const out = new Headers(res.headers);
  out.delete('content-encoding');
  out.delete('content-length');
  for (const [k, v] of Object.entries(CORS)) out.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: out });
}

// ---------------------------------------------------------------------------
// Speicher: Dateien unter STORAGE_DIR/<bucket>/<pfad>
// ---------------------------------------------------------------------------
const signed = new Map<string, { bucket: string; path: string; until: number }>();
const fileOf = (bucket: string, path: string) => `${STORAGE_DIR}/${bucket}/${path}`;
const safePath = (p: string) => decodeURIComponent(p).split('/').filter((x) => x && x !== '..' && x !== '.').join('/');

async function storage(req: Request, rest: string): Promise<Response> {
  const url = new URL(req.url);
  // signierte Links brauchen keine Anmeldung
  let m = /^\/object\/sign\/([^/]+)\/(.+)$/.exec(rest);
  if (m && req.method === 'GET') {
    const token = url.searchParams.get('token') ?? '';
    const hit = signed.get(token);
    if (!hit || hit.until < Date.now() || hit.bucket !== m[1] || hit.path !== safePath(m[2])) return json({ error: 'Ungültiger Link' }, 400);
    return serveFile(fileOf(hit.bucket, hit.path), url.searchParams.has('download'));
  }
  const claims = await verifyJwt(bearer(req));
  if (!claims || claims.role === 'anon') return json({ statusCode: '403', error: 'Unauthorized', message: 'Anmeldung fehlt' }, 403);

  if (m && req.method === 'POST') {
    const token = crypto.randomUUID();
    const { expiresIn = 60 } = await req.json().catch(() => ({}));
    signed.set(token, { bucket: m[1], path: safePath(m[2]), until: Date.now() + Number(expiresIn) * 1000 });
    return json({ signedURL: `/object/sign/${m[1]}/${m[2]}?token=${token}` });
  }
  m = /^\/object\/sign\/([^/]+)$/.exec(rest);
  if (m && req.method === 'POST') {
    const { expiresIn = 60, paths = [] } = await req.json();
    return json(
      (paths as string[]).map((p) => {
        const token = crypto.randomUUID();
        signed.set(token, { bucket: m![1], path: safePath(p), until: Date.now() + Number(expiresIn) * 1000 });
        return { error: null, path: p, signedURL: `/object/sign/${m![1]}/${p}?token=${token}` };
      }),
    );
  }
  m = /^\/object\/list\/([^/]+)$/.exec(rest);
  if (m && req.method === 'POST') {
    const { prefix = '' } = await req.json().catch(() => ({}));
    const dir = fileOf(m[1], safePath(prefix));
    const out: unknown[] = [];
    try {
      for await (const e of Deno.readDir(dir)) out.push({ name: e.name, id: e.isFile ? e.name : null, metadata: e.isFile ? {} : null });
    } catch { /* leer */ }
    return json(out);
  }
  m = /^\/object\/([^/]+)$/.exec(rest);
  if (m && req.method === 'DELETE') {
    const { prefixes = [] } = await req.json().catch(() => ({}));
    const removed = [];
    for (const p of prefixes as string[]) {
      try {
        await Deno.remove(fileOf(m[1], safePath(p)));
        removed.push({ name: p, bucket_id: m[1] });
      } catch { /* gab es nicht */ }
    }
    return json(removed);
  }
  m = /^\/object\/(?:authenticated\/|public\/)?([^/]+)\/(.+)$/.exec(rest);
  if (m && (req.method === 'POST' || req.method === 'PUT')) {
    const path = safePath(m[2]);
    const file = fileOf(m[1], path);
    const exists = await Deno.stat(file).then(() => true, () => false);
    if (exists && req.method === 'POST' && req.headers.get('x-upsert') !== 'true') return json({ statusCode: '409', error: 'Duplicate', message: 'Die Datei gibt es schon' }, 409);
    await Deno.mkdir(file.slice(0, file.lastIndexOf('/')), { recursive: true });
    let body = new Uint8Array(await req.arrayBuffer());
    const type = req.headers.get('content-type') ?? '';
    if (type.startsWith('multipart/form-data')) {
      const form = await new Request('http://x', { method: 'POST', headers: { 'content-type': type }, body }).formData();
      const f = [...form.values()].find((v) => v instanceof File) as File | undefined;
      if (f) body = new Uint8Array(await f.arrayBuffer());
    }
    await Deno.writeFile(file, body);
    return json({ Key: `${m[1]}/${path}`, Id: crypto.randomUUID() });
  }
  if (m && (req.method === 'GET' || req.method === 'HEAD')) return serveFile(fileOf(m[1], safePath(m[2])), false);
  return json({ error: 'Nicht unterstützt', path: rest, method: req.method }, 404);
}

async function serveFile(file: string, download: boolean): Promise<Response> {
  try {
    const data = await Deno.readFile(file);
    const headers: Record<string, string> = { ...CORS, 'Content-Type': contentType(file) };
    if (download) headers['Content-Disposition'] = `attachment; filename="${file.split('/').pop()}"`;
    return new Response(data, { headers });
  } catch {
    return json({ statusCode: '404', error: 'not_found', message: 'Datei nicht gefunden' }, 404);
  }
}

function contentType(file: string): string {
  const ext = file.split('.').pop()?.toLowerCase() ?? '';
  return (
    {
      html: 'text/html; charset=utf-8',
      js: 'text/javascript; charset=utf-8',
      css: 'text/css; charset=utf-8',
      json: 'application/json',
      svg: 'image/svg+xml',
      png: 'image/png',
      ico: 'image/x-icon',
      webmanifest: 'application/manifest+json',
      wav: 'audio/wav',
      mp3: 'audio/mpeg',
      pdf: 'application/pdf',
      txt: 'text/plain; charset=utf-8',
      woff2: 'font/woff2',
    } as Record<string, string>
  )[ext] ?? 'application/octet-stream';
}

// ---------------------------------------------------------------------------
// Realtime-Attrappe (Phoenix-Protokoll 1.0 und 2.0): Abos werden bestätigt, Änderungen kommen keine
// ---------------------------------------------------------------------------
function realtime(req: Request): Response {
  const { socket, response } = Deno.upgradeWebSocket(req);
  const v2 = new URL(req.url).searchParams.get('vsn') === '2.0.0';
  const send = (joinRef: string | null, ref: string | null, topic: string, event: string, payload: unknown) =>
    socket.send(JSON.stringify(v2 ? [joinRef, ref, topic, event, payload] : { topic, event, payload, ref, join_ref: joinRef }));
  socket.onmessage = (ev) => {
    let msg: { join_ref?: string | null; ref?: string | null; topic: string; event: string; payload: Record<string, unknown> };
    try {
      const raw = JSON.parse(String(ev.data));
      msg = Array.isArray(raw) ? { join_ref: raw[0], ref: raw[1], topic: raw[2], event: raw[3], payload: raw[4] } : raw;
    } catch {
      return;
    }
    const joinRef = msg.join_ref ?? null;
    if (msg.event === 'phx_join') {
      // deno-lint-ignore no-explicit-any
      const changes = ((msg.payload?.config as any)?.postgres_changes ?? []) as Record<string, unknown>[];
      send(joinRef, msg.ref ?? null, msg.topic, 'phx_reply', {
        status: 'ok',
        response: { postgres_changes: changes.map((c, i) => ({ ...c, id: i + 1 })) },
      });
    } else if (msg.event === 'phx_leave' || msg.event === 'heartbeat' || msg.event === 'access_token') {
      send(joinRef, msg.ref ?? null, msg.topic, 'phx_reply', { status: 'ok', response: {} });
    }
  };
  return response;
}

// ---------------------------------------------------------------------------
// Gateway
// ---------------------------------------------------------------------------
Deno.serve({ port: PORT, hostname: '127.0.0.1', onListen: () => console.log(`Gateway auf http://127.0.0.1:${PORT}`) }, async (req) => {
  const url = new URL(req.url);
  const path = url.pathname;
  try {
    if (path === '/__health') return json({ ok: true, functions: [...handlers.keys()] });
    if (path.startsWith('/functions/v1/')) {
      const [, name, ...rest] = path.slice('/functions/v1'.length).split('/');
      const h = handlers.get(name);
      if (!h) return json({ error: `Funktion ${name} gibt es nicht` }, 404);
      const inner = new Request(`http://127.0.0.1:${PORT}/${name}${rest.length ? `/${rest.join('/')}` : ''}${url.search}`, req);
      return await h(inner);
    }
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (path.startsWith('/rest/v1')) return await proxy(req, REST, path.slice('/rest/v1'.length) || '/');
    if (path.startsWith('/auth/v1')) return await proxy(req, AUTH, path.slice('/auth/v1'.length) || '/');
    if (path.startsWith('/storage/v1')) return await storage(req, path.slice('/storage/v1'.length));
    if (path.startsWith('/realtime/v1') && req.headers.get('upgrade')?.toLowerCase() === 'websocket') return realtime(req);
    return json({ error: 'Unbekannter Pfad', path }, 404);
  } catch (e) {
    console.error(`${req.method} ${path}:`, e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 502);
  }
});

// Website (dist/) auf einem eigenen Port – wie GitHub Pages: andere Herkunft als die Datenbank
if (APP_DIR) {
  Deno.serve({ port: APP_PORT, hostname: '127.0.0.1', onListen: () => console.log(`Website auf http://127.0.0.1:${APP_PORT}`) }, async (req) => {
    const p = safePath(new URL(req.url).pathname) || 'index.html';
    const file = `${APP_DIR}/${p}`;
    const isFile = await Deno.stat(file).then((s) => s.isFile, () => false);
    const target = isFile ? file : `${APP_DIR}/index.html`;
    const data = await Deno.readFile(target);
    return new Response(data, { headers: { 'Content-Type': contentType(target), 'Cache-Control': 'no-store' } });
  });
}
