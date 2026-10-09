// Postfach abrufen über IMAP mit SSL/TLS (Port 993). Nur das Nötige: anmelden, Ordner, neue Mails, ablegen.

import { bytesToBinary, LineConn } from './netio.ts';

export interface ImapConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  caCerts?: string[];
}

export class ImapError extends Error {}

// Eine Server-Antwort: Textteile und Literale ({n}-Blöcke) in Reihenfolge
export interface Untagged {
  text: string; // Zeile(n) ohne Literale, Literale als \u0000<index>
  literals: Uint8Array[];
}

function quote(s: string): string {
  return `"${s.replace(/(["\\])/g, '\\$1')}"`;
}

export class ImapClient {
  private seq = 0;
  capabilities = new Set<string>();

  private constructor(private c: LineConn) {}

  static async connect(cfg: ImapConfig): Promise<ImapClient> {
    const c = await LineConn.tls(cfg.host, cfg.port, { caCerts: cfg.caCerts });
    const client = new ImapClient(c);
    const greeting = await c.readLine();
    if (!/^\* (OK|PREAUTH)/i.test(greeting)) {
      c.close();
      throw new ImapError(`Posteingang antwortet unerwartet: ${greeting.slice(0, 120)}`);
    }
    return client;
  }

  // Antwort lesen bis zur Zeile mit unserem Kennzeichen; Literale werden mitgelesen
  private async collect(tag: string): Promise<{ status: string; text: string; untagged: Untagged[] }> {
    const untagged: Untagged[] = [];
    for (;;) {
      let line = await this.c.readLine();
      if (line.startsWith(`${tag} `)) {
        const rest = line.slice(tag.length + 1);
        const status = rest.split(' ')[0].toUpperCase();
        return { status, text: rest.slice(status.length + 1), untagged };
      }
      const entry: Untagged = { text: '', literals: [] };
      for (;;) {
        const m = line.match(/\{(\d+)\}$/);
        if (!m) {
          entry.text += line;
          break;
        }
        entry.text += line.slice(0, -m[0].length) + `\u0000${entry.literals.length}`;
        entry.literals.push(await this.c.readBytes(Number(m[1])));
        line = await this.c.readLine();
      }
      if (entry.text.startsWith('* ') || entry.text.startsWith('+')) untagged.push(entry);
    }
  }

  async command(cmd: string): Promise<Untagged[]> {
    const tag = `A${++this.seq}`;
    await this.c.write(`${tag} ${cmd}\r\n`);
    const r = await this.collect(tag);
    if (r.status !== 'OK') {
      throw new ImapError(`${cmd.split(' ')[0]} abgelehnt: ${r.text.slice(0, 200)}`);
    }
    return r.untagged;
  }

