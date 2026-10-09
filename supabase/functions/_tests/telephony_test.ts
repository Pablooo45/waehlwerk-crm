import type { Profile } from '../_shared/db.ts';
import { encodeWav16 } from '../_shared/wav.ts';
import { ALL_PERMS, assert, assertEquals, assertRejects, FakeRepo, fnUrl, member, number } from '../_shared/test_utils.ts';
import type { TelCtx } from '../_shared/telephony.ts';
import { type TwilioClient, TwilioError } from '../_shared/twilio.ts';
import { handleControl } from '../call-control/logic.ts';
import { handleStatus, MAX_RECORDING_ATTEMPTS, retryRecording } from '../twilio-status/logic.ts';
import { handleVoice } from '../twilio-voice/logic.ts';

const ADA = '00000000-0000-4000-8000-00000000000a';
const BOB = '00000000-0000-4000-8000-00000000000b';
const CARL = '00000000-0000-4000-8000-00000000000c';
const LEAD = '10000000-0000-4000-8000-000000000001';
const NOON = new Date('2026-10-07T10:00:00Z'); // Mittwoch, 12:00 in Berlin
const NIGHT = new Date('2026-10-07T20:30:00Z'); // Mittwoch, 22:30 in Berlin

interface FakeRecording {
  sid: string;
  call_sid: string;
  status: string;
  channels?: number;
  duration?: string;
  source?: string;
  date_created?: string;
}

class FakeTwilio {
  base = 'https://api.twilio.com/2010-04-01/Accounts/AC1';
  calls: { method: string; path: string; params?: Record<string, unknown> }[] = [];
  wav = encodeWav16([tone(0.3, 0, 2), tone(0.25, 2, 4)], 8000);
  recordings: FakeRecording[] = []; // was Twilio über die REST-Schnittstelle kennt
  mediaFailures = 0; // so oft schlägt das Herunterladen fehl
  media: string[] = []; // abgerufene Adressen
  async request(method: string, path: string, params?: Record<string, unknown>) {
    this.calls.push({ method, path, params });
    if (method === 'GET' && path === '/Recordings.json') {
      return { recordings: this.recordings.filter((r) => r.call_sid === params?.CallSid) };
    }
    const one = path.match(/^\/Recordings\/(RE\w+)\.json$/);
    if (method === 'GET' && one) {
      const r = this.recordings.find((x) => x.sid === one[1]);
      if (!r) throw new TwilioError(404, 20404, 'Twilio 404: The requested resource was not found');
      return { ...r, uri: `/2010-04-01/Accounts/AC1/Recordings/${r.sid}.json` };
    }
    if (path.endsWith('/Recordings.json')) return { sid: 'RE1' };
    if (path === '/Calls.json') return { calls: [{ sid: 'CAchild', status: 'in-progress' }] };
    if (path === '/Conferences.json') return { conferences: [{ sid: 'CF1' }] };
    if (method === 'POST' && path.endsWith('/Participants.json')) return { call_sid: 'CAcust' };
    return {};
  }
  async fetchMedia(url: string, format: 'wav' | 'mp3') {
    this.media.push(url);
    if (this.mediaFailures > 0) {
      this.mediaFailures--;
      throw new Error('Aufnahme konnte nicht von Twilio geladen werden: 503 Service Unavailable');
    }
    const bytes = format === 'wav' ? this.wav : new Uint8Array([0xff, 0xfb, 0x90, 0x00]);
    return new Response(bytes as BodyInit, { headers: { 'content-length': String(bytes.length) } });
  }
}

// 4 s Ton, der nur zwischen from und to (Sekunden) klingt
function tone(amp: number, from: number, to: number): Float32Array {
  const sr = 8000;
  const out = new Float32Array(sr * 4);
  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    out[i] = t >= from && t < to ? amp * Math.sin(2 * Math.PI * 200 * t) : 0.001 * Math.sin(t * 50);
  }
  return out;
}

function setup(now = NOON) {
  const repo = new FakeRepo();
  repo.profiles = [member(ADA, 'Ada', { role_id: 'admin' }), member(BOB, 'Bob', { phone_number: '+4969111111' })];
  repo.numbers = [number('+4969000000'), number('+496181999000')];
  repo.leads = [{ id: LEAD, name: 'Löwen-Apotheke', owner_id: BOB, status_id: null, status_kind: 'open', do_not_call: false }];
  repo.contacts = [{ id: 'c1', lead_id: LEAD, name: 'Dr. Muster', phones: ['+496181123456'], emails: ['info@loewen.de'] }];
  const twilio = new FakeTwilio();
  const pending: Promise<unknown>[] = [];
  const ctx: TelCtx = {
    repo,
    fn: fnUrl,
    twilio: async () => twilio as unknown as TwilioClient,
    bg: (p) => pending.push(p),
    now: () => now,
  };
  const flush = async () => {
    while (pending.length) await pending.shift();
  };
  return { repo, twilio, ctx, flush };
}

const q = (s = '') => new URLSearchParams(s);

// Parameter aus einer Adresse im TwiML lesen (z. B. action="…")
function attrUrl(xml: string, attr: string, nth = 0): URLSearchParams {
  const all = [...xml.matchAll(new RegExp(`${attr}="([^"]+)"`, 'g'))];
  const raw = all[nth]?.[1];
  if (!raw) throw new Error(`${attr} fehlt in ${xml}`);
  return new URL(raw.replaceAll('&amp;', '&')).searchParams;
}

function caller(p: Profile, perms?: string[]) {
  const set = new Set(perms ?? (p.role_id === 'admin' ? ALL_PERMS : ['calling', 'use_ai']));
  return { ...p, perms: set, can: (x: string) => set.has(x), isAdmin: set.has('manage_organization') };
}

