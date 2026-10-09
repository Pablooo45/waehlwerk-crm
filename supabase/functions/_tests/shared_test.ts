import { verifyCalendlySignature } from '../_shared/calendly.ts';
import { base64ToBytes, hmac } from '../_shared/crypto.ts';
import { companyFromAnswers, extractLeadId, extractPhones } from '../_shared/matching.ts';
import { isAllowedNumber, normalizePhone } from '../_shared/phone.ts';
import { assert, assertEquals } from '../_shared/test_utils.ts';
import {
  createVoiceAccessToken,
  el,
  twiml,
  twilioSignature,
  validateTwilioSignature,
} from '../_shared/twilio.ts';

Deno.test('Telefonnummern wie in der Datenbank', () => {
  const cases: [string, string | null][] = [
    ['069 123 456', '+4969123456'],
    ['+49 (0) 69 / 123-456', '+4969123456'],
    ['0049 6181 12345', '+49618112345'],
    ['0171 1234567', '+491711234567'],
    ['+43 1 234567', '+431234567'],
    ['4969123456789', '+4969123456789'],
    ['12', null],
    ['', null],
    ['06181 / 12 34 56', '+496181123456'],
  ];
  for (const [input, expected] of cases) assertEquals(normalizePhone(input), expected, input);
});

Deno.test('Sonderrufnummern gesperrt, Länder-Freigabe', () => {
  assert(!isAllowedNumber('+49900123456', ['+49']), '0900 gesperrt');
  assert(!isAllowedNumber('+491801234567', ['+49']), '0180 gesperrt');
  assert(isAllowedNumber('+4969123456', ['+49']), 'Festnetz erlaubt');
  assert(!isAllowedNumber('+1555123456', ['+49', '+43']), 'USA nicht freigegeben');
});

Deno.test('Twilio-Signatur entspricht der offiziellen Bibliothek', async () => {
  const token = '12345678901234567890123456789012';
  const url = 'https://abc.supabase.co/functions/v1/twilio-voice?step=dial-done&callId=11111111-2222-3333-4444-555555555555';
  const params = { CallSid: 'CA123', From: 'client:abc', To: '+4969123456', Digits: '1234', Caller: 'client:abc' };
  assertEquals(await twilioSignature(token, url, params), 'y5HgB4zGGghdEPPnE57yQnKkD28=');
  assert(await validateTwilioSignature(token, 'y5HgB4zGGghdEPPnE57yQnKkD28=', ['https://falsch.example', url], params));
  assert(!(await validateTwilioSignature(token, 'falsch', [url], params)));
  assert(!(await validateTwilioSignature(token, 'y5HgB4zGGghdEPPnE57yQnKkD28=', [url], { ...params, To: '+49900' })));
});

Deno.test('Calendly-Signatur', async () => {
  const body = '{"event":"invitee.created","payload":{"x":1}}';
  const header = 't=1700000000,v1=490f2ff7791f009011dea07a538d516d27f5cf4467f562f23b18c92c463943b1';
  assert(await verifyCalendlySignature(header, body, 'calendly-secret-key', 600, 1700000100));
  assert(!(await verifyCalendlySignature(header, body + ' ', 'calendly-secret-key', 600, 1700000100)), 'manipuliert');
  assert(!(await verifyCalendlySignature(header, body, 'calendly-secret-key', 600, 1700009999)), 'zu alt');
  assert(!(await verifyCalendlySignature(null, body, 'calendly-secret-key')), 'ohne Header');
});

Deno.test('Access Token für das Browser-Telefon', async () => {
  const token = await createVoiceAccessToken({
    accountSid: 'AC' + '1'.repeat(32),
    apiKeySid: 'SK' + '2'.repeat(32),
    apiKeySecret: 'geheim',
    appSid: 'AP' + '3'.repeat(32),
    identity: 'user-1',
    ttlSeconds: 600,
    now: 1700000000,
  });
  const [h, p, s] = token.split('.');
  const dec = (x: string) => JSON.parse(new TextDecoder().decode(base64ToBytes(x.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((x.length + 3) % 4))));
  const header = dec(h);
  const payload = dec(p);
  assertEquals(header, { alg: 'HS256', typ: 'JWT', cty: 'twilio-fpa;v=1' });
  assertEquals(payload.grants.identity, 'user-1');
  assertEquals(payload.grants.voice.outgoing.application_sid, 'AP' + '3'.repeat(32));
  assertEquals(payload.grants.voice.incoming.allow, true);
  assertEquals(payload.exp - payload.iat, 600);
  assertEquals(payload.iss, 'SK' + '2'.repeat(32));
  const expected = await hmac('SHA-256', 'geheim', `${h}.${p}`);
  const got = base64ToBytes(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  assertEquals([...got], [...expected], 'Signatur');
});

Deno.test('TwiML wird sauber maskiert', () => {
  const xml = twiml(el('Say', { voice: 'a"b' }, 'Müller & Söhne <GmbH>'), el('Hangup'));
  assertEquals(
    xml,
    '<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="a&quot;b">Müller &amp; Söhne &lt;GmbH&gt;</Say><Hangup/></Response>',
  );
});

Deno.test('Nummern, Lead-IDs und Firmennamen aus Texten lesen', () => {
  assertEquals(extractPhones(['Rückruf unter 06181 / 123 456 bitte', 'Termin 12.10.']), ['+496181123456']);
  assertEquals(
    extractLeadId('Im CRM: https://x.github.io/crm/#/leads/0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b'),
    '0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b',
  );
  assertEquals(companyFromAnswers([{ question: 'Name Ihrer Apotheke', answer: ' Stern-Apotheke ' }]), 'Stern-Apotheke');
  assertEquals(companyFromAnswers([{ question: 'Wie viele Filialen?', answer: '3' }]), null);
});
