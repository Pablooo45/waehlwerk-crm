// Google Kalender ↔ CRM: Termine abholen, Leads zuordnen, neue Termine eintragen.

import type { MeetingRow, Profile, Repo } from '../_shared/db.ts';
import { gcal, type GEvent, googleAccessToken, listEvents, type ServiceAccount } from '../_shared/google.ts';
import { HttpError, isUuid } from '../_shared/http.ts';
import { extractEmails, extractLeadId, extractPhones, matchLead } from '../_shared/matching.ts';

const DAY = 86_400_000;

export interface SyncResult {
  calendars: number;
  upserted: number;
  unchanged: number;
  linkedToCalendly: number;
  errors: string[];
}

function joinUrl(ev: GEvent): string | null {
  if (ev.hangoutLink) return ev.hangoutLink;
  const video = ev.conferenceData?.entryPoints?.find((e) => e.entryPointType === 'video');
  if (video?.uri) return video.uri;
  const m = `${ev.location ?? ''} ${ev.description ?? ''}`.match(/https:\/\/[^\s<>"]*(zoom\.us|teams\.microsoft|meet\.google|whereby|webex)[^\s<>"]*/i);
  return m ? m[0] : null;
}

export async function syncCalendars(
  repo: Repo,
  sa: ServiceAccount,
  calendars: { id: string; label?: string }[],
  now = new Date(),
): Promise<SyncResult> {
  const result: SyncResult = { calendars: calendars.length, upserted: 0, unchanged: 0, linkedToCalendly: 0, errors: [] };
  if (!calendars.length) return result;
  const token = await googleAccessToken(sa);
  const timeMin = new Date(now.getTime() - 14 * DAY);
  const timeMax = new Date(now.getTime() + 120 * DAY);

  for (const cal of calendars) {
    try {
      const [events, existing] = await Promise.all([
        listEvents(token, cal.id, timeMin, timeMax),
        repo.googleMeetings(cal.id),
      ]);
      for (const ev of events) {
        const start = ev.start?.dateTime;
        if (!start) continue; // ganztägige Einträge (Urlaub etc.) überspringen
        const externalId = `${cal.id}:${ev.id}`;
        const old = existing.get(externalId);
        const version = ev.updated ?? '';
        if (old && (old.raw as { updated?: string } | null)?.updated === version && version) {
          result.unchanged++;
          continue;
        }
        const cancelled = ev.status === 'cancelled';
        if (!old && cancelled) continue;

        const text = [ev.summary, ev.description, ev.location].filter(Boolean).join('\n');
        const attendeeEmails = (ev.attendees ?? [])
          .filter((a) => !a.self && !a.organizer && a.email && !a.email.endsWith('calendar.google.com'))
          .map((a) => a.email!.toLowerCase());

        // Von Calendly eingetragene Termine nicht doppelt anlegen
        if (!old && /calendly\.com/i.test(text)) {
          const calendlyMeeting = await repo.findCalendlyMeetingAt(start, attendeeEmails);
          if (calendlyMeeting?.id) {
            await repo.updateMeeting(calendlyMeeting.id, { google_event_id: ev.id, calendar_id: cal.id });
            result.linkedToCalendly++;
            continue;
          }
        }

        const priv = ev.extendedProperties?.private ?? {};
        const match = old?.lead_id
          ? { lead_id: old.lead_id, contact_id: old.contact_id ?? null }
          : await matchLead(repo, {
            leadId: isUuid(priv.crmLeadId) ? priv.crmLeadId : extractLeadId(text),
            emails: [...attendeeEmails, ...extractEmails([ev.description])],
            phones: extractPhones([ev.description, ev.location, ev.summary]),
          });

        let host: Profile | null = null;
        if (isUuid(priv.crmHost)) host = await repo.profile(priv.crmHost);
        if (!host && ev.creator?.email) host = await repo.profileByEmail(ev.creator.email);
        if (!host && ev.organizer?.email && !ev.organizer.email.endsWith('calendar.google.com')) {
          host = await repo.profileByEmail(ev.organizer.email);
        }

        const firstGuest = (ev.attendees ?? []).find((a) => !a.self && !a.organizer);
        const keepStatus = old && ['completed', 'no_show'].includes(old.status ?? '');
        const row: MeetingRow = {
          source: 'google',
          external_id: externalId,
          calendar_id: cal.id,
          google_event_id: ev.id,
          lead_id: match?.lead_id ?? null,
          contact_id: match?.contact_id ?? null,
          title: ev.summary || '(ohne Titel)',
          description: ev.description ?? null,
          location: ev.location ?? null,
          join_url: joinUrl(ev),
          starts_at: start,
          ends_at: ev.end?.dateTime ?? null,
          host_user_id: host?.id ?? old?.host_user_id ?? null,
          host_email: host?.email ?? ev.creator?.email ?? null,
          host_name: host?.full_name ?? ev.creator?.displayName ?? null,
          set_by: isUuid(priv.crmSetBy) ? priv.crmSetBy : (old?.set_by ?? null),
          invitee_name: firstGuest?.displayName ?? null,
          invitee_email: attendeeEmails[0] ?? null,
          status: cancelled ? 'canceled' : keepStatus ? old!.status : 'scheduled',
          raw: { updated: version, htmlLink: ev.htmlLink ?? null },
        };
        await repo.upsertMeeting(row);
        result.upserted++;
      }
    } catch (e) {
      result.errors.push(`${cal.label || cal.id}: ${e instanceof Error ? e.message : e}`);
    }
  }
  return result;
}

