// E-Mail: Nachrichten bauen und zerlegen, Versandfenster, Hilfen für Workflows und Close-Umzug.

import { berlinParts, berlinToDate, inWindow, nextWindowStart } from '../_shared/berlin.ts';
import { buildMime, decodeWords, encodeHeader, htmlToText, parseAddressList, parseMime, stripQuoted } from '../_shared/mime.ts';
import { dotStuff } from '../_shared/smtp.ts';
import { findSentFolder } from '../_shared/imap.ts';
import { pickSmsFrom, smsStatus } from '../_shared/sms.ts';
import { slugKey } from '../admin/close.ts';
import { mobileOf, waitMs } from '../jobs/workflows.ts';
import { assert, assertEquals } from '../_shared/test_utils.ts';

Deno.test('Kopfzeilen mit Umlauten werden kodiert und wieder lesbar', () => {
  const subject = 'Ihr Angebot für die Löwen-Apotheke – BAFA-Förderung 80 % (max. 2.800 €) und nächste Schritte';
  const enc = encodeHeader(subject);
  assert(/^[\x20-\x7e\r\n]+$/.test(enc), 'nur ASCII');
  assert(enc.split('\r\n ').every((w) => w.length <= 76), 'kurze Wörter');
  assertEquals(decodeWords(enc.replace(/\r\n /g, ' ')), subject);
  assertEquals(encodeHeader('Hallo'), 'Hallo');
});

Deno.test('Nachricht mit HTML, Text und Anhang – und zurück', () => {
  const raw = buildMime({
    from: { email: 'max@salus-digital.example', name: 'Max Müller' },
    to: [{ email: 'info@loewen-apotheke.de', name: 'Dr. Petra Muster' }],
    cc: [{ email: 'chef@loewen-apotheke.de' }],
    subject: 'Wie besprochen: Übersicht',
    html: '<p>Guten Tag Frau Dr. Muster,</p><p>anbei die Übersicht.<br>Beste Grüße</p>',
    text: 'Guten Tag Frau Dr. Muster,\n\nanbei die Übersicht.\nBeste Grüße',
    attachments: [{ name: 'Übersicht.pdf', contentType: 'application/pdf', data: new TextEncoder().encode('%PDF-1.4 test') }],
    messageId: 'abc@salus-digital.de',
    inReplyTo: 'xyz@loewen-apotheke.de',
    date: new Date('2026-10-08T10:00:00Z'),
  });
  assert(/^[\x00-\x7f]*$/.test(raw), '7-Bit sicher');
  assert(raw.includes('Message-ID: <abc@salus-digital.de>') && raw.includes('In-Reply-To: <xyz@loewen-apotheke.de>'));
  assert(raw.includes('Date: Thu, 08 Oct 2026 10:00:00 +0000'));
  const m = parseMime(raw);
  assertEquals(m.subject, 'Wie besprochen: Übersicht');
  assertEquals(m.from, { email: 'max@salus-digital.example', name: 'Max Müller' });
  assertEquals(m.to.map((a) => a.email), ['info@loewen-apotheke.de']);
  assertEquals(m.cc.map((a) => a.email), ['chef@loewen-apotheke.de']);
  assertEquals(m.text, 'Guten Tag Frau Dr. Muster,\n\nanbei die Übersicht.\nBeste Grüße');
  assert(m.html?.includes('anbei die Übersicht.'));
  assertEquals(m.attachments, [{ name: 'Übersicht.pdf', contentType: 'application/pdf', size: 13 }]);
  assertEquals([m.messageId, m.inReplyTo], ['abc@salus-digital.de', 'xyz@loewen-apotheke.de']);
});

Deno.test('Eingehende Mail aus Outlook (quoted-printable, ISO-8859-1, Abwesenheit)', () => {
  const raw = [
    'From: =?iso-8859-1?Q?J=FCrgen_B=E4cker?= <J.Baecker@Example.de>',
    'To: "Müller, Max" <max@salus-digital.example>',
    'Subject: =?iso-8859-1?Q?Automatische_Antwort:_Ihr_Angebot?=',
    'Message-ID: <m1@example.de>',
    'In-Reply-To: <abc@salus-digital.de>',
    'Auto-Submitted: auto-replied',
    'Date: Wed, 7 Oct 2026 14:03:00 +0200 (CEST)',
    'Content-Type: text/plain; charset="iso-8859-1"',
    'Content-Transfer-Encoding: quoted-printable',
    '',
    'Ich bin bis 20.10. nicht im B=FCro.=0D',
    'Gr=FC=DFe',
    '',
    'Am 06.10.2026 um 10:00 schrieb Max M=FCller:',
    '> alter Text',
  ].join('\r\n');
  const m = parseMime(raw);
  assertEquals(m.from, { email: 'j.baecker@example.de', name: 'Jürgen Bäcker' });
  assertEquals(m.to, [{ email: 'max@salus-digital.example', name: 'Müller, Max' }]);
  assertEquals(m.subject, 'Automatische Antwort: Ihr Angebot');
  assert(m.autoReply, 'Abwesenheit erkannt');
  assertEquals(m.date?.toISOString(), '2026-10-07T12:03:00.000Z');
  assertEquals(stripQuoted(m.text).replace(/\r/g, ''), 'Ich bin bis 20.10. nicht im Büro.\nGrüße');
});