// ---------------------------------------------------------------------------
// Ausgehend
// ---------------------------------------------------------------------------
Deno.test('Ausgehend: wählt normalisierte Nummer mit eigener Absendernummer, ohne Verzögerung', async () => {
  const { repo, ctx } = setup();
  const callId = '20000000-0000-4000-8000-000000000001';
  const xml = await handleVoice(ctx, 'start', q(), { From: `client:${BOB}`, To: '06181 123456', CallSid: 'CAparent', leadId: LEAD, callId });
  assert(xml.includes('>+496181123456</Number>'), 'Nummer nicht normalisiert');
  assert(xml.includes('callerId="+4969111111"'), 'eigene Nummer als Absender');
  assert(xml.includes('answerOnBridge="true"'), 'answerOnBridge');
  assert(!xml.includes('record='), 'manuell = keine Auto-Aufnahme');
  const call = await repo.call(callId);
  assertEquals([call?.lead_id, call?.twilio_call_sid, call?.direction, call?.conference_name], [LEAD, 'CAparent', 'outbound', null]);
});

Deno.test('Ausgehend: Auto-Aufnahme in zwei Spuren, unsere Stimme auf Spur 1, Hinweis an den Kunden', async () => {
  const { repo, ctx } = setup();
  repo.orgSettings.recording_mode = 'auto';
  repo.orgSettings.recording_announcement = true;
  const xml = await handleVoice(ctx, 'start', q(), { From: `client:${ADA}`, To: '+4969123456', CallSid: 'CA2' });
  assert(xml.includes('record="record-from-answer-dual"'), xml);
  assert(xml.includes('recordingTrack="both"'));
  assertEquals(attrUrl(xml, 'recordingStatusCallback').get('ac'), '1');
  assertEquals(attrUrl(xml, 'url').get('step'), 'announce', 'Hinweis vor dem Verbinden');
  const announce = await handleVoice(ctx, 'announce', q(), {});
  assert(announce.includes('Dieses Gespräch wird aufgezeichnet.'));
});

Deno.test('Ausgehend: nur eigene Stimme aufnehmen', async () => {
  const { repo, ctx } = setup();
  repo.orgSettings.recording_mode = 'auto_agent';
  const xml = await handleVoice(ctx, 'start', q(), { From: `client:${ADA}`, To: '+4969123456', CallSid: 'CA2b' });
  assert(xml.includes('record="record-from-answer"') && xml.includes('recordingTrack="inbound"'), xml);
});

Deno.test('Ausgehend: Sonderrufnummer, "nicht anrufen" und fehlendes Recht werden abgelehnt', async () => {
  const { repo, ctx } = setup();
  let xml = await handleVoice(ctx, 'start', q(), { From: `client:${ADA}`, To: '0900 123456', CallSid: 'CA3' });
  assert(xml.includes('gesperrt') && !xml.includes('<Dial'), xml);

  repo.leads[0].do_not_call = true;
  xml = await handleVoice(ctx, 'start', q(), { From: `client:${ADA}`, To: '06181 123456', CallSid: 'CA3b' });
  assert(xml.includes('nicht anrufen') && !xml.includes('<Dial'), 'Nicht-anrufen per Nummer erkannt');

  repo.perms.set(BOB, new Set(['use_ai']));
  xml = await handleVoice(ctx, 'start', q(), { From: `client:${BOB}`, To: '+4969123456', CallSid: 'CA3c' });
  assert(xml.includes('darf nicht telefonieren'), xml);
});

Deno.test('Ausgehend: fremde Absendernummer wird ignoriert, Local Presence wählt passende Vorwahl', async () => {
  const { repo, ctx } = setup();
  let xml = await handleVoice(ctx, 'start', q(), { From: `client:${BOB}`, To: '+4969123456', CallSid: 'CA4', callerId: '+4930999999' });
  assert(xml.includes('callerId="+4969111111"'), xml);
  repo.orgSettings.local_presence = true;
  xml = await handleVoice(ctx, 'start', q(), { From: `client:${BOB}`, To: '+496181555555', CallSid: 'CA5' });
  assert(xml.includes('callerId="+496181999000"'), 'Offenbacher Nummer für Offenbacher Kunden');
});

Deno.test('Ausgehend: Anruf ohne Lead wird über die Nummer dem Lead zugeordnet', async () => {
  const { repo, ctx } = setup();
  const callId = '20000000-0000-4000-8000-000000000006';
  await handleVoice(ctx, 'start', q(), { From: `client:${ADA}`, To: '+496181123456', CallSid: 'CA6', callId });
  const c = await repo.call(callId);
  assertEquals([c?.lead_id, c?.contact_id], [LEAD, 'c1']);
});

Deno.test('Konferenzmodus: wir warten still in der Konferenz, Kunde wird parallel angerufen und aufgenommen', async () => {
  const { repo, twilio, ctx, flush } = setup();
  repo.orgSettings.conference_mode = true;
  repo.orgSettings.recording_mode = 'auto';
  const callId = '20000000-0000-4000-8000-000000000007';
  const xml = await handleVoice(ctx, 'start', q(), { From: `client:${BOB}`, To: '+496181123456', CallSid: 'CAagent', callId });
  assert(xml.includes(`>call-${callId}</Conference>`), xml);
  assert(xml.includes('waitUrl=""') && xml.includes('participantLabel="agent"') && xml.includes('region="de1"'), xml);
  await flush();
  const add = twilio.calls.find((c) => c.path === `/Conferences/call-${callId}/Participants.json`);
  assert(add, 'Kunde als Teilnehmer angerufen');
  assertEquals([add!.params?.To, add!.params?.From, add!.params?.Label, add!.params?.EarlyMedia], ['+496181123456', '+4969111111', 'customer', true]);
  assertEquals([add!.params?.Record, add!.params?.RecordingChannels], [true, 'dual']);
  assertEquals(new URL(String(add!.params?.RecordingStatusCallback)).searchParams.get('ac'), '2', 'Konferenz: wir auf Spur 2');
  assertEquals((await repo.call(callId))?.twilio_child_sid, 'CAcust');

  // Kunde nimmt ab, legt später auf
  await handleStatus(ctx, 'participant', q(`callId=${callId}`), { CallStatus: 'ringing', CallSid: 'CAcust' });
  await handleStatus(ctx, 'participant', q(`callId=${callId}`), { CallStatus: 'in-progress', CallSid: 'CAcust', ConferenceSid: 'CF9' });
  await handleStatus(ctx, 'participant', q(`callId=${callId}`), { CallStatus: 'completed', CallSid: 'CAcust', CallDuration: '95' });
  const c = await repo.call(callId);
  assertEquals([c?.status, c?.duration, c?.conference_sid], ['completed', 95, 'CF9']);
});

