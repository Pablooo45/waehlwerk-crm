// Twilio: REST-Aufrufe, Access Token für das Browser-Telefon, Signaturprüfung, TwiML.
// Bewusst ohne Twilio-Bibliothek – weniger Abhängigkeiten, weniger kann kaputtgehen.

import { base64url, bytesToBase64, hmac, safeEqual } from './crypto.ts';

export class TwilioError extends Error {
  constructor(public status: number, public code: number | null, message: string) {
    super(message);
  }
}

type Params = Record<string, string | number | boolean | string[] | undefined | null>;

function toForm(params: Params): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) v.forEach((x) => sp.append(k, x));
    else sp.append(k, String(v));
  }
  return sp.toString();
}

export class TwilioClient {
  readonly base: string;

  constructor(readonly accountSid: string, private readonly authToken: string) {
    this.base = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}`;
  }

  get authHeader(): string {
    return 'Basic ' + btoa(`${this.accountSid}:${this.authToken}`);
  }

  async request<T = Record<string, unknown>>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    params?: Params,
  ): Promise<T> {
    let url = path.startsWith('https://') ? path : `${this.base}${path}`;
    const init: RequestInit = { method, headers: { Authorization: this.authHeader } };
    if (params && method === 'GET') {
      const qs = toForm(params);
      if (qs) url += (url.includes('?') ? '&' : '?') + qs;
    } else if (params) {
      init.body = toForm(params);
      (init.headers as Record<string, string>)['Content-Type'] = 'application/x-www-form-urlencoded';
    }
    const res = await fetch(url, init);
    if (res.status === 204) return null as T;
    const text = await res.text();
    let data: Record<string, unknown> = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      /* keine JSON-Antwort */
    }
    if (!res.ok) {
      const msg = typeof data.message === 'string' ? data.message : text.slice(0, 300);
      throw new TwilioError(res.status, typeof data.code === 'number' ? data.code : null, `Twilio ${res.status}: ${msg}`);
    }
    return data as T;
  }

  // Aufnahme als Datenstrom laden (WAV = verlustfrei, MP3 = klein). Bei zwei Spuren muss
  // RequestedChannels=2 dabei sein, sonst mischt Twilio beide Spuren zu einer zusammen.
  async fetchMedia(recordingUrl: string, format: 'wav' | 'mp3', channels: number): Promise<Response> {
    const base = recordingUrl.replace(/\.(json|mp3|wav)(\?.*)?$/, '');
    const url = `${base}.${format}${channels >= 2 ? '?RequestedChannels=2' : ''}`;
    let lastError = '';
    for (let attempt = 0; attempt < 5; attempt++) {
      const res = await fetch(url, { headers: { Authorization: this.authHeader } });
      if (res.ok && res.body) return res;
      lastError = `${res.status} ${await res.text().catch(() => '')}`.slice(0, 200);
      // 404 direkt nach „fertig“ kommt vor – kurz warten und erneut versuchen
      if (res.status !== 404 && res.status < 500 && res.status !== 429) break;
      await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)));
    }
    throw new Error(`Aufnahme konnte nicht von Twilio geladen werden: ${lastError}`);
  }
}

// Teilnehmer einer Konferenz ansprechen (per Call-SID oder Label, z. B. "customer")
export function participantPath(conferenceSid: string, sidOrLabel: string): string {
  return `/Conferences/${conferenceSid}/Participants/${encodeURIComponent(sidOrLabel)}.json`;
}

// ---------------------------------------------------------------------------
// Access Token (JWT) für das Browser-Telefon (Voice JavaScript SDK)
// ---------------------------------------------------------------------------
export async function createVoiceAccessToken(o: {
  accountSid: string;
  apiKeySid: string;
  apiKeySecret: string;
  appSid: string;
  identity: string;
  ttlSeconds?: number;
  now?: number;
}): Promise<string> {
  const now = o.now ?? Math.floor(Date.now() / 1000);
  const ttl = Math.min(o.ttlSeconds ?? 3600, 86400);
  const header = { alg: 'HS256', typ: 'JWT', cty: 'twilio-fpa;v=1' };
  const payload = {
    jti: `${o.apiKeySid}-${now}`,
    iss: o.apiKeySid,
    sub: o.accountSid,
    iat: now,
    exp: now + ttl,
    grants: {
      identity: o.identity,
      voice: {
        incoming: { allow: true },
        outgoing: { application_sid: o.appSid },
      },
    },
  };
  const data = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const sig = await hmac('SHA-256', o.apiKeySecret, data);
  return `${data}.${base64url(sig)}`;
}

// ---------------------------------------------------------------------------
// Signatur prüfen: Kommt die Anfrage wirklich von Twilio?
// ---------------------------------------------------------------------------
export async function twilioSignature(authToken: string, url: string, params: Record<string, string>): Promise<string> {
  let data = url;
  for (const key of Object.keys(params).sort()) data += key + params[key];
  return bytesToBase64(await hmac('SHA-1', authToken, data));
}

function urlVariants(url: string): string[] {
  const out = new Set<string>([url]);
  try {
    const u = new URL(url);
    if (!u.port) {
      const withPort = `${u.protocol}//${u.host}:${u.protocol === 'https:' ? 443 : 80}${u.pathname}${u.search}`;
      out.add(withPort);
    } else {
      u.port = '';
      out.add(u.toString());
    }
  } catch {
    /* ignorieren */
  }
  return [...out];
}

export async function validateTwilioSignature(
  authToken: string,
  signature: string | null,
  candidateUrls: string[],
  params: Record<string, string>,
): Promise<boolean> {
  if (!signature || !authToken) return false;
  for (const candidate of candidateUrls) {
    for (const url of urlVariants(candidate)) {
      const expected = await twilioSignature(authToken, url, params);
      if (safeEqual(expected, signature)) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// TwiML (XML-Antworten an Twilio)
// ---------------------------------------------------------------------------
export type XmlNode = { name: string; attrs: Record<string, unknown>; children: (XmlNode | string)[] };

// Leere Attribute werden sonst weggelassen; manche brauchen ausdrücklich "" (z. B. waitUrl="" = Stille)
export const EMPTY_ATTR = Symbol('empty');

export function el(name: string, attrs: Record<string, unknown> = {}, ...children: (XmlNode | string)[]): XmlNode {
  return { name, attrs, children };
}

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function renderNode(n: XmlNode | string): string {
  if (typeof n === 'string') return escapeXml(n);
  const attrs = Object.entries(n.attrs)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => (v === EMPTY_ATTR ? ` ${k}=""` : ` ${k}="${escapeXml(String(v))}"`))
    .join('');
  if (n.children.length === 0) return `<${n.name}${attrs}/>`;
  return `<${n.name}${attrs}>${n.children.map(renderNode).join('')}</${n.name}>`;
}

export function twiml(...children: (XmlNode | string)[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>${renderNode(el('Response', {}, ...children))}`;
}

// Deutsche Ansage (Amazon Polly über Twilio)
export function say(text: string): XmlNode {
  return el('Say', { language: 'de-DE', voice: 'Polly.Vicki-Neural' }, text);
}
