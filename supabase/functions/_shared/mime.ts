// E-Mails zusammenbauen (Versand über SMTP) und zerlegen (Abruf über IMAP).
// Ohne Bibliotheken; deckt ab, was echte Postfächer (IONOS, Google, Microsoft) liefern.

const enc = new TextEncoder();

function b64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function wrap76(s: string): string {
  const out: string[] = [];
  for (let i = 0; i < s.length; i += 76) out.push(s.slice(i, i + 76));
  return out.join('\r\n');
}

const ASCII_SAFE = /^[\x20-\x7e]*$/;

// Kopfzeile mit Umlauten: =?UTF-8?B?…?= in Stücken, ohne Zeichen zu zerteilen
export function encodeHeader(value: string): string {
  if (ASCII_SAFE.test(value)) return value;
  const words: string[] = [];
  let chunk = '';
  let bytes = 0;
  for (const ch of value) {
    const n = enc.encode(ch).length;
    if (bytes + n > 45 && chunk) {
      words.push(`=?UTF-8?B?${b64(enc.encode(chunk))}?=`);
      chunk = '';
      bytes = 0;
    }
    chunk += ch;
    bytes += n;
  }
  if (chunk) words.push(`=?UTF-8?B?${b64(enc.encode(chunk))}?=`);
  return words.join('\r\n ');
}

export interface MailAddress {
  email: string;
  name?: string | null;
}

export function formatAddress(a: MailAddress): string {
  if (!a.name) return `<${a.email}>`;
  const name = ASCII_SAFE.test(a.name) ? `"${a.name.replace(/(["\\])/g, '\\$1')}"` : encodeHeader(a.name);
  return `${name} <${a.email}>`;
}

export function rfc2822Date(d: Date): string {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const p = (n: number) => String(n).padStart(2, '0');
  return `${days[d.getUTCDay()]}, ${p(d.getUTCDate())} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} +0000`;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', auml: 'ä', ouml: 'ö', uuml: 'ü', Auml: 'Ä', Ouml: 'Ö', Uuml: 'Ü', szlig: 'ß', euro: '€', ndash: '–', mdash: '—', bdquo: '„', ldquo: '“', rdquo: '”' };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e] ?? m;
  });
}

// Lesbarer Text aus HTML (für die Textfassung der Mail und die Vorschau im CRM)
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(style|script|head)[^>]*>[\s\S]*?<\/\1>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|h[1-6]|li|tr|blockquote)>/gi, '\n')
      .replace(/<li[^>]*>/gi, '• ')
      .replace(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href: string, text: string) => (text.includes(href) ? text : `${text} (${href})`))
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function textToHtml(text: string): string {
  const esc = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return esc.split(/\n{2,}/).map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('');
}

export interface OutgoingMail {
  from: MailAddress;
  to: MailAddress[];
  cc?: MailAddress[];
  bcc?: MailAddress[];
  replyTo?: MailAddress | null;
  subject: string;
  html: string | null;
  text: string;
  attachments?: { name: string; contentType: string; data: Uint8Array }[];
  messageId: string; // ohne <>
  inReplyTo?: string | null;
  references?: string | null;
  date?: Date;
}

function boundary(): string {
  return `=_wwk_${crypto.randomUUID().replace(/-/g, '')}`;
}

function part(contentType: string, data: Uint8Array, extra: string[] = []): string {
  return [`Content-Type: ${contentType}`, 'Content-Transfer-Encoding: base64', ...extra, '', wrap76(b64(data))].join('\r\n');
}

function multipart(type: string, parts: string[]): { header: string; body: string } {
  const b = boundary();
  return {
    header: `multipart/${type}; boundary="${b}"`,
    body: parts.map((p) => `--${b}\r\n${p}`).join('\r\n') + `\r\n--${b}--`,
  };
}

// Fertige Nachricht (CRLF, 7-Bit sicher) – Bcc steht nicht im Kopf, nur in den Empfängern beim Versand
export function buildMime(m: OutgoingMail): string {
  const headers = [
    `From: ${formatAddress(m.from)}`,
    `To: ${m.to.map(formatAddress).join(', ')}`,
    ...(m.cc?.length ? [`Cc: ${m.cc.map(formatAddress).join(', ')}`] : []),
    ...(m.replyTo ? [`Reply-To: ${formatAddress(m.replyTo)}`] : []),
    `Subject: ${encodeHeader(m.subject)}`,
    `Date: ${rfc2822Date(m.date ?? new Date())}`,
    `Message-ID: <${m.messageId}>`,
    ...(m.inReplyTo ? [`In-Reply-To: <${m.inReplyTo}>`] : []),
    ...(m.references ? [`References: ${m.references}`] : m.inReplyTo ? [`References: <${m.inReplyTo}>`] : []),
    'MIME-Version: 1.0',
  ];
  // Jeder Teil ist „Kopf + Leerzeile + Inhalt“; der äußerste Teil hängt direkt an den Kopfzeilen
  const textPart = part('text/plain; charset=UTF-8', enc.encode(m.text));
  let content = textPart;
  if (m.html) {
    const alt = multipart('alternative', [textPart, part('text/html; charset=UTF-8', enc.encode(m.html))]);
    content = `Content-Type: ${alt.header}\r\n\r\n${alt.body}`;
  }
  if (m.attachments?.length) {
    const files = m.attachments.map((a) =>
      part(`${a.contentType}; name="${encodeHeader(a.name)}"`, a.data, [`Content-Disposition: attachment; filename="${encodeHeader(a.name)}"`])
    );
    const mixed = multipart('mixed', [content, ...files]);
    content = `Content-Type: ${mixed.header}\r\n\r\n${mixed.body}`;
  }
  return [...headers, content, ''].join('\r\n');
}