Deno.test('Konferenzmodus: Kunde nimmt nicht ab → wir werden aus der Konferenz geholt', async () => {
  const { repo, twilio, ctx } = setup();
  repo.orgSettings.conference_mode = true;
  const callId = '20000000-0000-4000-8000-000000000008';
  await handleVoice(ctx, 'start', q(), { From: `client:${BOB}`, To: '+496181123456', CallSid: 'CAagent2', callId });
  await handleStatus(ctx, 'participant', q(`callId=${callId}`), { CallStatus: 'no-answer', CallSid: 'CAcust' });
  assertEquals((await repo.call(callId))?.status, 'no-answer');
  assert(twilio.calls.some((c) => c.path === '/Calls/CAagent2.json' && c.params?.Status === 'completed'), 'Leitung beendet');
});

Deno.test('Mithören, Einflüstern, Aufschalten', async () => {
  const { repo, twilio, ctx } = setup();
  repo.profiles.push(member(CARL, 'Carl', { role_id: 'manager' }));
  repo.perms.set(CARL, new Set(['calling', 'call_coach_listen']));
  const target = '20000000-0000-4000-8000-000000000030';
  await repo.upsertCall({ id: target, user_id: BOB, status: 'in-progress', twilio_call_sid: 'CAbob', conference_name: `call-${target}`, conference_sid: 'CFx' });

  let xml = await handleVoice(ctx, 'start', q(), { From: `client:${CARL}`, monitorCallId: target, mode: 'listen', CallSid: 'CAcarl' });
  assert(xml.includes('muted="true"') && xml.includes(`participantLabel="monitor-${CARL}"`) && xml.includes('startConferenceOnEnter="false"'), xml);
  assertEquals((await repo.call(target))?.monitors?.[0]?.mode, 'listen');

  xml = await handleVoice(ctx, 'start', q(), { From: `client:${CARL}`, monitorCallId: target, mode: 'barge', CallSid: 'CAcarl2' });
  assert(xml.includes('Berechtigung'), 'Aufschalten braucht eigenes Recht');

  await handleControl(ctx, caller(repo.profiles[2], ['call_coach_listen']), { action: 'monitor_mode', callId: target, mode: 'whisper' });
  const upd = twilio.calls.find((c) => c.path === `/Conferences/CFx/Participants/monitor-${CARL}.json`);
  assertEquals([upd?.params?.Coaching, upd?.params?.CallSidToCoach, upd?.params?.Muted], [true, 'CAbob', false]);

  await handleVoice(ctx, 'monitor-done', q(`callId=${target}&uid=${CARL}`), {});
  assert((await repo.call(target))?.monitors?.[0]?.ended_at, 'Mithören beendet');
});

// ---------------------------------------------------------------------------
// Eingehend
// ---------------------------------------------------------------------------
Deno.test('Eingehend: erst der Zuständige, dann das Team, dann Mailbox mit Aufgabe und Benachrichtigung', async () => {
  const { repo, ctx } = setup();
  const xml = await handleVoice(ctx, 'start', q(), { From: '+496181123456', To: '+4969000000', CallSid: 'CAin' });
  assertEquals((xml.match(/<Client /g) ?? []).length, 1, 'nur der Zuständige');
  assert(xml.includes(`<Identity>${BOB}</Identity>`) && xml.includes('timeout="18"'), xml);
  assert(xml.includes('<Parameter name="leadName" value="Löwen-Apotheke"/>'), 'Lead-Name übergeben');
  const call = [...repo.calls.values()][0];
  assertEquals([call.direction, call.lead_id, call.user_id], ['inbound', LEAD, BOB]);

  const a1 = attrUrl(xml, 'action');
  const xml2 = await handleVoice(ctx, 'route', a1, { DialCallStatus: 'no-answer', CallStatus: 'in-progress' });
  assert(xml2.includes(`<Identity>${ADA}</Identity>`) && !xml2.includes(`<Identity>${BOB}</Identity>`), 'jetzt das Team ohne den Zuständigen');

  const xml3 = await handleVoice(ctx, 'route', attrUrl(xml2, 'action'), { DialCallStatus: 'no-answer', CallStatus: 'in-progress' });
  assert(xml3.includes('<Record') && xml3.includes('Bitte Nachricht hinterlassen.'), 'Mailbox');
  assertEquals(repo.tasks.length, 1);
  assertEquals([repo.tasks[0].type, repo.tasks[0].title, repo.tasks[0].assigned_to], ['missed_call', 'Verpasster Anruf von Löwen-Apotheke', BOB]);
  assertEquals(repo.notifications.map((n) => n.kind), ['missed_call']);
  assertEquals((await repo.call(call.id))?.status, 'no-answer');
});

