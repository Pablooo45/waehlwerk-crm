import { bytesToBase64 } from '../_shared/crypto.ts';
import type { GEvent, ServiceAccount } from '../_shared/google.ts';
import { assert, assertEquals, FakeRepo, member } from '../_shared/test_utils.ts';
import { handleCalendly } from '../calendly-webhook/logic.ts';
import { syncCalendars } from '../gcal-sync/logic.ts';

const OPENER = '00000000-0000-4000-8000-0000000000aa';
const CLOSER = '00000000-0000-4000-8000-0000000000bb';
const LEAD = '10000000-0000-4000-8000-000000000001';

function person(id: string, email: string, name: string) {
  return member(id, name, { email });
}

function setup() {
  const repo = new FakeRepo();
  repo.profiles = [person(OPENER, 'opener@firma.de', 'Olga Opener'), person(CLOSER, 'closer@firma.de', 'Carl Closer')];
  repo.leads = [{ id: LEAD, name: 'Stern-Apotheke', owner_id: null, status_id: 'status-new', status_kind: 'open' }];
  repo.contacts = [{ id: 'c1', lead_id: LEAD, name: 'Frau Stern', phones: ['+4969123456'], emails: ['stern@apo.de'] }];
  return repo;
}

function invitee(extra: Record<string, unknown> = {}, tracking: Record<string, string> = {}) {
  return {
    event: 'invitee.created',
    payload: {
      uri: 'https://api.calendly.com/scheduled_events/E1/invitees/I1',
      email: 'neu@kunde.de',
      name: 'Max Neu',
      questions_and_answers: [{ question: 'Name Ihrer Apotheke', answer: 'Adler-Apotheke' }],
      tracking,
      scheduled_event: {
        uri: 'https://api.calendly.com/scheduled_events/E1',
        name: 'Erstgespräch',
        start_time: '2026-10-09T08:00:00.000000Z',
        end_time: '2026-10-09T08:30:00.000000Z',
        location: { type: 'google_conference', join_url: 'https://meet.google.com/abc' },
        event_memberships: [{ user_email: 'closer@firma.de', user_name: 'Carl Closer' }],
      },
      ...extra,
    },
  };
}

Deno.test('Calendly über CRM-Link: Lead per ID, Opener per utm_content, Status "Termin gelegt"', async () => {
  const repo = setup();
  const r = await handleCalendly(repo, invitee({ email: 'stern@apo.de' }, { utm_campaign: LEAD, utm_content: OPENER }));
  assertEquals(r.leadId, LEAD);
  assertEquals(r.setBy, OPENER);
  const m = repo.meetings[0];
  assertEquals(m.host_user_id, CLOSER, 'Closer als Gastgeber');
  assertEquals(m.contact_id, 'c1');
  assertEquals(m.join_url, 'https://meet.google.com/abc');
  assertEquals(repo.leads[0].status_id, 'status-meeting');
});

Deno.test('Calendly ohne Treffer (z. B. Landingpage) → neuer Lead mit Kontakt', async () => {
  const repo = setup();
  const r = await handleCalendly(repo, invitee());
  assert(r.createdLead, 'Lead angelegt');
  const lead = repo.leads.find((l) => l.id === r.leadId)!;
  assertEquals(lead.name, 'Adler-Apotheke');
  assertEquals(lead.source, 'Calendly');
  assertEquals(repo.contacts.at(-1)?.emails, ['neu@kunde.de']);
  assertEquals(repo.meetings[0].set_by, null);
});

Deno.test('Calendly per Telefonnummer zuordnen', async () => {
  const repo = setup();
  const r = await handleCalendly(repo, invitee({ email: 'privat@gmx.de', text_reminder_number: '+49 69 123456' }));
  assertEquals(r.leadId, LEAD);
  assertEquals(r.matchedBy, 'phone');
});

Deno.test('Calendly: Absage und Verschiebung behalten den Opener', async () => {
  const repo = setup();
  await handleCalendly(repo, invitee({ email: 'stern@apo.de' }, { utm_campaign: LEAD, utm_content: OPENER }));
  const cancel = invitee({ rescheduled: true });
  cancel.event = 'invitee.canceled';
  await handleCalendly(repo, cancel);
  assertEquals(repo.meetings[0].status, 'rescheduled');
  const moved = invitee({
    uri: 'https://api.calendly.com/scheduled_events/E2/invitees/I2',
    email: 'stern@apo.de',
    old_invitee: 'https://api.calendly.com/scheduled_events/E1/invitees/I1',
  });
  const r = await handleCalendly(repo, moved);
  assertEquals(r.setBy, OPENER, 'Opener bleibt beim neuen Termin');
  assertEquals(repo.meetings.length, 2);
});

