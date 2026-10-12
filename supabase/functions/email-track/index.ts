// Zählt E-Mail-Öffnungen (Zählpixel) und Link-Klicks (Weiterleitung) – öffentlich erreichbar,
// abgesichert über signierte Links (siehe _shared/tracking.ts).

import { SupabaseRepo } from '../_shared/db.ts';
import { handleTrack, type TrackStore } from '../_shared/tracking.ts';

function storeOf(repo: SupabaseRepo): TrackStore {
  return {
    key: () => repo.secret('TRACKING_KEY'),
    async record(emailId, kind, url) {
      const res = await repo.db.rpc('email_track_event', { p_email: emailId, p_kind: kind, p_url: url });
      if (res.error) throw new Error(res.error.message);
      return res.data as Awaited<ReturnType<TrackStore['record']>>;
    },
    async wantsNotice(userId) {
      const res = await repo.db.from('profiles').select('settings').eq('id', userId).maybeSingle();
      const settings = (res.data?.settings ?? {}) as { notifyEmailOpens?: boolean };
      return settings.notifyEmailOpens === true;
    },
    notify: (userId, leadId, emailId, title, body) => repo.notify(userId, 'email', leadId, 'email', emailId, title, body),
    log: (message) => repo.log('email-track', 'warn', message),
  };
}

Deno.serve((req) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return new Response('Nicht erlaubt', { status: 405 });
  return handleTrack(req, storeOf(new SupabaseRepo()));
});