Deno.test('Eingehend: Zuständiger offline oder besetzt → direkt das Team', async () => {
  const { repo, ctx } = setup();
  repo.profiles[1].last_seen_at = new Date(NOON.getTime() - 3_600_000).toISOString();
  const xml = await handleVoice(ctx, 'start', q(), { From: '+496181123456', To: '+4969000000', CallSid: 'CAin2' });
  assert(xml.includes(`<Identity>${ADA}</Identity>`) && !xml.includes(`<Identity>${BOB}</Identity>`), xml);
});

Deno.test('Eingehend: angenommen → Anruf gehört dem, der abnimmt', async () => {
  const { repo, ctx } = setup();
  await handleVoice(ctx, 'start', q(), { From: '+4917012345678', To: '+4969000000', CallSid: 'CAin3' });
  const id = [...repo.calls.values()][0].id;
  await handleStatus(ctx, 'inbound-leg', q(`callId=${id}&uid=${ADA}`), { CallStatus: 'in-progress', CallSid: 'CAleg' });
  await handleVoice(ctx, 'route', q(`callId=${id}&stage=pool`), { DialCallStatus: 'completed', DialCallDuration: '42' });
  const c = await repo.call(id);
  assertEquals([c?.user_id, c?.status, c?.duration], [ADA, 'completed', 42]);
  assertEquals(repo.tasks.length, 0);
});

Deno.test('Eingehend: außerhalb der Rufzeiten → Mailbox, verpasster Anruf', async () => {
  const { repo, ctx } = setup(NIGHT);
  repo.numbers[0].business_hours = { mon: [['08:00', '18:00']], tue: [['08:00', '18:00']], wed: [['08:00', '18:00']], thu: [['08:00', '18:00']], fri: [['08:00', '18:00']] };
  const xml = await handleVoice(ctx, 'start', q(), { From: '+4917012345678', To: '+4969000000', CallSid: 'CAnight' });
  assert(xml.includes('<Record') && !xml.includes('<Dial'), xml);
  assertEquals(repo.tasks.length, 1);
});

Deno.test('Eingehend: Begrüßung, Aufnahme-Hinweis und Aufnahme der Nummer (Kunde Spur 1, wir Spur 2)', async () => {
  const { repo, ctx } = setup();
  repo.numbers[0].greeting_text = 'Willkommen bei Salus Digital.';
  repo.numbers[0].record_inbound = true;
  repo.orgSettings.recording_announcement = true;
  const xml = await handleVoice(ctx, 'start', q(), { From: '+4917012345678', To: '+4969000000', CallSid: 'CArec' });
  assert(xml.indexOf('Willkommen bei Salus Digital.') < xml.indexOf('aufgezeichnet') && xml.indexOf('aufgezeichnet') < xml.indexOf('<Dial'), xml);
  assert(xml.includes('record="record-from-answer-dual"'));
  assertEquals(attrUrl(xml, 'recordingStatusCallback').get('ac'), '2');
});

Deno.test('Eingehend: Telefonmenü – Taste wählt Gruppe, keine Taste → Mailbox', async () => {
  const { repo, ctx } = setup();
  repo.profiles.push(member(CARL, 'Carl'));
  repo.groups = { g1: [CARL] };
  repo.numbers[0].ivr = {
    greeting: 'Für den Vertrieb die 1, für den Kundenservice die 2.',
    options: [{ digit: '1', label: 'Vertrieb', action: 'ring' }, { digit: '2', label: 'Service', action: 'group', target: 'g1' }],
    timeout_action: 'voicemail',
  };
  const xml = await handleVoice(ctx, 'start', q(), { From: '+4917012345678', To: '+4969000000', CallSid: 'CAivr' });
  assert(xml.includes('<Gather') && xml.includes('Für den Vertrieb'), xml);
  const id = [...repo.calls.values()][0].id;
  const two = await handleVoice(ctx, 'ivr', q(`callId=${id}`), { Digits: '2' });
  assert(two.includes(`<Identity>${CARL}</Identity>`) && (two.match(/<Client /g) ?? []).length === 1, two);
  const none = await handleVoice(ctx, 'ivr', q(`callId=${id}`), {});
  assert(none.includes('<Record'), none);
});

Deno.test('Eingehend: reihum – jeder Anruf beginnt bei der nächsten Person', async () => {
  const { repo, ctx } = setup();
  repo.profiles.push(member(CARL, 'Carl'));
  repo.numbers[0].ring_mode = 'round_robin';
  const first = await handleVoice(ctx, 'start', q(), { From: '+4917011111111', To: '+4969000000', CallSid: 'CArr1' });
  const second = await handleVoice(ctx, 'start', q(), { From: '+4917022222222', To: '+4969000000', CallSid: 'CArr2' });
  const who = (x: string) => x.match(/<Identity>([^<]+)<\/Identity>/)?.[1];
  assert(who(first) && who(second) && who(first) !== who(second), `${who(first)} / ${who(second)}`);
  assertEquals((first.match(/<Client /g) ?? []).length, 1);
  const next = await handleVoice(ctx, 'route', attrUrl(first, 'action'), { DialCallStatus: 'no-answer', CallStatus: 'in-progress' });
  assert(who(next) && who(next) !== who(first), 'nächste Person');
});

Deno.test('Eingehend: Weiterleitung aufs Handy mit Annahme per Taste', async () => {
  const { repo, ctx } = setup();
  repo.profiles = [member(ADA, 'Ada', { role_id: 'admin', forward_mode: 'always', forward_number: '+491701234567', last_seen_at: null })];
  const xml = await handleVoice(ctx, 'start', q(), { From: '+4917012345678', To: '+4969000000', CallSid: 'CAfwd' });
  assert(xml.includes('>+491701234567</Number>') && xml.includes('callerId="+4917012345678"'), xml);
  assertEquals(attrUrl(xml, 'url').get('step'), 'screen');
  const id = [...repo.calls.values()][0].id;
  const screen = await handleVoice(ctx, 'screen', q(`callId=${id}`), {});
  assert(screen.includes('<Gather') && screen.includes('die 1 drücken'), screen);
  assertEquals(await handleVoice(ctx, 'screen-done', q(), { Digits: '1' }), '<?xml version="1.0" encoding="UTF-8"?><Response/>');
});

