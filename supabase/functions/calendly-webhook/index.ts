// Calendly schickt hierher neue und abgesagte Termine (Webhook).

import { SupabaseRepo } from '../_shared/db.ts';
import { verifyCalendlySignature } from '../_shared/calendly.ts';
import { json } from '../_shared/http.ts';
import { type CalendlyEvent, handleCalendly } from './logic.ts';

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ ok: true, hint: 'Calendly-Webhook ist erreichbar.' });
  const repo = new SupabaseRepo();
  const raw = await req.text();
  try {
    const key = await repo.secret('CALENDLY_SIGNING_KEY');
    const ok = key && (await verifyCalendlySignature(req.headers.get('Calendly-Webhook-Signature'), raw, key));
    if (!ok) {
      await repo.log('calendly-webhook', 'warn', 'Signatur ungültig – Anfrage abgelehnt');
      return json({ error: 'Ungültige Signatur' }, 401);
    }
    const body = JSON.parse(raw) as CalendlyEvent;
    const result = await handleCalendly(repo, body);
    await repo.log('calendly-webhook', 'info', `Calendly: ${body.event}`, result);
    return json({ ok: true, ...result });
  } catch (e) {
    await repo.log('calendly-webhook', 'error', `Fehler: ${e instanceof Error ? e.message : e}`, {
      body: raw.slice(0, 4000),
    });
    // 500 → Calendly versucht es später erneut
    return json({ error: 'Interner Fehler' }, 500);
  }
});