// --- Google Kalender (Google-API wird simuliert) ---

async function fakeServiceAccount(): Promise<ServiceAccount> {
  const pair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  );
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  const pem = `-----BEGIN PRIVATE KEY-----\n${bytesToBase64(pkcs8).replace(/(.{64})/g, '$1\n')}\n-----END PRIVATE KEY-----\n`;
  return { client_email: 'crm@projekt.iam.gserviceaccount.com', private_key: pem };
}

Deno.test('Google Kalender: Termine übernehmen, Calendly-Doppelte verknüpfen, Absagen erkennen', async () => {
  const repo = setup();
  // Calendly-Termin existiert schon
  await handleCalendly(repo, invitee({ email: 'stern@apo.de' }, { utm_campaign: LEAD, utm_content: OPENER }));
  const sa = await fakeServiceAccount();
  const events: GEvent[] = [
    {
      id: 'ev1',
      updated: '2026-10-07T10:00:00Z',
      summary: 'Erstgespräch Stern',
      description: 'Event Name: Erstgespräch\nhttps://calendly.com/cancellations/xyz',
      start: { dateTime: '2026-10-09T10:00:00+02:00' },
      end: { dateTime: '2026-10-09T10:30:00+02:00' },
      attendees: [{ email: 'stern@apo.de' }, { email: 'closer@firma.de', self: true }],
      creator: { email: 'closer@firma.de' },
    },
    {
      id: 'ev2',
      updated: '2026-10-07T10:00:00Z',
      summary: 'Closing Löwen',
      description: 'Rückruf 069 123456',
      start: { dateTime: '2026-10-10T14:00:00+02:00' },
      end: { dateTime: '2026-10-10T15:00:00+02:00' },
      creator: { email: 'closer@firma.de' },
      extendedProperties: { private: { crmSetBy: OPENER } },
    },
    { id: 'ev3', summary: 'Urlaub', start: { date: '2026-10-12' }, end: { date: '2026-10-13' } },
    { id: 'ev4', status: 'cancelled', start: { dateTime: '2026-10-11T09:00:00+02:00' } },
  ];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.startsWith('https://oauth2.googleapis.com/token')) {
      return new Response(JSON.stringify({ access_token: 'ya29.test', expires_in: 3600 }), { status: 200 });
    }
    if (url.includes('/calendars/team%40group.calendar.google.com/events')) {
      return new Response(JSON.stringify({ items: events }), { status: 200 });
    }
    return new Response('{}', { status: 404 });
  }) as typeof fetch;
  try {
    const r = await syncCalendars(repo, sa, [{ id: 'team@group.calendar.google.com' }], new Date('2026-10-07T12:00:00Z'));
    assertEquals(r.errors, []);
    assertEquals(r.linkedToCalendly, 1, 'Calendly-Termin verknüpft statt doppelt');
    assertEquals(r.upserted, 1);
    const g = repo.meetings.find((m) => m.source === 'google')!;
    assertEquals(g.lead_id, LEAD, 'per Telefonnummer zugeordnet');
    assertEquals(g.set_by, OPENER, 'Opener aus CRM-Eintrag');
    assertEquals(g.host_user_id, CLOSER);
    assertEquals(repo.meetings.find((m) => m.source === 'calendly')?.google_event_id, 'ev1');

    // zweiter Lauf: nichts geändert
    const r2 = await syncCalendars(repo, sa, [{ id: 'team@group.calendar.google.com' }], new Date('2026-10-07T12:00:00Z'));
    assertEquals(r2.unchanged, 1);
    assertEquals(r2.upserted, 0);

    // Termin wird abgesagt
    events[1] = { ...events[1], status: 'cancelled', updated: '2026-10-07T11:00:00Z' };
    await syncCalendars(repo, sa, [{ id: 'team@group.calendar.google.com' }], new Date('2026-10-07T12:00:00Z'));
    assertEquals(repo.meetings.find((m) => m.source === 'google')?.status, 'canceled');
  } finally {
    globalThis.fetch = realFetch;
  }
});