Deno.test('Eingehend: Anrufer legt beim Klingeln auf → genau ein verpasster Anruf', async () => {
  const { repo, ctx } = setup();
  const xml = await handleVoice(ctx, 'start', q(), { From: '+4917012345678', To: '+4969000000', CallSid: 'CAhang' });
  await handleStatus(ctx, 'parent', q(), { CallStatus: 'completed', CallSid: 'CAhang' });
  await handleVoice(ctx, 'route', attrUrl(xml, 'action'), { DialCallStatus: 'no-answer', CallStatus: 'completed' });
  assertEquals(repo.tasks.length, 1);
  assertEquals(repo.notifications.length, 0, 'kein Zuständiger → keine persönliche Benachrichtigung');
  assertEquals([...repo.calls.values()][0].status, 'no-answer');
});

// ---------------------------------------------------------------------------
// Aufnahmen
// ---------------------------------------------------------------------------
Deno.test('Aufnahme fertig → WAV in zwei Spuren im EU-Speicher, Wellenform + Redeanteile, bei Twilio gelöscht', async () => {
  const { repo, twilio, ctx, flush } = setup();
  const id = '20000000-0000-4000-8000-000000000010';
  await repo.upsertCall({ id, status: 'completed', direction: 'outbound', started_at: '2026-10-07T10:00:00Z' });
  await handleStatus(ctx, 'recording', q(`callId=${id}&ac=1`), { RecordingStatus: 'in-progress', RecordingSid: 'RE9' });
  assertEquals((await repo.call(id))?.recording_status, 'recording');
  await handleStatus(ctx, 'recording', q(`callId=${id}&ac=1`), {
    RecordingStatus: 'completed',
    RecordingUrl: 'https://api.twilio.com/2010-04-01/Accounts/AC1/Recordings/RE9',
    RecordingSid: 'RE9',
    RecordingDuration: '4',
    RecordingChannels: '2',
  });
  await flush();
  const c = await repo.call(id);
  assertEquals([c?.recording_status, c?.recording_path, c?.recording_format, c?.recording_channels, c?.agent_channel], [
    'ready',
    `2026/10/${id}-RE9.wav`,
    'wav',
    2,
    1,
  ]);
  assertEquals(repo.uploads[0].contentType, 'audio/wav');
  const ins = await repo.insights(id);
  const peaks = ins?.peaks as { agent: number[]; customer: number[] };
  assert(peaks.agent.length > 50 && peaks.customer.length > 50, 'Wellenform beider Spuren');
  // wir sprechen 0–2 s, der Kunde 2–4 s
  assert(Math.abs((c?.talk_agent_ms ?? 0) - 2000) < 400 && Math.abs((c?.talk_customer_ms ?? 0) - 2000) < 400, `${c?.talk_agent_ms}/${c?.talk_customer_ms}`);
  assert(twilio.calls.some((x) => x.method === 'DELETE' && x.path === '/Recordings/RE9.json'), 'bei Twilio gelöscht');
});

Deno.test('Aufnahme als MP3 (Einstellung) – Auswertung trotzdem aus der WAV', async () => {
  const { repo, ctx, flush } = setup();
  repo.orgSettings.recording_format = 'mp3';
  const id = '20000000-0000-4000-8000-000000000011';
  await repo.upsertCall({ id, status: 'completed', direction: 'inbound', started_at: '2026-10-07T10:00:00Z' });
  await handleStatus(ctx, 'recording', q(`callId=${id}&ac=2`), {
    RecordingStatus: 'completed',
    RecordingUrl: 'https://api.twilio.com/x/Recordings/RE10',
    RecordingSid: 'RE10',
    RecordingChannels: '2',
  });
  await flush();
  const c = await repo.call(id);
  assertEquals([c?.recording_format, c?.agent_channel, repo.uploads[0].contentType], ['mp3', 2, 'audio/mpeg']);
  // Spur 2 = wir → Kunde sprach 0–2 s
  const ins = await repo.insights(id);
  const talk = ins?.talk as { agent_ms: number; customer_ms: number };
  assert(talk.customer_ms > 1500 && talk.agent_ms > 1500, JSON.stringify(talk));
});

Deno.test('Mailbox-Nachricht eines Anrufers → Aufgabe wird zu "Mailbox-Nachricht", Zuständiger wird benachrichtigt', async () => {
  const { repo, ctx, flush } = setup();
  const xml = await handleVoice(ctx, 'start', q(), { From: '+496181123456', To: '+4969000000', CallSid: 'CAvm' });
  const call = [...repo.calls.values()][0];
  let next = await handleVoice(ctx, 'route', attrUrl(xml, 'action'), { DialCallStatus: 'no-answer', CallStatus: 'in-progress' });
  next = await handleVoice(ctx, 'route', attrUrl(next, 'action'), { DialCallStatus: 'no-answer', CallStatus: 'in-progress' });
  assert(next.includes('<Record'));
  await handleStatus(ctx, 'voicemail', q(`callId=${call.id}`), {
    RecordingStatus: 'completed',
    RecordingUrl: 'https://api.twilio.com/x/Recordings/RE5',
    RecordingSid: 'RE5',
    RecordingDuration: '4',
  });
  await flush();
  assertEquals(repo.tasks.length, 1);
  assertEquals([repo.tasks[0].type, repo.tasks[0].title], ['voicemail', 'Mailbox-Nachricht von Löwen-Apotheke']);
  const c = await repo.call(call.id);
  assert(c?.is_voicemail && c.recording_path?.startsWith('mailbox/'), 'als Mailbox gespeichert');
  assertEquals(repo.notifications.map((n) => n.kind), ['missed_call', 'voicemail']);
});