Deno.test('Adresslisten mit Kommas in Namen und Gruppen', () => {
  assertEquals(parseAddressList('"Muster, Petra" <P@x.de>, b@y.de; Team: c@z.de;').map((a) => a.email), ['p@x.de', 'b@y.de', 'c@z.de']);
  assertEquals(parseAddressList('kaputt, <>'), []);
});

Deno.test('HTML → Text, Punkte am Zeilenanfang, Gesendet-Ordner', () => {
  assertEquals(htmlToText('<p>Hallo&nbsp;Welt</p><ul><li>eins</li><li>zwei</li></ul><a href="https://a.de">Link</a>'), 'Hallo Welt\n• eins\n• zwei\nLink (https://a.de)');
  assertEquals(dotStuff('a\n.b\r\n..c'), 'a\r\n..b\r\n...c');
  assertEquals(findSentFolder([{ name: 'INBOX', flags: [] }, { name: 'Gesendete Objekte', flags: ['\\HasNoChildren', '\\Sent'] }]), 'Gesendete Objekte');
  assertEquals(findSentFolder([{ name: 'INBOX', flags: [] }, { name: 'Gesendet', flags: [] }]), 'Gesendet');
});

Deno.test('Versandfenster in Berliner Zeit', () => {
  const w = { days: [1, 2, 3, 4, 5], from: '08:00', to: '18:00' };
  assert(inWindow(w, new Date('2026-10-07T10:00:00Z')), 'Mittwoch 12 Uhr');
  assert(!inWindow(w, new Date('2026-10-07T16:30:00Z')), 'Mittwoch 18:30');
  // Freitagabend → Montag 8 Uhr (Winterzeit ab 25.10.)
  assertEquals(nextWindowStart(w, new Date('2026-10-30T19:00:00Z')).toISOString(), '2026-11-02T07:00:00.000Z');
  // Sommerzeit: Montag 8 Uhr = 6 Uhr UTC
  assertEquals(nextWindowStart(w, new Date('2026-10-04T12:00:00Z')).toISOString(), '2026-10-05T06:00:00.000Z');
  assertEquals(berlinToDate(2026, 3, 29, 12, 0).toISOString(), '2026-03-29T10:00:00.000Z', 'Tag der Umstellung');
  assertEquals(berlinParts(new Date('2026-12-31T23:30:00Z')).year, 2027);
});

Deno.test('Workflows: Wartezeiten und Handynummer', () => {
  assertEquals(waitMs({ amount: 2, unit: 'days' }), 2 * 86_400_000);
  assertEquals(waitMs({ amount: 90, unit: 'minutes' }), 90 * 60_000);
  assertEquals(waitMs(undefined), 0);
  assertEquals(mobileOf({ id: 'c', name: '', sort: 0, emails: [], phones: [{ number: '+496181123' }, { number: '+491701234567' }] }), '+491701234567');
  assertEquals(mobileOf({ id: 'c', name: '', sort: 0, emails: [], phones: [{ number: '+496181123' }] }), null);
});

Deno.test('SMS: Absender und Status', () => {
  const numbers = [
    { number: '+4969000000', sms_capable: false, available_to_all: true, members: [] },
    { number: '+4915112345678', sms_capable: true, available_to_all: true, members: [] },
  ];
  assertEquals(pickSmsFrom({ requested: '+4969000000', profileNumber: null, userId: 'u', numbers }), '+4915112345678');
  assertEquals(pickSmsFrom({ requested: null, profileNumber: null, userId: 'u', numbers: [numbers[0]] }), null);
  assertEquals([smsStatus('accepted'), smsStatus('delivered'), smsStatus('undelivered')], ['queued', 'delivered', 'undelivered']);
});

Deno.test('Close-Umzug: Feldschlüssel aus deutschen Namen, eindeutig', () => {
  const taken = new Set(['bundesland']);
  assertEquals(slugKey('Bundesland', taken), 'bundesland_2');
  assertEquals(slugKey('Größe der Apotheke (m²)', taken), 'groesse_der_apotheke_m');
  assertEquals(slugKey('2. Ansprechpartner', taken), 'f_2_ansprechpartner');
});
