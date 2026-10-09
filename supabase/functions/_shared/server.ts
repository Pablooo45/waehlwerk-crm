// Verdrahtung für den echten Betrieb (Supabase + Twilio). Tests bauen sich ihren Kontext selbst.

import { functionRegion, functionUrl, getServiceKey, hookUrl, supabaseUrl, type SupabaseRepo } from './db.ts';
import { background } from './http.ts';
import type { MediaSink } from './recording.ts';
import { twilioFromRepo, type TelCtx, verifyTwilioRequest } from './telephony.ts';
import { createResumableUpload } from './tus.ts';

// Speicher für Aufnahmen: normal hochladen, sehr große Dateien stückweise (TUS)
export function storageSink(repo: SupabaseRepo): MediaSink {
  return {
    upload: (bucket, path, bytes, contentType) => repo.upload(bucket, path, bytes, contentType),
    resumable: (bucket, path, size, contentType) =>
      createResumableUpload({ supabaseUrl: supabaseUrl(), key: getServiceKey(), bucket, path, size, contentType }),
  };
}

export function telCtx(repo: SupabaseRepo): TelCtx {
  return { repo, fn: hookUrl, twilio: () => twilioFromRepo(repo), bg: background, media: storageSink(repo) };
}

export function verifyTwilio(req: Request, repo: SupabaseRepo, fnName: string, params: Record<string, string>): Promise<boolean> {
  return verifyTwilioRequest(req, repo, (name) => functionUrl(name), fnName, params, functionRegion());
}