export interface CreateEventInput {
  leadId: string;
  calendarId?: string;
  title: string;
  start: string; // ISO
  end: string; // ISO
  description?: string;
  hostUserId?: string | null;
  contactId?: string | null;
  location?: string | null;
}

export async function createCalendarEvent(
  repo: Repo,
  sa: ServiceAccount,
  user: Profile,
  input: CreateEventInput,
  appUrl: string | null,
): Promise<{ meetingId: string; htmlLink: string | null }> {
  const org = await repo.org();
  const calId = input.calendarId || org.gcal_calendars?.[0]?.id;
  if (!calId) throw new HttpError(400, 'Es ist noch kein Google Kalender verbunden.');
  if (!isUuid(input.leadId)) throw new HttpError(400, 'Lead fehlt.');
  const lead = await repo.lead(input.leadId);
  if (!lead) throw new HttpError(404, 'Lead nicht gefunden.');
  const start = new Date(input.start);
  const end = new Date(input.end);
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || end <= start) {
    throw new HttpError(400, 'Bitte Start und Ende prüfen.');
  }
  const host = input.hostUserId && isUuid(input.hostUserId) ? await repo.profile(input.hostUserId) : null;
  const lines = [
    input.description?.trim(),
    '',
    `Lead: ${lead.name}`,
    appUrl ? `Im CRM: ${appUrl.replace(/\/$/, '')}/#/leads/${lead.id}` : `CRM-Lead-ID: ${lead.id}`,
    `Gelegt von: ${user.full_name || user.email}`,
    host ? `Termin mit: ${host.full_name || host.email}` : null,
  ].filter((l) => l !== null && l !== undefined);

  const token = await googleAccessToken(sa);
  const ev = await gcal<GEvent>(token, 'POST', `/calendars/${encodeURIComponent(calId)}/events`, {
    summary: input.title,
    description: lines.join('\n'),
    location: input.location || undefined,
    start: { dateTime: start.toISOString(), timeZone: 'Europe/Berlin' },
    end: { dateTime: end.toISOString(), timeZone: 'Europe/Berlin' },
    extendedProperties: {
      private: { crmLeadId: lead.id, crmSetBy: user.id, crmHost: host?.id ?? '' },
    },
  });
  const meetingId = await repo.upsertMeeting({
    source: 'google',
    external_id: `${calId}:${ev.id}`,
    calendar_id: calId,
    google_event_id: ev.id,
    lead_id: lead.id,
    contact_id: input.contactId && isUuid(input.contactId) ? input.contactId : null,
    title: input.title,
    description: lines.join('\n'),
    location: input.location ?? null,
    starts_at: start.toISOString(),
    ends_at: end.toISOString(),
    host_user_id: host?.id ?? null,
    host_email: host?.email ?? null,
    host_name: host?.full_name ?? null,
    set_by: user.id,
    status: 'scheduled',
    raw: { updated: ev.updated ?? '', htmlLink: ev.htmlLink ?? null },
  });
  return { meetingId, htmlLink: ev.htmlLink ?? null };
}
