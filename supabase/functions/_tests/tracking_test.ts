// E-Mail-Öffnungen und Link-Klicks: signierte Links, Pixel, Weiterleitung, Benachrichtigung.

import { addTracking, clickUrl, handleTrack, linkify, openUrl, parseHit, PIXEL_GIF, type TrackStore } from '../_shared/tracking.ts';
import { assert, assertEquals } from '../_shared/test_utils.ts';

const ID = '1e000000-0000-4000-8000-000000000043';
const BASE = 'https://projekt.supabase.co/functions/v1/email-track';
const KEY = 'geheim-geheim-geheim';
const opts = { emailId: ID, base: BASE, key: KEY, opens: true, clicks: true };

Deno.test('Zählpixel und Links werden eingesetzt, mailto und eigene Links bleiben', async () => {
  const html = '<p>Hallo,</p><p><a href="https://apokunden.de/angebot?a=1&amp;b=2">Angebot</a> oder <a href=\'mailto:info@x.de\'>Mail</a></p>';
  const out = await addTracking(html, opts);
  assert(out.includes(`${BASE}/o/${ID}.`), 'Pixel');
  assert(out.includes('mailto:info@x.de'), 'mailto bleibt');
  assert(!out.includes('href="https://apokunden.de'), 'Link umgeleitet');
  const m = /href="([^"]+\/c\/[^"]+)"/.exec(out);
  assert(m, 'Klick-Link');
  const target = new URL(m![1].replace(/&amp;/g, '&')).searchParams.get('u');
  assertEquals(target, 'https://apokunden.de/angebot?a=1&b=2');
  // nur Pixel, keine Links
  const onlyOpen = await addTracking(html, { ...opts, clicks: false });
  assert(onlyOpen.includes('href="https://apokunden.de/angebot?a=1&amp;b=2"'));
  // zweimal einsetzen ändert die eigenen Links nicht erneut
  const twice = await addTracking(out, { ...opts, opens: false });
  assertEquals((twice.match(/\/c\//g) ?? []).length, 1);
});

Deno.test('Links im Text werden klickbar, bestehende Links bleiben', () => {
  const out = linkify('<p>Infos: https://apokunden.de/kurs. Oder <a href="https://x.de">hier</a> &amp; www</p>');
  assert(out.includes('<a href="https://apokunden.de/kurs">https://apokunden.de/kurs</a>.'), out);
  assertEquals((out.match(/<a /g) ?? []).length, 2);
});

Deno.test('Signaturen: echte Links gelten, veränderte nicht', async () => {
  const o = new URL(await openUrl(opts));
  assertEquals(await parseHit(o, KEY), { kind: 'open', emailId: ID });
  const c = new URL(await clickUrl(opts, 'https://apokunden.de/'));
  assertEquals(await parseHit(c, KEY), { kind: 'click', emailId: ID, url: 'https://apokunden.de/' });
  // Ziel ausgetauscht → keine Weiterleitung
  const evil = new URL(c);
  evil.searchParams.set('u', 'https://boese.example/');
  assertEquals((await parseHit(evil, KEY)).kind, 'invalid');
  // falscher Schlüssel, fehlender Schlüssel, kein http
  assertEquals((await parseHit(o, 'anderer-schluessel')).kind, 'invalid');
  assertEquals((await parseHit(o, null)).kind, 'invalid');
  const js = new URL(await clickUrl(opts, 'javascript:alert(1)'));
  assertEquals((await parseHit(js, KEY)).kind, 'invalid');
});

function fakeStore(over: Partial<TrackStore> = {}) {
  const calls: string[] = [];
  const store: TrackStore = {
    key: () => Promise.resolve(KEY),
    record: (id, kind, url) => {
      calls.push(`record ${kind} ${url ?? ''}`);
      return Promise.resolve({ first: true, lead_id: 'lead-1', user_id: 'user-1', subject: 'Angebot', to: 'info@apotheke.de' });
    },
    wantsNotice: () => Promise.resolve(true),
    notify: (_u, _l, _e, title, body) => {
      calls.push(`notify ${title}: ${body}`);
      return Promise.resolve();
    },
    log: (m) => {
      calls.push(`log ${m}`);
      return Promise.resolve();
    },
    ...over,
  };
  return { store, calls };
}

Deno.test('Öffnen: Pixel kommt immer, Ereignis und Hinweis an den Absender', async () => {
  const { store, calls } = fakeStore();
  const res = await handleTrack(new Request(await openUrl(opts)), store);
  assertEquals(res.headers.get('content-type'), 'image/gif');
  assertEquals(new Uint8Array(await res.arrayBuffer()), PIXEL_GIF);
  assertEquals(calls, ['record open ', 'notify E-Mail geöffnet: Angebot – info@apotheke.de']);
  // ungültiges Pixel: trotzdem ein Bild, aber nichts gezählt
  const bad = fakeStore();
  const r2 = await handleTrack(new Request(`${BASE}/o/${ID}.AAAAAAAAAAAAAAAAAAAAAA.gif`), bad.store);
  assertEquals(r2.headers.get('content-type'), 'image/gif');
  assertEquals(bad.calls, []);
});

Deno.test('Klick: Weiterleitung zum Ziel, ohne Hinweis wenn nicht gewünscht', async () => {
  const { store, calls } = fakeStore({ wantsNotice: () => Promise.resolve(false) });
  const res = await handleTrack(new Request(await clickUrl(opts, 'https://apokunden.de/kurs')), store);
  assertEquals(res.status, 302);
  assertEquals(res.headers.get('location'), 'https://apokunden.de/kurs');
  assertEquals(calls, ['record click https://apokunden.de/kurs']);
  // manipulierter Link: keine Weiterleitung
  const evil = new URL(await clickUrl(opts, 'https://apokunden.de/kurs'));
  evil.searchParams.set('u', 'https://boese.example/');
  const r2 = await handleTrack(new Request(evil), store);
  assertEquals(r2.status, 400);
});

Deno.test('Zählen schlägt fehl: Empfänger merkt nichts', async () => {
  const { store, calls } = fakeStore({ record: () => Promise.reject(new Error('Datenbank weg')) });
  const res = await handleTrack(new Request(await clickUrl(opts, 'https://apokunden.de/')), store);
  assertEquals(res.status, 302);
  assertEquals(calls, ['log Zählen fehlgeschlagen: Datenbank weg']);
});
