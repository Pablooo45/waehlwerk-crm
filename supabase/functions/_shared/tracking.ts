// E-Mail-Öffnungen und Link-Klicks (wie in Close): Zählpixel und Weiterleitungs-Links mit Signatur.
// Die Links zeigen auf die Server-Funktion „email-track“. Ohne gültige Signatur leitet sie nicht weiter –
// sonst ließe sich die Adresse als offene Weiterleitung missbrauchen.

import { base64url, hmac, safeEqual } from './crypto.ts';
import { decodeEntities } from './mime.ts';

export interface TrackOptions {
  emailId: string;
  base: string; // …/functions/v1/email-track
  key: string;
  opens: boolean;
  clicks: boolean;
}

export const PIXEL_GIF = Uint8Array.from(atob('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'), (c) => c.charCodeAt(0));

async function sign(key: string, data: string): Promise<string> {
  return base64url(await hmac('SHA-256', key, data)).slice(0, 22);
}

export async function openUrl(o: Pick<TrackOptions, 'base' | 'key' | 'emailId'>): Promise<string> {
  return `${o.base}/o/${o.emailId}.${await sign(o.key, `o:${o.emailId}`)}.gif`;
}

export async function clickUrl(o: Pick<TrackOptions, 'base' | 'key' | 'emailId'>, target: string): Promise<string> {
  const s = await sign(o.key, `c:${o.emailId}:${target}`);
  return `${o.base}/c/${o.emailId}.${s}?u=${encodeURIComponent(target)}`;
}

const escAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Links in Text klickbar machen (für Mails, die nur als Text geschrieben wurden) */
export function linkify(html: string): string {
  // nur außerhalb von Tags und bestehenden Links
  return html.replace(/(<a\b[\s\S]*?<\/a>)|(<[^>]+>)|(https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]])/gi, (m, a, tag, url) => {
    if (a || tag) return m;
    return `<a href="${escAttr(decodeEntities(url))}">${url}</a>`;
  });
}

/** Zählpixel anhängen und Links über die Zählfunktion leiten */
export async function addTracking(html: string, o: TrackOptions): Promise<string> {
  let out = html;
  if (o.clicks) {
    const re = /(<a\b[^>]*?\bhref\s*=\s*)(["'])(.*?)\2/gi;
    const parts: string[] = [];
    let last = 0;
    for (const m of out.matchAll(re)) {
      const href = decodeEntities(m[3]).trim();
      if (!/^https?:\/\//i.test(href) || href.startsWith(o.base)) continue;
      parts.push(out.slice(last, m.index), `${m[1]}"${escAttr(await clickUrl(o, href))}"`);
      last = m.index! + m[0].length;
    }
    parts.push(out.slice(last));
    out = parts.join('');
  }
  if (o.opens) {
    const pixel = `<img src="${escAttr(await openUrl(o))}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0;opacity:0">`;
    out = /<\/body>/i.test(out) ? out.replace(/<\/body>/i, `${pixel}</body>`) : out + pixel;
  }
  return out;
}

export type TrackHit = { kind: 'open'; emailId: string } | { kind: 'click'; emailId: string; url: string } | { kind: 'invalid' };

/** Aufruf der Zählfunktion prüfen: Pfad …/o/<id>.<sig>.gif oder …/c/<id>.<sig>?u=<ziel> */
export async function parseHit(url: URL, key: string | null): Promise<TrackHit> {
  const m = /\/(o|c)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.([A-Za-z0-9_-]{22})(?:\.gif)?$/i.exec(url.pathname);
  if (!m || !key) return { kind: 'invalid' };
  const [, kind, emailId, sig] = m;
  if (kind === 'o') {
    return safeEqual(sig, await sign(key, `o:${emailId}`)) ? { kind: 'open', emailId } : { kind: 'invalid' };
  }
  const target = url.searchParams.get('u') ?? '';
  if (!/^https?:\/\//i.test(target)) return { kind: 'invalid' };
  return safeEqual(sig, await sign(key, `c:${emailId}:${target}`)) ? { kind: 'click', emailId, url: target } : { kind: 'invalid' };
}

export interface TrackStore {
  key(): Promise<string | null>;
  /** Ereignis vermerken; Rückgabe null = nicht gezählt (z. B. Virenscanner direkt nach dem Senden) */
  record(emailId: string, kind: 'open' | 'click', url: string | null): Promise<{ first: boolean; lead_id: string; user_id: string | null; subject: string; to: string | null } | null>;
  wantsNotice(userId: string): Promise<boolean>;
  notify(userId: string, leadId: string, emailId: string, title: string, body: string): Promise<void>;
  log(message: string): Promise<void>;
}

/** Antwort der Zählfunktion: Pixel ausliefern bzw. weiterleiten, Ereignis vermerken */
export async function handleTrack(req: Request, store: TrackStore): Promise<Response> {
  const url = new URL(req.url);
  const hit = await parseHit(url, await store.key());
  if (hit.kind === 'invalid') {
    if (/\/o\//.test(url.pathname)) return pixel();
    return new Response('Dieser Link ist ungültig oder abgelaufen.', { status: 400, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
  try {
    const res = await store.record(hit.emailId, hit.kind, hit.kind === 'click' ? hit.url : null);
    if (res?.first && res.user_id && (await store.wantsNotice(res.user_id))) {
      const title = hit.kind === 'open' ? 'E-Mail geöffnet' : 'Link in E-Mail geklickt';
      const body = `${res.subject || '(ohne Betreff)'}${res.to ? ` – ${res.to}` : ''}${hit.kind === 'click' ? `: ${hit.url}` : ''}`;
      await store.notify(res.user_id, res.lead_id, hit.emailId, title, body);
    }
  } catch (e) {
    await store.log(`Zählen fehlgeschlagen: ${e instanceof Error ? e.message : e}`);
  }
  return hit.kind === 'open' ? pixel() : new Response(null, { status: 302, headers: { Location: hit.url, 'Cache-Control': 'no-store' } });
}

function pixel(): Response {
  return new Response(PIXEL_GIF, {
    headers: { 'Content-Type': 'image/gif', 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0', Pragma: 'no-cache' },
  });
}