Deno.test('Aufnahme: Speichern scheitert → bleibt bei Twilio, Grund wird angezeigt; Nachholen legt sie ab', async () => {
  const { repo, twilio, ctx, flush } = setup();
  const id = '20000000-0000-4000-8000-000000000012';
  await repo.upsertCall({ id, status: 'completed', direction: 'outbound', started_at: '2026-10-07T10:00:00Z', twilio_call_sid: 'CAp' });
  await handleStatus(ctx, 'recording', q(`callId=${id}&ac=1`), { RecordingStatus: 'in-progress', RecordingSid: 'RE9' });
  twilio.mediaFailures = 1;
  await handleStatus(ctx, 'recording', q(`callId=${id}&ac=1`), {
    RecordingStatus: 'completed',
    RecordingUrl: 'https://api.twilio.com/2010-04-01/Accounts/AC1/Recordings/RE9',
    RecordingSid: 'RE9',
    RecordingDuration: '4',
    RecordingChannels: '2',
  });
  await flush();
  let c = await repo.call(id);
  assertEquals([c?.recording_status, c?.recording_attempts, c?.recording_path], ['failed', 1, null]);
  assert(c?.recording_error?.includes('503'), 'Grund gespeichert');
  assert(!twilio.calls.some((x) => x.method === 'DELETE'), 'bei Twilio nicht gelöscht');

  // Hintergrundaufgabe holt sie neu: Daten kommen von Twilios REST-Schnittstelle
  twilio.recordings = [{ sid: 'RE9', call_sid: 'CAp', status: 'completed', channels: 2, duration: '4', source: 'DialVerb' }];
  assertEquals(await retryRecording(ctx, id), 'ready');
  c = await repo.call(id);
  assertEquals([c?.recording_status, c?.recording_path, c?.recording_attempts, c?.agent_channel, c?.recording_error], [
    'ready',
    `2026/10/${id}-RE9.wav`,
    2,
    1,
    null,
  ]);
  assertEquals(twilio.media.at(-1), 'https://api.twilio.com/2010-04-01/Accounts/AC1/Recordings/RE9.json');
  assert(Math.abs((c?.talk_agent_ms ?? 0) - 2000) < 400, 'unsere Spur richtig zugeordnet');
  assert(twilio.calls.some((x) => x.method === 'DELETE' && x.path === '/Recordings/RE9.json'), 'jetzt bei Twilio gelöscht');
});

Deno.test('Aufnahme nachholen: Meldung „fertig“ kam nie an → Aufnahme über die Leitung gefunden', async () => {
  const { repo, twilio, ctx } = setup();
  const id = '20000000-0000-4000-8000-000000000013';
  // eingehend, Aufnahme lief, Rückmeldungen gingen verloren (keine SID bekannt)
  await repo.upsertCall({ id, status: 'completed', direction: 'inbound', started_at: '2026-10-07T10:00:00Z', twilio_call_sid: 'CAin', recording_status: 'recording', recording_attempts: 0 });
  twilio.recordings = [
    { sid: 'RE2', call_sid: 'CAin', status: 'completed', channels: 2, duration: '4', source: 'DialVerb', date_created: 'Wed, 07 Oct 2026 10:05:00 +0000' },
    { sid: 'RE1', call_sid: 'CAin', status: 'completed', channels: 2, duration: '9', source: 'DialVerb', date_created: 'Wed, 07 Oct 2026 10:00:10 +0000' },
  ];
  assertEquals(await retryRecording(ctx, id), 'ready');
  const c = await repo.call(id);
  // die erste Aufnahme des Gesprächs; eingehend liegt unsere Stimme auf Spur 2
  assertEquals([c?.recording_path, c?.recording_duration, c?.agent_channel, c?.recording_attempts], [`2026/10/${id}-RE1.wav`, 9, 2, 1]);
});

Deno.test('Aufnahme nachholen: alle Aufnahme-Meldungen verloren → SID aus dem Auflegen, Mailbox wird trotzdem zur Aufgabe', async () => {
  const { repo, twilio, ctx, flush } = setup();
  repo.orgSettings.recording_mode = 'auto';
  // ausgehend: nur die Rückmeldung von <Dial> nach dem Auflegen kommt an
  const callId = '20000000-0000-4000-8000-000000000017';
  await handleVoice(ctx, 'start', q(), { From: `client:${BOB}`, To: '+496181123456', CallSid: 'CAo', leadId: LEAD, callId });
  await handleVoice(ctx, 'dial-done', q(`callId=${callId}`), {
    DialCallStatus: 'completed', DialCallSid: 'CAoc', DialCallDuration: '4', RecordingSid: 'RE20', RecordingDuration: '4',
    RecordingUrl: 'https://api.twilio.com/2010-04-01/Accounts/AC1/Recordings/RE20',
  });
  await flush();
  assertEquals([(await repo.call(callId))?.recording_status, (await repo.call(callId))?.recording_sid], ['recording', 'RE20']);
  twilio.recordings = [{ sid: 'RE20', call_sid: 'CAo', status: 'completed', channels: 2, duration: '4', source: 'DialVerb' }];
  assertEquals(await retryRecording(ctx, callId), 'ready');
  assertEquals((await repo.call(callId))?.agent_channel, 1);

  // Mailbox: nur die Rückmeldung von <Record> kommt an
  const xml = await handleVoice(ctx, 'start', q(), { From: '+496181123456', To: '+4969000000', CallSid: 'CAvm2' });
  const call = [...repo.calls.values()].find((c) => c.twilio_call_sid === 'CAvm2')!;
  let next = await handleVoice(ctx, 'route', attrUrl(xml, 'action'), { DialCallStatus: 'no-answer', CallStatus: 'in-progress' });
  next = await handleVoice(ctx, 'route', attrUrl(next, 'action'), { DialCallStatus: 'no-answer', CallStatus: 'in-progress' });
  await handleVoice(ctx, 'vm-done', attrUrl(next, 'action'), { RecordingSid: 'RE21', RecordingDuration: '7', RecordingUrl: 'https://api.twilio.com/x/Recordings/RE21' });
  await flush();
  assertEquals([(await repo.call(call.id))?.recording_status, (await repo.call(call.id))?.is_voicemail], ['recording', true]);
  twilio.recordings.push({ sid: 'RE21', call_sid: 'CAvm2', status: 'completed', channels: 1, duration: '7', source: 'RecordVerb' });
  assertEquals(await retryRecording(ctx, call.id), 'ready');
  const vm = await repo.call(call.id);
  assert(vm?.recording_path?.startsWith('mailbox/'), String(vm?.recording_path));
  assertEquals(repo.tasks.find((t) => t.call_id === call.id)?.type, 'voicemail');
});