  async login(user: string, pass: string): Promise<void> {
    const tag = `A${++this.seq}`;
    // Nicht-ASCII-Passwörter als Literal senden
    if (/^[\x20-\x7e]*$/.test(pass) && /^[\x20-\x7e]*$/.test(user)) {
      await this.c.write(`${tag} LOGIN ${quote(user)} ${quote(pass)}\r\n`);
    } else {
      const u = new TextEncoder().encode(user);
      const p = new TextEncoder().encode(pass);
      await this.c.write(`${tag} LOGIN {${u.length}}\r\n`);
      await this.waitContinue();
      await this.c.write(u);
      await this.c.write(` {${p.length}}\r\n`);
      await this.waitContinue();
      await this.c.write(p);
      await this.c.write('\r\n');
    }
    const r = await this.collect(tag);
    if (r.status !== 'OK') throw new ImapError('Anmeldung am Posteingang fehlgeschlagen – Benutzername oder Passwort falsch.');
    const cap = r.text.match(/\[CAPABILITY ([^\]]+)\]/i);
    if (cap) cap[1].split(' ').forEach((x) => this.capabilities.add(x.toUpperCase()));
  }

  private async waitContinue() {
    const line = await this.c.readLine();
    if (!line.startsWith('+')) throw new ImapError(`Server erwartet keine Daten: ${line.slice(0, 120)}`);
  }

  // Ordner mit Kennzeichen (\Sent, \Drafts …)
  async list(): Promise<{ name: string; flags: string[] }[]> {
    const rows = await this.command('LIST "" "*"');
    return rows
      .filter((r) => /^\* LIST /i.test(r.text))
      .map((r) => {
        const m = r.text.match(/^\* LIST \(([^)]*)\) (?:"[^"]*"|NIL) (.*)$/i);
        if (!m) return null;
        let name = m[2].trim();
        if (name.startsWith('\u0000')) name = bytesToBinary(r.literals[Number(name.slice(1))]);
        else if (name.startsWith('"')) name = name.slice(1, -1).replace(/\\(["\\])/g, '$1');
        return { name, flags: m[1].split(/\s+/).filter(Boolean) };
      })
      .filter((x): x is { name: string; flags: string[] } => !!x);
  }

  async select(folder: string): Promise<{ exists: number; uidValidity: number | null; uidNext: number | null }> {
    const rows = await this.command(`SELECT ${quote(folder)}`);
    let exists = 0;
    let uidValidity: number | null = null;
    let uidNext: number | null = null;
    for (const r of rows) {
      const e = r.text.match(/^\* (\d+) EXISTS/i);
      if (e) exists = Number(e[1]);
      const v = r.text.match(/UIDVALIDITY (\d+)/i);
      if (v) uidValidity = Number(v[1]);
      const n = r.text.match(/UIDNEXT (\d+)/i);
      if (n) uidNext = Number(n[1]);
    }
    return { exists, uidValidity, uidNext };
  }

  async uidSearch(criteria: string): Promise<number[]> {
    const rows = await this.command(`UID SEARCH ${criteria}`);
    const out: number[] = [];
    for (const r of rows) {
      const m = r.text.match(/^\* SEARCH ?(.*)$/i);
      if (m) m[1].split(/\s+/).filter(Boolean).forEach((x) => out.push(Number(x)));
    }
    return out.filter(Number.isFinite).sort((a, b) => a - b);
  }

  // Nachrichten (gekürzt auf maxBytes) – Anhänge darüber werden nicht geladen
  async fetchMessages(uids: number[], maxBytes = 512 * 1024): Promise<{ uid: number; size: number; raw: string }[]> {
    if (!uids.length) return [];
    const rows = await this.command(`UID FETCH ${uids.join(',')} (UID RFC822.SIZE BODY.PEEK[]<0.${maxBytes}>)`);
    const out: { uid: number; size: number; raw: string }[] = [];
    for (const r of rows) {
      if (!/^\* \d+ FETCH/i.test(r.text)) continue;
      const uid = Number(r.text.match(/UID (\d+)/i)?.[1]);
      const size = Number(r.text.match(/RFC822\.SIZE (\d+)/i)?.[1] ?? 0);
      const lit = r.text.match(/BODY\[\](?:<\d+>)? \u0000(\d+)/i);
      if (!uid || !lit) continue;
      out.push({ uid, size, raw: bytesToBinary(r.literals[Number(lit[1])]) });
    }
    return out;
  }

  async append(folder: string, message: string, flags = '(\\Seen)'): Promise<void> {
    const bytes = new TextEncoder().encode(message);
    const tag = `A${++this.seq}`;
    await this.c.write(`${tag} APPEND ${quote(folder)} ${flags} {${bytes.length}}\r\n`);
    await this.waitContinue();
    await this.c.write(bytes);
    await this.c.write('\r\n');
    const r = await this.collect(tag);
    if (r.status !== 'OK') throw new ImapError(`Ablegen in „${folder}“ fehlgeschlagen: ${r.text.slice(0, 160)}`);
  }

  async logout() {
    try {
      await this.command('LOGOUT');
    } catch {
      /* egal */
    } finally {
      this.c.close();
    }
  }

  close() {
    this.c.close();
  }
}

// „Gesendet“-Ordner finden: Kennzeichen \Sent, sonst übliche Namen
export function findSentFolder(folders: { name: string; flags: string[] }[]): string | null {
  const flagged = folders.find((f) => f.flags.some((x) => x.toLowerCase() === '\\sent'));
  if (flagged) return flagged.name;
  const names = ['Sent', 'Gesendet', 'Gesendete Objekte', 'Gesendete Elemente', 'INBOX.Sent', 'INBOX/Sent', 'Sent Items', 'Sent Messages'];
  for (const n of names) {
    const hit = folders.find((f) => f.name.toLowerCase() === n.toLowerCase());
    if (hit) return hit.name;
  }
  return null;
}
