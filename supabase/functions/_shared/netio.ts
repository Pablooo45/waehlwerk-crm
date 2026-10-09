// Zeilenweises Lesen über eine (TLS-)Verbindung – für SMTP und IMAP.

export class LineConn {
  private buf = new Uint8Array(0);
  private pos = 0;
  private closed = false;

  constructor(readonly conn: Deno.Conn, private readonly timeoutMs = 25_000) {}

  static async tls(hostname: string, port: number, opts: { caCerts?: string[]; timeoutMs?: number } = {}): Promise<LineConn> {
    if (port === 25 || port === 587) {
      throw new Error(`Port ${port} ist auf dem Server gesperrt. Bitte den SSL/TLS-Port nutzen (SMTP 465, IMAP 993).`);
    }
    const conn = await withTimeout(
      Deno.connectTls({ hostname, port, caCerts: opts.caCerts }),
      opts.timeoutMs ?? 15_000,
      `${hostname}:${port} antwortet nicht`,
    );
    return new LineConn(conn, opts.timeoutMs ?? 25_000);
  }

  private async readChunk(): Promise<Uint8Array | null> {
    if (this.closed) return null;
    const chunk = new Uint8Array(64 * 1024);
    const n = await withTimeout(this.conn.read(chunk), this.timeoutMs, 'Zeitüberschreitung beim Lesen');
    if (n === null) {
      this.closed = true;
      return null;
    }
    return chunk.subarray(0, n);
  }

  private async fill(): Promise<boolean> {
    const chunk = await this.readChunk();
    if (!chunk) return false;
    const rest = this.buf.subarray(this.pos);
    const merged = new Uint8Array(rest.length + chunk.length);
    merged.set(rest);
    merged.set(chunk, rest.length);
    this.buf = merged;
    this.pos = 0;
    return true;
  }

  // eine Zeile ohne CRLF, als „binary string“ (1 Zeichen = 1 Byte)
  async readLine(): Promise<string> {
    for (;;) {
      const i = this.buf.indexOf(10, this.pos);
      if (i >= 0) {
        const end = i > this.pos && this.buf[i - 1] === 13 ? i - 1 : i;
        const s = bytesToBinary(this.buf.subarray(this.pos, end));
        this.pos = i + 1;
        return s;
      }
      if (!(await this.fill())) throw new Error('Verbindung vom Server getrennt.');
    }
  }

  // genau n Bytes (z. B. IMAP-Literal); große Blöcke ohne wiederholtes Umkopieren
  async readBytes(n: number): Promise<Uint8Array> {
    const parts: Uint8Array[] = [];
    let have = 0;
    const take = Math.min(n, this.buf.length - this.pos);
    if (take > 0) {
      parts.push(this.buf.subarray(this.pos, this.pos + take));
      this.pos += take;
      have = take;
    }
    while (have < n) {
      const chunk = await this.readChunk();
      if (!chunk) throw new Error('Verbindung vom Server getrennt.');
      const need = n - have;
      if (chunk.length > need) {
        parts.push(chunk.subarray(0, need));
        // Rest zurück in den Puffer
        const rest = this.buf.subarray(this.pos);
        const merged = new Uint8Array(rest.length + chunk.length - need);
        merged.set(rest);
        merged.set(chunk.subarray(need), rest.length);
        this.buf = merged;
        this.pos = 0;
        have = n;
      } else {
        parts.push(chunk);
        have += chunk.length;
      }
    }
    const out = new Uint8Array(n);
    let o = 0;
    for (const p of parts) {
      out.set(p, o);
      o += p.length;
    }
    return out;
  }

  async write(data: string | Uint8Array): Promise<void> {
    let bytes = typeof data === 'string' ? binaryToBytes(data) : data;
    while (bytes.length) {
      const n = await withTimeout(this.conn.write(bytes), this.timeoutMs, 'Zeitüberschreitung beim Senden');
      bytes = bytes.subarray(n);
    }
  }

  close() {
    try {
      this.conn.close();
    } catch {
      /* schon zu */
    }
    this.closed = true;
  }
}

export function bytesToBinary(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return s;
}

// Zeichen > 255 werden als UTF-8 geschrieben (Befehle sind ASCII, Inhalte vorher kodiert)
export function binaryToBytes(s: string): Uint8Array {
  if (/^[\x00-\xff]*$/.test(s)) {
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }
  return new TextEncoder().encode(s);
}

export function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    p,
    new Promise<T>((_, reject) => {
      t = setTimeout(() => reject(new Error(message)), ms);
    }),
  ]).finally(() => clearTimeout(t));
}