Deno.test('Aufnahme nachholen: bei Twilio verschwunden → endgültig fehlgeschlagen; nie entstanden → keine Aufnahme', async () => {
  const { repo, ctx } = setup();
  const gone = '20000000-0000-4000-8000-000000000014';
  await repo.upsertCall({ id: gone, status: 'completed', twilio_call_sid: 'CAg', recording_status: 'failed', recording_sid: 'RE404', recording_attempts: 1 });
  assertEquals(await retryRecording(ctx, gone), 'failed');
  const g = await repo.call(gone);
  assertEquals([g?.recording_status, g?.recording_attempts], ['failed', MAX_RECORDING_ATTEMPTS]);
  assert(g?.recording_error?.includes('nicht mehr vorhanden'), String(g?.recording_error));

  const never = '20000000-0000-4000-8000-000000000015';
  await repo.upsertCall({ id: never, status: 'completed', twilio_call_sid: 'CAn', recording_status: 'recording' });
  assertEquals(await retryRecording(ctx, never), 'none');
  assertEquals((await repo.call(never))?.recording_status, 'none');
});

Deno.test('Aufnahme nachholen: Twilio noch nicht fertig → später wieder, nach dem letzten Versuch fehlgeschlagen', async () => {
  const { repo, twilio, ctx } = setup();
  const id = '20000000-0000-4000-8000-000000000016';
  await repo.upsertCall({ id, status: 'completed', twilio_call_sid: 'CAw', recording_status: 'processing', recording_sid: 'RE5', recording_attempts: 1 });
  twilio.recordings = [{ sid: 'RE5', call_sid: 'CAw', status: 'processing', channels: 2, duration: '-1' }];
  assertEquals(await retryRecording(ctx, id), 'pending');
  assertEquals([(await repo.call(id))?.recording_status, (await repo.call(id))?.recording_attempts], ['processing', 2]);
  await repo.updateCall(id, { recording_attempts: MAX_RECORDING_ATTEMPTS - 1 });
  assertEquals(await retryRecording(ctx, id), 'failed');
  assertEquals((await repo.call(id))?.recording_status, 'failed');
});

// ---------------------------------------------------------------------------
// Steuerung während des Anrufs
// ---------------------------------------------------------------------------
Deno.test('Steuerung: Aufnahme starten (richtige Leitung und Spur), Mailbox-Drop mit Ergebnis', async () => {
  const { repo, twilio, ctx } = setup();
  const id = '20000000-0000-4000-8000-000000000020';
  await repo.upsertCall({ id, user_id: BOB, direction: 'outbound', status: 'in-progress', twilio_call_sid: 'CAp', lead_id: LEAD });
  const bob = caller((await repo.profile(BOB))!);

  await handleControl(ctx, bob, { action: 'record_start', callId: id });
  const rec = twilio.calls.find((c) => c.path === '/Calls/CAp/Recordings.json');
  assertEquals([rec?.params?.RecordingChannels, rec?.params?.RecordingTrack], ['dual', 'both']);
  assertEquals(new URL(String(rec?.params?.RecordingStatusCallback)).searchParams.get('ac'), '1');
  assertEquals([(await repo.call(id))?.recording_status, (await repo.call(id))?.agent_channel], ['recording', 1]);

  await handleControl(ctx, bob, { action: 'record_pause', callId: id });
  assert(twilio.calls.some((c) => c.path === '/Calls/CAp/Recordings/Twilio.CURRENT.json' && c.params?.Status === 'paused'));

  repo.drops = [{ id: '30000000-0000-4000-8000-000000000001', user_id: BOB, shared: false, storage_path: `${BOB}/vm.wav`, name: 'Standard' }];
  await handleControl(ctx, bob, { action: 'voicemail_drop', callId: id, dropId: '30000000-0000-4000-8000-000000000001' });
  const drop = twilio.calls.find((c) => c.path === '/Calls/CAchild.json');
  assert(drop && String(drop.params?.Twiml).includes('<Play>https://storage.example/voicemails/'), 'Kunde hört Nachricht');
  assertEquals((await repo.call(id))?.outcome, 'nicht_erreicht');
});

Deno.test('Steuerung: im Konferenzmodus wird die Leitung des Kunden aufgenommen (wir = Spur 2)', async () => {
  const { repo, twilio, ctx } = setup();
  const id = '20000000-0000-4000-8000-000000000022';
  await repo.upsertCall({ id, user_id: BOB, status: 'in-progress', twilio_call_sid: 'CAagent', twilio_child_sid: 'CAcust', conference_name: `call-${id}` });
  await handleControl(ctx, caller((await repo.profile(BOB))!), { action: 'record_start', callId: id });
  const rec = twilio.calls.find((c) => c.path === '/Calls/CAcust/Recordings.json');
  assert(rec, 'Kundenleitung');
  assertEquals((await repo.call(id))?.agent_channel, 2);
});

