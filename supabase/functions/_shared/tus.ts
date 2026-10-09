// Große Dateien in den Supabase-Speicher hochladen, ohne sie ganz im Speicher zu halten
// (TUS-Protokoll, „Resumable Uploads“). Supabase verlangt Stücke von genau 6 MB.
// https://supabase.com/docs/guides/storage/uploads/resumable-uploads

export const TUS_CHUNK = 6 * 1024 * 1024;

export interface ResumableUpload {
  write(chunk: Uint8Array): Promise<void>;
  finish(): Promise<void>;
  abort(): Promise<void>;
}

function b64(s: string): string {
  return btoa(String.fromCharCode(...new TextEncoder().encode(s)));
}

// https://<ref>.supabase.co → https://<ref>.storage.supabase.co (direkter Speicher-Host, empfohlen für große Dateien)
export function tusEndpoint(supabaseUrl: string): string {
  const u = new URL(supabaseUrl);
  const m = u.hostname.match(/^([a-z0-9]+)\.supabase\.co$/);
  if (m) return `https://${m[1]}.storage.supabase.co/storage/v1/upload/resumable`;
  return `${supabaseUrl.replace(/\/$/, '')}/storage/v1/upload/resumable`;
}

export class TusError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function createResumableUpload(o: {
  supabaseUrl: string;
  key: string;
  bucket: string;
  path: string;
  size: number;
  contentType: string;
  fetchFn?: typeof fetch;
}): Promise<ResumableUpload> {
  const f = o.fetchFn ?? fetch;
  const auth = { Authorization: `Bearer ${o.key}`, apikey: o.key };
  const res = await f(tusEndpoint(o.supabaseUrl), {
    method: 'POST',
    headers: {
      ...auth,
      'Tus-Resumable': '1.0.0',
      'Upload-Length': String(o.size),
      'Upload-Metadata': [
        `bucketName ${b64(o.bucket)}`,
        `objectName ${b64(o.path)}`,
        `contentType ${b64(o.contentType)}`,
        `cacheControl ${b64('3600')}`,
      ].join(','),
      'x-upsert': 'true',
    },
  });
  if (res.status !== 201) {
    const text = await res.text().catch(() => '');
    throw new TusError(res.status, `Großer Upload abgelehnt (${res.status}): ${text.slice(0, 200)}`);
  }
  await res.body?.cancel().catch(() => undefined);
  const loc = res.headers.get('Location');
  if (!loc) throw new TusError(500, 'Upload-Adresse fehlt.');
  const uploadUrl = new URL(loc, tusEndpoint(o.supabaseUrl)).toString();

  let offset = 0;
  let pending: Uint8Array[] = [];
  let pendingBytes = 0;

  const currentOffset = async (): Promise<number> => {
    const head = await f(uploadUrl, { method: 'HEAD', headers: { ...auth, 'Tus-Resumable': '1.0.0' } });
    const v = Number(head.headers.get('Upload-Offset'));
    if (!Number.isFinite(v)) throw new TusError(head.status, 'Upload-Stand unbekannt.');
    return v;
  };

  const send = async (bytes: Uint8Array) => {
    let data = bytes;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const r = await f(uploadUrl, {
          method: 'PATCH',
          headers: {
            ...auth,
            'Tus-Resumable': '1.0.0',
            'Upload-Offset': String(offset),
            'Content-Type': 'application/offset+octet-stream',
          },
          body: data as BodyInit,
        });
        await r.body?.cancel().catch(() => undefined);
        if (r.status === 204) {
          offset = Number(r.headers.get('Upload-Offset')) || offset + data.length;
          return;
        }
        if (r.status !== 409 && r.status < 500) throw new TusError(r.status, `Upload fehlgeschlagen (${r.status}).`);
      } catch (e) {
        if (e instanceof TusError && e.status < 500 && e.status !== 409) throw e;
        if (attempt === 3) throw e;
      }
      // Stand beim Server abfragen und ab dort weitermachen
      await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
      const server = await currentOffset();
      const done = server - offset;
      if (done >= data.length) {
        offset = server;
        return;
      }
      if (done > 0) {
        data = data.subarray(done);
        offset = server;
      }
    }
  };

  const flush = async (all: boolean) => {
    while (pendingBytes >= TUS_CHUNK || (all && pendingBytes > 0)) {
      const take = all ? Math.min(pendingBytes, TUS_CHUNK) : TUS_CHUNK;
      const chunk = new Uint8Array(take);
      let filled = 0;
      while (filled < take) {
        const head = pending[0];
        const need = take - filled;
        if (head.length <= need) {
          chunk.set(head, filled);
          filled += head.length;
          pending.shift();
        } else {
          chunk.set(head.subarray(0, need), filled);
          pending[0] = head.subarray(need);
          filled += need;
        }
      }
      pendingBytes -= take;
      await send(chunk);
    }
  };

  return {
    async write(chunk: Uint8Array) {
      if (!chunk.length) return;
      pending.push(chunk);
      pendingBytes += chunk.length;
      if (pendingBytes >= TUS_CHUNK) await flush(false);
    },
    async finish() {
      await flush(true);
      if (offset !== o.size) throw new TusError(500, `Upload unvollständig (${offset} von ${o.size} Bytes).`);
    },
    async abort() {
      pending = [];
      pendingBytes = 0;
      await f(uploadUrl, { method: 'DELETE', headers: { ...auth, 'Tus-Resumable': '1.0.0' } })
        .then((r) => r.body?.cancel())
        .catch(() => undefined);
    },
  };
}