// ---------------------------------------------------------------------------
// Zerlegen (eingehende Mails)
// ---------------------------------------------------------------------------
export interface ParsedMail {
  messageId: string | null;
  inReplyTo: string | null;
  references: string[];
  from: MailAddress | null;
  to: MailAddress[];
  cc: MailAddress[];
  subject: string;
  date: Date | null;
  text: string;
  html: string | null;
  attachments: { name: string; contentType: string; size: number }[];
  autoReply: boolean;
}

function decodeBytes(bytes: Uint8Array, charset: string | null): string {
  const cs = (charset || 'utf-8').toLowerCase().replace(/^"|"$/g, '');
  try {
    return new TextDecoder(cs === 'us-ascii' ? 'utf-8' : cs).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

function latin1Bytes(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

function qpDecode(s: string, header = false): Uint8Array {
  const src = header ? s.replace(/_/g, ' ') : s.replace(/=\r?\n/g, '');
  const out: number[] = [];
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '=' && /^[0-9a-f]{2}$/i.test(src.slice(i + 1, i + 3))) {
      out.push(parseInt(src.slice(i + 1, i + 3), 16));
      i += 2;
    } else out.push(src.charCodeAt(i) & 0xff);
  }
  return new Uint8Array(out);
}

function b64Decode(s: string): Uint8Array {
  const clean = s.replace(/[^A-Za-z0-9+/=]/g, '');
  try {
    return latin1Bytes(atob(clean));
  } catch {
    return latin1Bytes(atob(clean.replace(/=+$/, '')));
  }
}

// =?utf-8?B?…?= und =?iso-8859-1?Q?…?= in Kopfzeilen
export function decodeWords(s: string): string {
  return s
    .replace(/(=\?[^?]+\?[bq]\?[^?]*\?=)\s+(?==\?)/gi, '$1')
    .replace(/=\?([^?]+)\?([bq])\?([^?]*)\?=/gi, (_, cs: string, kind: string, data: string) => {
      const bytes = kind.toLowerCase() === 'b' ? b64Decode(data) : qpDecode(data, true);
      return decodeBytes(bytes, cs.split('*')[0]);
    });
}

function splitHeaderBody(raw: string): [string, string] {
  const m = raw.match(/\r?\n\r?\n/);
  if (!m || m.index === undefined) return [raw, ''];
  return [raw.slice(0, m.index), raw.slice(m.index + m[0].length)];
}

export function parseHeaders(block: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const lines = block.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/);
  for (const line of lines) {
    const i = line.indexOf(':');
    if (i <= 0) continue;
    const key = line.slice(0, i).trim().toLowerCase();
    const list = out.get(key) ?? [];
    list.push(line.slice(i + 1).trim());
    out.set(key, list);
  }
  return out;
}