Deno.test('Steuerung: direkt weiterleiten (ohne Konferenz) – neuer Anruf für den Kollegen', async () => {
  const { repo, twilio, ctx } = setup();
  const id = '20000000-0000-4000-8000-000000000023';
  await repo.upsertCall({ id, user_id: BOB, direction: 'outbound', status: 'in-progress', twilio_call_sid: 'CAp', lead_id: LEAD, to_number: '+496181123456' });
  const result = await handleControl(ctx, caller((await repo.profile(BOB))!), { action: 'transfer', callId: id, targetUserId: ADA });
  const tr = twilio.calls.filter((c) => c.path === '/Calls/CAchild.json').pop();
  assert(String(tr?.params?.Twiml).includes(`<Identity>${ADA}</Identity>`), 'an Ada');
  assert(String(tr?.params?.Twiml).includes('name="transferFrom" value="Bob"'), 'Ada sieht, von wem');
  const n = await repo.call(String(result.newCallId));
  assertEquals([n?.user_id, n?.parent_call_id], [ADA, id]);
  assertEquals((await repo.call(id))?.transferred_to, ADA);
  await assertRejects(
    () => handleControl(ctx, caller((repo.profiles[1])), { action: 'transfer', callId: id, targetUserId: ADA, mode: 'warm' }),
    'Konferenzmodus',
  );
});

Deno.test('Steuerung: Übergabe mit Rücksprache – Kunde wartet, Kollege kommt dazu, wir gehen raus', async () => {
  const { repo, twilio, ctx } = setup();
  const id = '20000000-0000-4000-8000-000000000024';
  await repo.upsertCall({
    id,
    user_id: BOB,
    direction: 'outbound',
    status: 'in-progress',
    twilio_call_sid: 'CAagent',
    twilio_child_sid: 'CAcust',
    conference_name: `call-${id}`,
    conference_sid: 'CF7',
    from_number: '+4969000000',
    to_number: '+496181123456',
    lead_id: LEAD,
  });
  const bob = caller((await repo.profile(BOB))!);
  const r = await handleControl(ctx, bob, { action: 'transfer', callId: id, targetUserId: ADA, mode: 'warm' });
  assertEquals(r.name, 'Ada');
  const hold = twilio.calls.find((c) => c.path === '/Conferences/CF7/Participants/customer.json');
  assertEquals(hold?.params?.Hold, true);
  const add = twilio.calls.find((c) => c.path === '/Conferences/CF7/Participants.json');
  const to = String(add?.params?.To);
  assert(to.startsWith(`client:${ADA}?`) && to.includes('leadName=L%C3%B6wen-Apotheke') && to.includes('transferFrom=Bob'), to);

  twilio.calls = [];
  await handleControl(ctx, bob, { action: 'transfer_complete', callId: id });
  assertEquals(
    twilio.calls.map((c) => `${c.method} ${c.path.replace('/Conferences/CF7/Participants/', '')} ${JSON.stringify(c.params ?? {})}`),
    [
      'POST transfer.json {"EndConferenceOnExit":true}',
      'POST customer.json {"Hold":false}',
      'POST agent.json {"EndConferenceOnExit":false}',
      'DELETE agent.json {}',
    ],
  );
});

Deno.test('Steuerung: fremder Anruf wird abgelehnt, Abschrift nur mit KI-Recht', async () => {
  const { repo, ctx } = setup();
  const id = '20000000-0000-4000-8000-000000000021';
  await repo.upsertCall({ id, user_id: ADA, twilio_call_sid: 'CAx' });
  const bob = caller((await repo.profile(BOB))!, ['calling']);
  await assertRejects(() => handleControl(ctx, bob, { action: 'record_start', callId: id }), 'nicht dein Anruf');
  await assertRejects(() => handleControl(ctx, bob, { action: 'transcribe', callId: id }), 'KI-Funktionen');
});

Deno.test('Steuerung: Aufnahme erneut holen – nur wer sie hören darf, erst nach dem Auflegen', async () => {
  const { repo, twilio, ctx, flush } = setup();
  const id = '20000000-0000-4000-8000-000000000025';
  await repo.upsertCall({
    id,
    user_id: BOB,
    status: 'completed',
    ended_at: '2026-10-07T10:05:00Z',
    started_at: '2026-10-07T10:00:00Z',
    twilio_call_sid: 'CAr',
    recording_status: 'failed',
    recording_sid: 'RE3',
    recording_attempts: MAX_RECORDING_ATTEMPTS,
    recording_error: 'Speicher nicht erreichbar',
  });
  twilio.recordings = [{ sid: 'RE3', call_sid: 'CAr', status: 'completed', channels: 2, duration: '4' }];
  const carl = caller(member(CARL, 'Carl'), ['calling']);
  await assertRejects(() => handleControl(ctx, carl, { action: 'recording_retry', callId: id }), 'nicht anhören');

  const bob = caller((await repo.profile(BOB))!);
  const r = await handleControl(ctx, bob, { action: 'recording_retry', callId: id });
  assertEquals(r.status, 'processing');
  assertEquals((await repo.call(id))?.recording_status, 'processing');
  await flush();
  const c = await repo.call(id);
  assertEquals([c?.recording_status, c?.recording_path, c?.recording_attempts], ['ready', `2026/10/${id}-RE3.wav`, 1]);

  const live = '20000000-0000-4000-8000-000000000026';
  await repo.upsertCall({ id: live, user_id: BOB, status: 'in-progress', twilio_call_sid: 'CAl', recording_status: 'recording' });
  await assertRejects(() => handleControl(ctx, bob, { action: 'recording_retry', callId: live }), 'läuft noch');
});
