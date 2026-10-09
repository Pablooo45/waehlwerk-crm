// Calendly meldet neue / abgesagte Termine → Termin im CRM anlegen und dem Lead zuordnen.
// Opener-Zuordnung: Bucht ein Opener über den "Termin buchen"-Knopf im CRM, hängt das CRM
// utm_campaign=<Lead-ID> und utm_content=<Benutzer-ID> an den Calendly-Link.

import type { Repo } from '../_shared/db.ts';
import type { CalendlyInvitee } from '../_shared/calendly.ts';
import { isUuid } from '../_shared/http.ts';
import { companyFromAnswers, extractPhones, matchLead } from '../_shared/matching.ts';

export interface CalendlyEvent {
  event: string;
  payload: CalendlyInvitee & { old_invitee?: string | null };
}

export async function handleCalendly(repo: Repo, body: CalendlyEvent): Promise<Record<string, unknown>> {
  const inv = body?.payload;
  const ev = inv?.scheduled_event;
  if (!inv?.uri || !ev?.start_time) return { ignored: 'Kein Termin im Ereignis' };

  const existing = await repo.meetingByExternal('calendly', inv.uri);

  if (body.event === 'invitee.canceled') {
    const status = inv.rescheduled ? 'rescheduled' : 'canceled';
    if (existing?.id) {
      await repo.updateMeeting(existing.id, { status });
      return { meetingId: existing.id, status };
    }
  } else if (body.event !== 'invitee.created') {
    return { ignored: body.event };
  }

  const org = await repo.org();
  const tracking = inv.tracking ?? {};
  const qa = inv.questions_and_answers ?? [];

  let setBy: string | null = null;
  if (isUuid(tracking.utm_content)) {
    const p = await repo.profile(tracking.utm_content);
    if (p) setBy = p.id;
  }
  // Verschobener Termin: Opener vom alten Termin übernehmen
  if (!setBy && inv.old_invitee) {
    const old = await repo.meetingByExternal('calendly', inv.old_invitee);
    setBy = old?.set_by ?? null;
  }
  if (!setBy && existing?.set_by) setBy = existing.set_by;

  const member = ev.event_memberships?.[0];
  const hostEmail = member?.user_email?.toLowerCase() ?? null;
  const host = hostEmail ? await repo.profileByEmail(hostEmail) : null;

  const phones = extractPhones([inv.text_reminder_number, ev.location?.location, ...qa.map((q) => q.answer)]);
  const company = companyFromAnswers(qa);
  const emails = inv.email ? [inv.email.toLowerCase()] : [];

  let match = existing?.lead_id
    ? { lead_id: existing.lead_id, contact_id: existing.contact_id ?? null, how: 'id' as const }
    : await matchLead(repo, { leadId: tracking.utm_campaign, emails, phones, companyName: company });

  let createdLead = false;
  if (!match && org.calendly_create_leads && body.event === 'invitee.created') {
    const leadId = await repo.createLead({
      name: company || inv.name || inv.email || 'Calendly-Buchung',
      source: 'Calendly',
      status_id: org.meeting_status_id ?? null,
      created_by: null,
    });
    const contactId = await repo.addContact({
      lead_id: leadId,
      name: inv.name ?? '',
      emails: emails.map((email) => ({ type: 'office', email })),
      phones: phones.map((number) => ({ type: 'office', number })),
    });
    match = { lead_id: leadId, contact_id: contactId, how: 'id' };
    createdLead = true;
  }

  const description = qa.length
    ? qa.map((q) => `${q.question}: ${q.answer}`).join('\n')
    : null;

  const meetingId = await repo.upsertMeeting({
    source: 'calendly',
    external_id: inv.uri,
    lead_id: match?.lead_id ?? null,
    contact_id: match?.contact_id ?? null,
    title: ev.name || 'Termin',
    description,
    location: ev.location?.location ?? null,
    join_url: ev.location?.join_url ?? null,
    starts_at: ev.start_time,
    ends_at: ev.end_time ?? null,
    host_user_id: host?.id ?? null,
    host_email: hostEmail,
    host_name: member?.user_name ?? null,
    set_by: setBy,
    invitee_name: inv.name ?? null,
    invitee_email: emails[0] ?? null,
    invitee_phone: phones[0] ?? null,
    status: body.event === 'invitee.canceled' ? (inv.rescheduled ? 'rescheduled' : 'canceled') : 'scheduled',
    raw: { event: body.event, tracking, old_invitee: inv.old_invitee ?? null, scheduled_event: ev.uri ?? null },
  });

  if (body.event === 'invitee.created' && match?.lead_id && !createdLead && org.meeting_status_id) {
    const lead = await repo.lead(match.lead_id);
    if (lead && lead.status_id !== org.meeting_status_id && lead.status_kind !== 'won') {
      await repo.updateLead(match.lead_id, { status_id: org.meeting_status_id });
    }
  }

  return { meetingId, leadId: match?.lead_id ?? null, matchedBy: match?.how ?? null, createdLead, setBy };
}