function param(value: string, name: string): string | null {
  // RFC 2231 (filename*=UTF-8''…) und einfache Parameter
  const star = value.match(new RegExp(`${name}\\*=(?:"?)([^;"]+)`, 'i'));
  if (star) {
    const m = star[1].match(/^([^']*)'[^']*'(.*)$/);
    if (m) {
      try {
        return decodeBytes(latin1Bytes(unescape(m[2])), m[1] || 'utf-8');
      } catch {
        return m[2];
      }
    }
  }
  const m = value.match(new RegExp(`${name}=("([^"]*)"|[^;\\s]+)`, 'i'));
  if (!m) return null;
  return decodeWords(m[2] ?? m[1]);
}

export function parseAddressList(value: string | undefined): MailAddress[] {
  if (!value) return [];
  const out: MailAddress[] = [];
  let cur = '';
  let quoted = false;
  let angle = 0;
  const flush = () => {
    const s = cur.trim();
    cur = '';
    if (!s) return;
    const m = s.match(/^(.*?)<([^>]+)>\s*$/);
    if (m) {
      const name = decodeWords(m[1].trim().replace(/^"|"$/g, '').replace(/\\(["\\])/g, '$1')).trim();
      out.push({ email: m[2].trim().toLowerCase(), name: name || null });
    } else if (s.includes('@')) {
      out.push({ email: s.replace(/^.*:/, '').replace(/;$/, '').trim().toLowerCase(), name: null });
    }
  };
  for (const ch of value) {
    if (ch === '"') quoted = !quoted;
    if (!quoted && ch === '<') angle++;
    if (!quoted && ch === '>') angle = Math.max(0, angle - 1);
    if (!quoted && angle === 0 && (ch === ',' || ch === ';')) {
      flush();
      continue;
    }
    cur += ch;
  }
  flush();
  return out.filter((a) => /^[^@\s]+@[^@\s]+$/.test(a.email));
}

function stripId(v: string | undefined): string | null {
  if (!v) return null;
  const m = v.match(/<([^>]+)>/);
  return (m ? m[1] : v).trim() || null;
}

interface Collected {
  text: string | null;
  html: string | null;
  attachments: ParsedMail['attachments'];
}

function walk(raw: string, acc: Collected, depth = 0) {
  if (depth > 8) return;
  const [head, body] = splitHeaderBody(raw);
  const h = parseHeaders(head);
  const ctype = h.get('content-type')?.[0] ?? 'text/plain; charset=us-ascii';
  const type = ctype.split(';')[0].trim().toLowerCase();
  const disp = h.get('content-disposition')?.[0] ?? '';
  const cte = (h.get('content-transfer-encoding')?.[0] ?? '7bit').toLowerCase();
  if (type.startsWith('multipart/')) {
    const b = param(ctype, 'boundary');
    if (!b) return;
    const parts = body.split(new RegExp(`\\r?\\n?--${b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:--)?[ \\t]*\\r?\\n?`));
    for (const p of parts.slice(1)) if (p.trim()) walk(p, acc, depth + 1);
    return;
  }
  if (type === 'message/rfc822') return walk(body, acc, depth + 1);
  const filename = param(disp, 'filename') ?? param(ctype, 'name');
  const bytes = cte === 'base64' ? b64Decode(body) : cte === 'quoted-printable' ? qpDecode(body) : latin1Bytes(body);
  if (/^attachment/i.test(disp) || (filename && !type.startsWith('text/'))) {
    acc.attachments.push({ name: filename ?? 'Anhang', contentType: type, size: bytes.length });
    return;
  }
  if (type === 'text/plain' && acc.text === null) acc.text = decodeBytes(bytes, param(ctype, 'charset'));
  else if (type === 'text/html' && acc.html === null) acc.html = decodeBytes(bytes, param(ctype, 'charset'));
}

// raw: Nachricht als „binary string“ (jedes Zeichen = ein Byte), wie sie vom IMAP-Server kommt
export function parseMime(raw: string | Uint8Array): ParsedMail {
  const s = typeof raw === 'string' ? raw : decodeBytes(raw, 'latin1');
  const [head] = splitHeaderBody(s);
  const h = parseHeaders(head);
  const acc: Collected = { text: null, html: null, attachments: [] };
  walk(s, acc);
  const get = (k: string) => h.get(k)?.[0];
  const dateRaw = get('date');
  const date = dateRaw ? new Date(dateRaw.replace(/\s*\([^)]*\)\s*$/, '')) : null;
  const auto = (get('auto-submitted') ?? 'no').toLowerCase() !== 'no' || /^(auto|bulk|list|junk)/i.test(get('precedence') ?? '') ||
    !!get('x-autoreply') || !!get('x-autorespond');
  return {
    messageId: stripId(get('message-id')),
    inReplyTo: stripId(get('in-reply-to')),
    references: (get('references') ?? '').match(/<[^>]+>/g)?.map((x) => x.slice(1, -1)) ?? [],
    from: parseAddressList(decodeWords(get('from') ?? ''))[0] ?? null,
    to: parseAddressList(get('to')),
    cc: parseAddressList(get('cc')),
    subject: decodeWords(get('subject') ?? '').trim(),
    date: date && !isNaN(date.getTime()) ? date : null,
    text: (acc.text ?? (acc.html ? htmlToText(acc.html) : '')).trim(),
    html: acc.html,
    attachments: acc.attachments,
    autoReply: auto,
  };
}

// Zitierte Vorgeschichte und Signatur-Trenner abschneiden (für die Vorschau im Verlauf)
export function stripQuoted(text: string): string {
  const lines = text.split(/\r?\n/);
  const cut = lines.findIndex((l) =>
    /^>/.test(l) || /^-{2,}\s*(Original|Ursprüngliche)/i.test(l) || /^(Am|On) .{4,120}(schrieb|wrote).{0,40}:$/.test(l.trim()) ||
    /^Von:\s.+/.test(l) && lines.slice(lines.indexOf(l), lines.indexOf(l) + 4).some((x) => /^(Gesendet|Betreff|An):/.test(x))
  );
  return (cut > 0 ? lines.slice(0, cut) : lines).join('\n').trim();
}
