// Statusmeldungen von Twilio (klingelt, angenommen, aufgelegt, Konferenz, Aufnahme fertig).
// Antwortet sofort; Aufnahmen werden danach im Hintergrund verarbeitet.

import { SupabaseRepo } from '../_shared/db.ts';
import { readForm } from '../_shared/http.ts';
import { telCtx, verifyTwilio } from '../_shared/server.ts';
import { handleStatus } from './logic.ts';

Deno.serve(async (req) => {
  const repo = new SupabaseRepo();
  const url = new URL(req.url);
  const { params } = await readForm(req);
  try {
    if (!(await verifyTwilio(req, repo, 'twilio-status', params))) {
      return new Response('Ungültige Signatur', { status: 403 });
    }
    await handleStatus(telCtx(repo), url.searchParams.get('type') ?? '', url.searchParams, params);
  } catch (e) {
    await repo.log('twilio-status', 'error', `Fehler: ${e instanceof Error ? e.message : e}`, {
      type: url.searchParams.get('type'),
      params,
    });
  }
  return new Response(null, { status: 204 });
});
