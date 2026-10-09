// Twilio ruft diese Adresse bei jedem Anruf auf (ausgehend aus dem Browser und eingehend).
// Antwort: TwiML (XML), das Twilio sagt, was zu tun ist.

import { SupabaseRepo } from '../_shared/db.ts';
import { readForm, xml } from '../_shared/http.ts';
import { telCtx, verifyTwilio } from '../_shared/server.ts';
import { el, say, twiml } from '../_shared/twilio.ts';
import { handleVoice } from './logic.ts';

Deno.serve(async (req) => {
  const repo = new SupabaseRepo();
  const url = new URL(req.url);
  const { params } = await readForm(req);
  try {
    if (!(await verifyTwilio(req, repo, 'twilio-voice', params))) {
      return new Response('Ungültige Signatur', { status: 403 });
    }
    return xml(await handleVoice(telCtx(repo), url.searchParams.get('step') ?? 'start', url.searchParams, params));
  } catch (e) {
    await repo.log('twilio-voice', 'error', `Fehler: ${e instanceof Error ? e.message : e}`, {
      step: url.searchParams.get('step'),
      callSid: params.CallSid,
      stack: e instanceof Error ? e.stack : null,
    });
    return xml(twiml(say('Es ist ein technischer Fehler aufgetreten. Bitte versuche es gleich noch einmal.'), el('Hangup')));
  }
});
