// E-Mail versenden über SMTP mit SSL/TLS (Port 465). Port 25/587 sind bei Supabase gesperrt.

import { LineConn } from './netio.ts';

export interface SmtpConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  caCerts?: string[];
  helo?: string;
}

export class SmtpError extends Error {
  constructor(public code: number, message: string) {
    super(message);
  }
}

async function reply(c: LineConn): Promise<{ code: number; lines: string[] }> {
  const lines: string[] = [];
  for (;;) {
    const line = await c.readLine();
    lines.push(line.slice(4));
    const code = Number(line.slice(0, 3));
    if (line[3] !== '-') return { code, lines };
  }
}

async function expect(c: LineConn, ok: number[], what: string) {
  const r = await reply(c);
  if (!ok.includes(r.code)) {
    const text = r.lines.join(' ').slice(0, 300);
    if (r.code === 535 || r.code === 534) throw new SmtpError(r.code, `Anmeldung am Postausgang fehlgeschlagen – Benutzername oder Passwort falsch. (${text})`);
    if (r.code === 550 || r.code === 553) throw new SmtpError(r.code, `Empfänger oder Absender abgelehnt: ${text}`);
    if (r.code === 552 || r.code === 554) throw new SmtpError(r.code, `Nachricht abgelehnt: ${text}`);
    throw new SmtpError(r.code, `${what}: ${r.code} ${text}`);
  }
  return r;
}

function utf8b64(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin);
}

// Punkte am Zeilenanfang verdoppeln (Ende der Nachricht ist eine Zeile mit nur einem Punkt)
export function dotStuff(data: string): string {
  const crlf = data.replace(/\r?\n/g, '\r\n');
  return crlf.replace(/(^|\r\n)\./g, '$1..');
}

async function open(cfg: SmtpConfig): Promise<LineConn> {
  const c = await LineConn.tls(cfg.host, cfg.port, { caCerts: cfg.caCerts });
  await expect(c, [220], 'Begrüßung');
  await c.write(`EHLO ${cfg.helo ?? 'crm.local'}\r\n`);
  const ehlo = await expect(c, [250], 'EHLO');
  const auth = ehlo.lines.find((l) => /^AUTH\b/i.test(l)) ?? 'AUTH PLAIN LOGIN';
  if (/\bPLAIN\b/i.test(auth)) {
    await c.write(`AUTH PLAIN ${utf8b64(`\u0000${cfg.username}\u0000${cfg.password}`)}\r\n`);
    await expect(c, [235], 'Anmeldung');
  } else {
    await c.write('AUTH LOGIN\r\n');
    await expect(c, [334], 'Anmeldung');
    await c.write(`${utf8b64(cfg.username)}\r\n`);
    await expect(c, [334], 'Anmeldung');
    await c.write(`${utf8b64(cfg.password)}\r\n`);
    await expect(c, [235], 'Anmeldung');
  }
  return c;
}

// Nur anmelden (Zugangsdaten prüfen)
export async function smtpCheck(cfg: SmtpConfig): Promise<void> {
  const c = await open(cfg);
  try {
    await c.write('QUIT\r\n');
  } finally {
    c.close();
  }
}

export async function smtpSend(cfg: SmtpConfig, from: string, recipients: string[], message: string): Promise<string> {
  if (!recipients.length) throw new SmtpError(0, 'Kein Empfänger angegeben.');
  const c = await open(cfg);
  try {
    await c.write(`MAIL FROM:<${from}>\r\n`);
    await expect(c, [250], 'Absender');
    for (const r of recipients) {
      await c.write(`RCPT TO:<${r}>\r\n`);
      await expect(c, [250, 251], `Empfänger ${r}`);
    }
    await c.write('DATA\r\n');
    await expect(c, [354], 'Daten');
    await c.write(`${dotStuff(message).replace(/\r\n$/, '')}\r\n.\r\n`);
    const done = await expect(c, [250], 'Versand');
    await c.write('QUIT\r\n').catch(() => undefined);
    return done.lines.join(' ');
  } finally {
    c.close();
  }
}
