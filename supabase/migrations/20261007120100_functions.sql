-- =====================================================================
--  Wählwerk CRM – Datenbank, Teil 2: Funktionen
--  Sichtbarkeit, Telefonie, Sammelaktionen, Zusammenführen, Berichte,
--  Workflows und Zeitpläne.
-- =====================================================================

-- ---------------------------------------------------------------------
--  Sichtbarkeit
-- ---------------------------------------------------------------------
create or replace function public.can_see_lead(p_lead uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select case public.lead_visibility()
    when 'none' then false
    when 'all' then exists (select 1 from public.leads where id = p_lead)
    else exists (
      select 1 from public.leads l
       where l.id = p_lead
         and (l.owner_id = auth.uid() or l.opener_id = auth.uid()
              or (l.owner_id is null and public.lead_visibility() = 'own_and_unassigned')))
  end
$$;

-- Wer darf eine Aufnahme (und Abschrift) hören bzw. lesen?
--  • die Person, die telefoniert hat
--  • mit Recht „Alle Aufnahmen anhören“: alle Anrufe zu sichtbaren Leads
--  • Mailbox-Nachrichten: alle, die den Lead sehen
create or replace function public.can_listen_call(p_call uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_member() and exists (
    select 1 from public.calls c
     where c.id = p_call
       and (c.user_id = auth.uid()
            or ((public.has_perm('recordings_listen_all') or c.is_voicemail)
                and (case when c.lead_id is null then public.lead_visibility() = 'all'
                          else public.can_see_lead(c.lead_id) end))))
$$;

-- Dateiname der Aufnahme enthält die Anruf-ID: 2026/10/<call-id>-<sid>.wav
create or replace function public.can_read_recording(p_path text)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(public.can_listen_call(
    substring(p_path from '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-[^/]*$')::uuid), false)
$$;

-- ---------------------------------------------------------------------
--  Telefonie
-- ---------------------------------------------------------------------
-- Anrufstatus von Twilio übernehmen – nur vorwärts (Rückmeldungen kommen manchmal
-- in falscher Reihenfolge an). Wird nur von den Server-Funktionen aufgerufen.
create or replace function public.call_status_advance(
  p_call      uuid,
  p_status    text,
  p_child_sid text default null,
  p_duration  int default null,
  p_user      uuid default null
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_old  text;
  v_rank int;
  v_new  int;
begin
  select status into v_old from public.calls where id = p_call for update;
  if not found then return; end if;
  v_rank := case v_old when 'initiated' then 0 when 'queued' then 0 when 'ringing' then 1
                       when 'in-progress' then 2 else 3 end;
  v_new  := case p_status when 'initiated' then 0 when 'queued' then 0 when 'ringing' then 1
                          when 'in-progress' then 2 when 'answered' then 2 else 3 end;
  update public.calls set
    status           = case when v_new > v_rank then
                         case when p_status = 'answered' then 'in-progress' else p_status end
                       else status end,
    twilio_child_sid = coalesce(twilio_child_sid, p_child_sid),
    answered_at      = case when v_new = 2 and answered_at is null then now() else answered_at end,
    ended_at         = case when v_new = 3 and ended_at is null then now() else ended_at end,
    duration         = greatest(duration, coalesce(p_duration, 0)),
    user_id          = coalesce(p_user, user_id)
  where id = p_call;
end $$;

revoke all on function public.call_status_advance(uuid, text, text, int, uuid) from public, anon, authenticated;
grant execute on function public.call_status_advance(uuid, text, text, int, uuid) to service_role;

-- Power Dialer: Lead kurz für mich reservieren (kein Doppelanruf im Team)
create or replace function public.dialer_claim(p_lead uuid, p_seconds int default 300)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_ok boolean;
begin
  if not public.has_perm('calling') then
    raise exception 'Keine Berechtigung zum Telefonieren.';
  end if;
  if not public.can_see_lead(p_lead) then
    return false;
  end if;
  update public.leads
     set dialer_lock_user = auth.uid(),
         dialer_lock_until = now() + make_interval(secs => greatest(30, least(p_seconds, 1800)))
   where id = p_lead
     and not do_not_call
     and (dialer_lock_until is null or dialer_lock_until < now() or dialer_lock_user = auth.uid())
  returning true into v_ok;
  return coalesce(v_ok, false);
end $$;

create or replace function public.dialer_release(p_lead uuid)
returns void language sql security definer set search_path = '' as $$
  update public.leads set dialer_lock_user = null, dialer_lock_until = null
   where id = p_lead and dialer_lock_user = auth.uid()
$$;

-- Laufende Gespräche im Team (für Mithören/Einflüstern/Aufschalten)
create or replace function public.live_calls()
returns table (
  call_id uuid, user_id uuid, lead_id uuid, lead_name text, direction text, status text,
  started_at timestamptz, answered_at timestamptz, to_number text, from_number text, conference boolean
) language sql stable security definer set search_path = '' as $$
  select c.id, c.user_id, c.lead_id, l.name, c.direction, c.status, c.started_at, c.answered_at,
         c.to_number, c.from_number, c.conference_name is not null
    from public.calls c
    left join public.leads l on l.id = c.lead_id
   where c.ended_at is null
     and c.started_at > now() - interval '6 hours'
     and c.status in ('ringing', 'in-progress')
     and public.is_member()
     and (c.user_id = auth.uid() or public.has_perm('call_coach_listen') or public.has_perm('call_coach_barge'))
   order by c.started_at
$$;

-- ---------------------------------------------------------------------
--  Inbox
-- ---------------------------------------------------------------------
create or replace function public.inbox_counts(p_user uuid default null)
returns table (tasks_due bigint, notifications_new bigint)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_user uuid := coalesce(p_user, auth.uid());
begin
  if not public.is_member() then
    raise exception 'Keine Berechtigung.';
  end if;
  if v_user <> auth.uid() and not public.has_perm('view_others_inbox') then
    raise exception 'Keine Berechtigung für die Inbox anderer.';
  end if;
  return query
  select
    (select count(*) from public.tasks t
      where not t.done and t.assigned_to = v_user and (t.due_at is null or t.due_at <= now())),
    (select count(*) from public.notifications n
      where n.user_id = v_user and n.done_at is null and n.read_at is null
        and (n.snoozed_until is null or n.snoozed_until <= now()));
end $$;

-- ---------------------------------------------------------------------
--  Sammelaktionen (laufen mit den Rechten der aufrufenden Person,
--  d. h. Sichtbarkeit und geschützte Felder gelten automatisch)
-- ---------------------------------------------------------------------
create or replace function public.bulk_update_leads(p_ids uuid[], p_patch jsonb)
returns int language plpgsql set search_path = '' as $$
declare
  n int;
  k text;
begin
  if not public.has_perm('bulk_edit') then
    raise exception 'Keine Berechtigung für Sammelbearbeitung.';
  end if;
  if coalesce(array_length(p_ids, 1), 0) > 10000 then
    raise exception 'Höchstens 10.000 Leads auf einmal.';
  end if;
  for k in select jsonb_object_keys(p_patch) loop
    if k not in ('status_id', 'owner_id', 'source', 'address_state', 'do_not_call', 'custom') then
      raise exception 'Feld „%“ kann nicht gesammelt geändert werden.', k;
    end if;
  end loop;
  if p_patch ? 'custom' and jsonb_typeof(p_patch -> 'custom') <> 'object' then
    raise exception 'Ungültige Feldwerte.';
  end if;
  update public.leads l set
    status_id     = case when p_patch ? 'status_id' then (p_patch ->> 'status_id')::uuid else l.status_id end,
    owner_id      = case when p_patch ? 'owner_id' then (p_patch ->> 'owner_id')::uuid else l.owner_id end,
    source        = case when p_patch ? 'source' then nullif(p_patch ->> 'source', '') else l.source end,
    address_state = case when p_patch ? 'address_state' then nullif(p_patch ->> 'address_state', '') else l.address_state end,
    do_not_call   = case when p_patch ? 'do_not_call' then coalesce((p_patch ->> 'do_not_call')::boolean, false) else l.do_not_call end,
    custom        = case when p_patch ? 'custom' then jsonb_strip_nulls(l.custom || (p_patch -> 'custom')) else l.custom end
  where l.id = any (p_ids);
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.bulk_delete_leads(p_ids uuid[])
returns int language plpgsql set search_path = '' as $$
declare
  n int;
begin
  if not (public.has_perm('bulk_delete') and public.has_perm('delete_leads')) then
    raise exception 'Keine Berechtigung zum gesammelten Löschen.';
  end if;
  delete from public.leads where id = any (p_ids);
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------------------------------------------------------------------
--  Dubletten finden und zusammenführen
-- ---------------------------------------------------------------------
create table public.duplicate_dismissals (
  lead_a     uuid not null references public.leads (id) on delete cascade,
  lead_b     uuid not null references public.leads (id) on delete cascade,
  user_id    uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (lead_a, lead_b),
  check (lead_a < lead_b)
);

create or replace function public.find_duplicate_leads(p_lead uuid default null, p_limit int default 200)
returns table (lead_a uuid, lead_b uuid, reasons text)
language sql stable set search_path = '' as $$
  with
  ph as (
    select distinct c.lead_id, p ->> 'number' as v
      from public.contacts c
      cross join lateral jsonb_array_elements(c.phones) p
     where coalesce(p ->> 'number', '') like '+%'),
  em as (
    select distinct c.lead_id, lower(e ->> 'email') as v
      from public.contacts c
      cross join lateral jsonb_array_elements(c.emails) e
     where coalesce(e ->> 'email', '') like '%@%'),
  nm as (
    select l.id as lead_id,
           regexp_replace(lower(l.name), '[^a-z0-9äöüß]', '', 'g') || '|' || l.address_zip as v
      from public.leads l
     where coalesce(l.address_zip, '') <> ''),
  pairs as (
    select a.lead_id as x, b.lead_id as y, 'gleiche Telefonnummer' as reason
      from ph a join ph b on a.v = b.v and a.lead_id < b.lead_id
    union all
    select a.lead_id, b.lead_id, 'gleiche E-Mail-Adresse'
      from em a join em b on a.v = b.v and a.lead_id < b.lead_id
    union all
    select a.lead_id, b.lead_id, 'gleicher Name und PLZ'
      from nm a join nm b on a.v = b.v and a.lead_id < b.lead_id)
  select p.x, p.y, string_agg(distinct p.reason, ', ' order by p.reason)
    from pairs p
   where (p_lead is null or p_lead in (p.x, p.y))
     and not exists (select 1 from public.duplicate_dismissals d where d.lead_a = p.x and d.lead_b = p.y)
   group by p.x, p.y
   order by p.x, p.y
   limit greatest(1, least(coalesce(p_limit, 200), 2000))
$$;

create or replace function public.merge_leads(p_keep uuid, p_merge uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  k public.leads;
  m public.leads;
  v_custom jsonb;
begin
  if not public.has_perm('merge_leads') then
    raise exception 'Keine Berechtigung zum Zusammenführen.';
  end if;
  if p_keep = p_merge then
    raise exception 'Bitte zwei verschiedene Leads wählen.';
  end if;
  if not (public.can_see_lead(p_keep) and public.can_see_lead(p_merge)) then
    raise exception 'Lead nicht gefunden.';
  end if;
  select * into k from public.leads where id = p_keep for update;
  select * into m from public.leads where id = p_merge for update;

  -- Laufende Workflows: doppelte beenden, Rest übernehmen
  update public.workflow_runs r set status = 'canceled', ended_at = now(), end_reason = 'Lead zusammengeführt'
   where r.lead_id = p_merge and r.status in ('active', 'paused')
     and exists (select 1 from public.workflow_runs x
                  where x.lead_id = p_keep and x.workflow_id = r.workflow_id and x.status in ('active', 'paused'));

  update public.contacts          set lead_id = p_keep where lead_id = p_merge;
  update public.calls             set lead_id = p_keep where lead_id = p_merge;
  update public.notes             set lead_id = p_keep where lead_id = p_merge;
  update public.emails            set lead_id = p_keep where lead_id = p_merge;
  update public.sms_messages      set lead_id = p_keep where lead_id = p_merge;
  update public.tasks             set lead_id = p_keep where lead_id = p_merge;
  update public.meetings          set lead_id = p_keep where lead_id = p_merge;
  update public.opportunities     set lead_id = p_keep where lead_id = p_merge;
  update public.lead_events       set lead_id = p_keep where lead_id = p_merge;
  update public.custom_activities set lead_id = p_keep where lead_id = p_merge;
  update public.comments          set lead_id = p_keep where lead_id = p_merge;
  update public.notifications     set lead_id = p_keep where lead_id = p_merge;
  update public.workflow_runs     set lead_id = p_keep where lead_id = p_merge;

  -- Felder: Werte des behaltenen Leads gewinnen, leere werden aufgefüllt
  select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb) into v_custom
    from jsonb_each(k.custom) e
   where e.value not in ('null'::jsonb, '""'::jsonb, '[]'::jsonb);

  update public.leads set
    url             = coalesce(nullif(k.url, ''), m.url),
    description     = nullif(concat_ws(E'\n\n', nullif(k.description, ''), nullif(m.description, '')), ''),
    address_street  = coalesce(nullif(k.address_street, ''), m.address_street),
    address_zip     = coalesce(nullif(k.address_zip, ''), m.address_zip),
    address_city    = coalesce(nullif(k.address_city, ''), m.address_city),
    address_state   = coalesce(nullif(k.address_state, ''), m.address_state),
    address_country = coalesce(nullif(k.address_country, ''), m.address_country),
    source          = coalesce(nullif(k.source, ''), m.source),
    status_id       = coalesce(k.status_id, m.status_id),
    owner_id        = coalesce(k.owner_id, m.owner_id),
    opener_id       = coalesce(k.opener_id, m.opener_id),
    do_not_call     = k.do_not_call or m.do_not_call,
    custom          = m.custom || v_custom,
    created_at      = least(k.created_at, m.created_at),
    last_activity_at = greatest(k.last_activity_at, m.last_activity_at),
    search_text     = ''
  where id = p_keep;

  insert into public.lead_events (lead_id, user_id, type, data)
  values (p_keep, auth.uid(), 'merged', jsonb_build_object('id', m.id, 'name', m.name));

  delete from public.leads where id = p_merge;

  perform public.refresh_lead_call_stats(p_keep);
  perform public.refresh_lead_next_task(p_keep);
  perform public.refresh_lead_next_meeting(p_keep);
end $$;

-- ---------------------------------------------------------------------
--  Berichte
--  Wer das Recht „Team-Berichte sehen“ hat, sieht alle Zahlen,
--  alle anderen nur die eigenen.
-- ---------------------------------------------------------------------
create or replace function public.report_scope(p_users uuid[])
returns uuid[] language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_member() then
    raise exception 'Keine Berechtigung.';
  end if;
  if public.has_perm('view_team_reports') then
    return p_users;              -- null = alle
  end if;
  return array[auth.uid()];
end $$;

create or replace function public.report_activity(p_from timestamptz, p_to timestamptz, p_users uuid[] default null)
returns table (
  user_id          uuid,
  dials            bigint,
  reached          bigint,
  meetings_logged  bigint,
  talk_seconds     bigint,
  inbound          bigint,
  meetings_booked  bigint,
  meetings_held    bigint,
  notes            bigint,
  emails           bigint,
  sms              bigint,
  forms            bigint,
  tasks_done       bigint,
  opps_created     bigint,
  deals_won        bigint,
  won_value        numeric,
  opened_won       bigint
) language plpgsql stable security definer set search_path = '' as $$
declare
  v_users uuid[] := public.report_scope(p_users);
begin
  return query
  with
  c as (
    select c.user_id,
           count(*) filter (where c.direction = 'outbound')                 as dials,
           count(*) filter (where coalesce(o.counts_as_connected, false))   as reached,
           count(*) filter (where coalesce(o.is_meeting, false))            as meetings_logged,
           coalesce(sum(c.duration), 0)::bigint                             as talk_seconds,
           count(*) filter (where c.direction = 'inbound')                  as inbound
      from public.calls c
      left join public.call_outcomes o on o.key = c.outcome
     where c.started_at >= p_from and c.started_at < p_to and c.user_id is not null
     group by c.user_id),
  mb as (
    select m.set_by as user_id, count(*) as cnt
      from public.meetings m
     where m.created_at >= p_from and m.created_at < p_to and m.set_by is not null and m.status <> 'canceled'
     group by m.set_by),
  mh as (
    select m.set_by as user_id, count(*) as cnt
      from public.meetings m
     where m.starts_at >= p_from and m.starts_at < p_to and m.set_by is not null and m.status = 'completed'
     group by m.set_by),
  n  as (select x.user_id, count(*) as cnt from public.notes x
          where x.created_at >= p_from and x.created_at < p_to group by x.user_id),
  e  as (select x.user_id, count(*) as cnt from public.emails x
          where x.created_at >= p_from and x.created_at < p_to and x.direction = 'outbound'
            and x.status in ('logged', 'sent') group by x.user_id),
  s  as (select x.user_id, count(*) as cnt from public.sms_messages x
          where x.created_at >= p_from and x.created_at < p_to and x.direction = 'outbound'
            and x.status not in ('draft', 'scheduled', 'failed') group by x.user_id),
  f  as (select x.user_id, count(*) as cnt from public.custom_activities x
          where x.created_at >= p_from and x.created_at < p_to and x.status = 'published' group by x.user_id),
  t  as (select x.done_by as user_id, count(*) as cnt from public.tasks x
          where x.done and x.done_at >= p_from and x.done_at < p_to group by x.done_by),
  oc as (select x.user_id, count(*) as cnt from public.opportunities x
          where x.created_at >= p_from and x.created_at < p_to group by x.user_id),
  won as (
    select op.user_id, l.opener_id, op.value
      from public.opportunities op
      join public.opportunity_statuses st on st.id = op.status_id and st.kind = 'won'
      join public.leads l on l.id = op.lead_id
     where op.closed_at >= p_from and op.closed_at < p_to),
  w  as (select x.user_id, count(*) as cnt, coalesce(sum(x.value), 0) as val from won x group by x.user_id),
  wo as (select x.opener_id as user_id, count(*) as cnt from won x where x.opener_id is not null group by x.opener_id)
  select p.id,
         coalesce(c.dials, 0), coalesce(c.reached, 0), coalesce(c.meetings_logged, 0),
         coalesce(c.talk_seconds, 0), coalesce(c.inbound, 0),
         coalesce(mb.cnt, 0), coalesce(mh.cnt, 0),
         coalesce(n.cnt, 0), coalesce(e.cnt, 0), coalesce(s.cnt, 0), coalesce(f.cnt, 0),
         coalesce(t.cnt, 0), coalesce(oc.cnt, 0),
         coalesce(w.cnt, 0), coalesce(w.val, 0), coalesce(wo.cnt, 0)
    from public.profiles p
    left join c  on c.user_id  = p.id
    left join mb on mb.user_id = p.id
    left join mh on mh.user_id = p.id
    left join n  on n.user_id  = p.id
    left join e  on e.user_id  = p.id
    left join s  on s.user_id  = p.id
    left join f  on f.user_id  = p.id
    left join t  on t.user_id  = p.id
    left join oc on oc.user_id = p.id
    left join w  on w.user_id  = p.id
    left join wo on wo.user_id = p.id
   where (p.active or c.user_id is not null)
     and (v_users is null or p.id = any (v_users))
   order by coalesce(c.dials, 0) desc, p.full_name;
end $$;

create or replace function public.report_daily(p_from timestamptz, p_to timestamptz, p_user uuid default null,
                                               p_users uuid[] default null)
returns table (day date, dials bigint, reached bigint, meetings bigint, talk_seconds bigint)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_users uuid[] := public.report_scope(case when p_user is not null then array[p_user] else p_users end);
begin
  return query
  select (c.started_at at time zone 'Europe/Berlin')::date,
         count(*) filter (where c.direction = 'outbound'),
         count(*) filter (where coalesce(o.counts_as_connected, false)),
         count(*) filter (where coalesce(o.is_meeting, false)),
         coalesce(sum(c.duration), 0)::bigint
    from public.calls c
    left join public.call_outcomes o on o.key = c.outcome
   where c.started_at >= p_from and c.started_at < p_to
     and (v_users is null or c.user_id = any (v_users))
   group by 1
   order by 1;
end $$;

create or replace function public.report_outcomes(p_from timestamptz, p_to timestamptz, p_user uuid default null,
                                                  p_users uuid[] default null)
returns table (outcome text, cnt bigint)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_users uuid[] := public.report_scope(case when p_user is not null then array[p_user] else p_users end);
begin
  return query
  select coalesce(c.outcome, '_none'), count(*)
    from public.calls c
   where c.started_at >= p_from and c.started_at < p_to
     and c.direction = 'outbound'
     and (v_users is null or c.user_id = any (v_users))
   group by 1
   order by 2 desc;
end $$;

-- Leads je Status (nur sichtbare Leads)
create or replace function public.report_status_counts()
returns table (status_id uuid, cnt bigint)
language sql stable set search_path = '' as $$
  select l.status_id, count(*) from public.leads l group by 1
$$;

-- Statuswechsel im Zeitraum (wie Close „Status Change Report“)
create or replace function public.report_status_changes(p_from timestamptz, p_to timestamptz, p_users uuid[] default null)
returns table (from_status uuid, to_status uuid, cnt bigint)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_users uuid[] := public.report_scope(p_users);
begin
  return query
  select (e.data ->> 'from')::uuid, (e.data ->> 'to')::uuid, count(*)
    from public.lead_events e
   where e.type = 'status' and e.created_at >= p_from and e.created_at < p_to
     and (v_users is null or e.user_id = any (v_users))
   group by 1, 2
   order by 3 desc;
end $$;

-- Trichter einer Pipeline: wie viele Opportunities haben welche Stufe erreicht
create or replace function public.report_funnel(p_from timestamptz, p_to timestamptz, p_pipeline uuid,
                                                p_users uuid[] default null)
returns table (status_id uuid, reached bigint, reached_value numeric, current_cnt bigint, current_value numeric)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_users uuid[] := public.report_scope(p_users);
begin
  return query
  with opps as (
    select o.id, o.status_id, o.value, o.user_id
      from public.opportunities o
      join public.opportunity_statuses st on st.id = o.status_id
     where st.pipeline_id = p_pipeline
       and o.created_at >= p_from and o.created_at < p_to
       and (v_users is null or o.user_id = any (v_users))),
  visits as (
    select distinct o.id as opp_id, coalesce((e.data ->> 'to')::uuid, (e.data ->> 'status_id')::uuid) as status_id, o.value
      from opps o
      join public.lead_events e
        on e.type in ('opportunity_created', 'opportunity_status')
       and (e.data ->> 'opportunity_id')::uuid = o.id
    union
    select o.id, o.status_id, o.value from opps o)
  select st.id,
         (select count(*) from visits v where v.status_id = st.id),
         (select coalesce(sum(v.value), 0) from visits v where v.status_id = st.id),
         (select count(*) from opps o where o.status_id = st.id),
         (select coalesce(sum(o.value), 0) from opps o where o.status_id = st.id)
    from public.opportunity_statuses st
   where st.pipeline_id = p_pipeline
   order by st.sort;
end $$;

-- Beste Anrufzeiten: Anwahlen und Erreichte je Wochentag und Stunde (Berliner Zeit)
create or replace function public.report_call_hours(p_from timestamptz, p_to timestamptz, p_users uuid[] default null)
returns table (dow int, hour int, dials bigint, reached bigint)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_users uuid[] := public.report_scope(p_users);
begin
  return query
  select extract(isodow from c.started_at at time zone 'Europe/Berlin')::int,
         extract(hour from c.started_at at time zone 'Europe/Berlin')::int,
         count(*),
         count(*) filter (where coalesce(o.counts_as_connected, false))
    from public.calls c
    left join public.call_outcomes o on o.key = c.outcome
   where c.direction = 'outbound' and c.started_at >= p_from and c.started_at < p_to
     and (v_users is null or c.user_id = any (v_users))
   group by 1, 2
   order by 1, 2;
end $$;

-- Formulare auswerten (z. B. „Setting: Kundengewinnung“ – Feldwerte zählen)
create or replace function public.report_form_values(p_type uuid, p_field text, p_from timestamptz, p_to timestamptz,
                                                     p_users uuid[] default null)
returns table (value text, cnt bigint)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_users uuid[] := public.report_scope(p_users);
begin
  return query
  select coalesce(nullif(v.value, ''), '–'), count(*)
    from public.custom_activities a
    cross join lateral (
      select jsonb_array_elements_text(a.data -> p_field) as value
       where jsonb_typeof(a.data -> p_field) = 'array'
      union all
      select a.data ->> p_field
       where jsonb_typeof(a.data -> p_field) is distinct from 'array'
    ) v
   where a.type_id = p_type and a.status = 'published'
     and a.created_at >= p_from and a.created_at < p_to
     and (v_users is null or a.user_id = any (v_users))
   group by 1
   order by 2 desc;
end $$;

-- ---------------------------------------------------------------------
--  Workflows: Leads automatisch aufnehmen und Ziele erkennen
-- ---------------------------------------------------------------------
create or replace function public.workflow_wait(p_step jsonb)
returns interval language sql immutable as $$
  select make_interval(
    mins  => case p_step #>> '{wait,unit}' when 'minutes' then coalesce((p_step #>> '{wait,amount}')::int, 0) else 0 end,
    hours => case p_step #>> '{wait,unit}' when 'hours'   then coalesce((p_step #>> '{wait,amount}')::int, 0) else 0 end,
    days  => case p_step #>> '{wait,unit}' when 'days'    then coalesce((p_step #>> '{wait,amount}')::int, 0) else 0 end)
$$;

create or replace function public.workflow_start(p_workflow uuid, p_lead uuid, p_contact uuid default null,
                                                 p_by uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  w public.workflows;
  v_id uuid;
begin
  select * into w from public.workflows where id = p_workflow;
  if w.id is null or w.status <> 'active' then
    return null;
  end if;
  if not w.allow_reenroll and exists (select 1 from public.workflow_runs r
                                       where r.workflow_id = p_workflow and r.lead_id = p_lead) then
    return null;
  end if;
  if exists (select 1 from public.leads where id = p_lead and do_not_call)
     and exists (select 1 from jsonb_array_elements(w.steps) s where s ->> 'type' in ('call', 'sms')) then
    return null;
  end if;
  insert into public.workflow_runs (workflow_id, lead_id, contact_id, started_by, next_at)
  values (p_workflow, p_lead, p_contact, coalesce(p_by, auth.uid()),
          now() + public.workflow_wait(w.steps -> 0))
  on conflict do nothing
  returning id into v_id;
  return v_id;
end $$;

revoke all on function public.workflow_start(uuid, uuid, uuid, uuid) from public, anon, authenticated;

-- Lead von Hand in einen Workflow aufnehmen (einzeln oder gesammelt)
create or replace function public.workflow_enroll(p_workflow uuid, p_leads uuid[], p_contact uuid default null)
returns int language plpgsql security definer set search_path = '' as $$
declare
  v_lead uuid;
  n int := 0;
begin
  if not public.is_member() then
    raise exception 'Keine Berechtigung.';
  end if;
  if coalesce(array_length(p_leads, 1), 0) > 1
     and not (public.has_perm('bulk_workflow') or public.has_perm('manage_workflows')) then
    raise exception 'Keine Berechtigung, mehrere Leads gleichzeitig in einen Workflow aufzunehmen.';
  end if;
  if not exists (select 1 from public.workflows where id = p_workflow and status = 'active') then
    raise exception 'Der Workflow ist nicht aktiv.';
  end if;
  foreach v_lead in array coalesce(p_leads, '{}') loop
    if public.can_see_lead(v_lead) and public.workflow_start(p_workflow, v_lead, p_contact) is not null then
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

-- Auslöser und Ziele (wird von den Tabellen-Triggern unten aufgerufen)
create or replace function public.workflow_event(p_lead uuid, p_kind text, p_value text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  w record;
  v_lead public.leads;
begin
  if p_lead is null then return; end if;

  -- Ziele: laufende Workflows beenden
  update public.workflow_runs r
     set status = 'goal_met', ended_at = now(), end_reason = 'Ziel erreicht', locked_at = null
    from public.workflows wf
   where r.workflow_id = wf.id and r.lead_id = p_lead and r.status in ('active', 'paused')
     and wf.goal ->> 'type' = p_kind
     and (wf.goal ->> 'value' is null or wf.goal ->> 'value' = '' or wf.goal ->> 'value' = p_value);

  if p_kind = 'replied' then
    update public.workflow_runs r
       set status = 'finished', ended_at = now(), end_reason = 'Antwort erhalten', locked_at = null
      from public.workflows wf
     where r.workflow_id = wf.id and r.lead_id = p_lead and r.status in ('active', 'paused')
       and wf.stop_on_reply;
    return;
  end if;

  -- Auslöser: aktive Workflows mit passendem Auslöser starten
  select * into v_lead from public.leads where id = p_lead;
  if v_lead.id is null then return; end if;
  for w in
    select wf.id, wf.trigger
      from public.workflows wf
     where wf.status = 'active'
       and wf.trigger ->> 'type' = p_kind
       and (coalesce(wf.trigger ->> 'value', '') = '' or wf.trigger ->> 'value' = p_value)
  loop
    if jsonb_typeof(w.trigger #> '{filters,status_ids}') = 'array'
       and jsonb_array_length(w.trigger #> '{filters,status_ids}') > 0
       and not (w.trigger #> '{filters,status_ids}') ? coalesce(v_lead.status_id::text, '') then
      continue;
    end if;
    if jsonb_typeof(w.trigger #> '{filters,owner_ids}') = 'array'
       and jsonb_array_length(w.trigger #> '{filters,owner_ids}') > 0
       and not (w.trigger #> '{filters,owner_ids}') ? coalesce(v_lead.owner_id::text, '') then
      continue;
    end if;
    perform public.workflow_start(w.id, p_lead, null, auth.uid());
  end loop;
end $$;

revoke all on function public.workflow_event(uuid, text, text) from public, anon, authenticated;

create or replace function public.wf_on_lead()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform public.workflow_event(new.id, 'lead_created', null);
  elsif new.status_id is distinct from old.status_id then
    perform public.workflow_event(new.id, 'status', new.status_id::text);          -- Ziel
    perform public.workflow_event(new.id, 'status_changed', new.status_id::text);  -- Auslöser
  end if;
  return null;
end $$;

create trigger wf_on_lead after insert or update of status_id on public.leads
  for each row execute function public.wf_on_lead();

create or replace function public.wf_on_call()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.lead_id is not null and new.outcome is not null
     and (tg_op = 'INSERT' or new.outcome is distinct from old.outcome) then
    perform public.workflow_event(new.lead_id, 'outcome', new.outcome);
    perform public.workflow_event(new.lead_id, 'call_outcome', new.outcome);
  end if;
  return null;
end $$;

create trigger wf_on_call after insert or update of outcome on public.calls
  for each row execute function public.wf_on_call();

create or replace function public.wf_on_meeting()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.lead_id is not null and new.status = 'scheduled'
     and (tg_op = 'INSERT' or old.lead_id is distinct from new.lead_id) then
    perform public.workflow_event(new.lead_id, 'meeting', null);
    perform public.workflow_event(new.lead_id, 'meeting_booked', null);
  end if;
  return null;
end $$;

create trigger wf_on_meeting after insert or update of lead_id on public.meetings
  for each row execute function public.wf_on_meeting();

create or replace function public.wf_on_activity()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'published' and (tg_op = 'INSERT' or old.status <> 'published') then
    perform public.workflow_event(new.lead_id, 'activity_created', new.type_id::text);
  end if;
  return null;
end $$;

create trigger wf_on_activity after insert or update of status on public.custom_activities
  for each row execute function public.wf_on_activity();

create or replace function public.wf_on_opportunity()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' or new.status_id is distinct from old.status_id then
    perform public.workflow_event(new.lead_id, 'opportunity_status', new.status_id::text);
  end if;
  return null;
end $$;

create trigger wf_on_opportunity after insert or update of status_id on public.opportunities
  for each row execute function public.wf_on_opportunity();

create or replace function public.wf_on_reply()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.direction = 'inbound' and new.lead_id is not null then
    perform public.workflow_event(new.lead_id, 'replied', null);
  end if;
  return null;
end $$;

create trigger wf_on_email_reply after insert on public.emails
  for each row execute function public.wf_on_reply();
create trigger wf_on_sms_reply after insert on public.sms_messages
  for each row execute function public.wf_on_reply();

-- Fällige Workflow-Schritte für den Zeitplan reservieren (nur Server)
create or replace function public.workflow_claim_due(p_limit int default 25)
returns setof public.workflow_runs language sql security definer set search_path = '' as $$
  update public.workflow_runs r set locked_at = now()
   where r.id in (
     select x.id from public.workflow_runs x
      where x.status = 'active' and x.next_at <= now()
        and (x.locked_at is null or x.locked_at < now() - interval '10 minutes')
      order by x.next_at
      limit greatest(1, least(p_limit, 200))
      for update skip locked)
  returning r.*
$$;

revoke all on function public.workflow_claim_due(int) from public, anon, authenticated;
grant execute on function public.workflow_claim_due(int) to service_role;

-- ---------------------------------------------------------------------
--  Zeitpläne: Kalender-Abgleich (5 Min.) und Hintergrundaufgaben (1 Min.)
--  Hintergrundaufgaben: Workflows, geplante E-Mails/SMS, Postfach-Abruf,
--  Abschriften, Löschfristen für Aufnahmen.
-- ---------------------------------------------------------------------
create or replace function public.admin_schedule_jobs(p_base text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_token text;
begin
  if not public.is_admin() then
    raise exception 'Nur für Admins.';
  end if;
  if p_base !~ '^https://[^ /]+(/[^ ]*)?/functions/v1$' then
    raise exception 'Ungültige Adresse: %', p_base;
  end if;
  begin
    execute 'create extension if not exists pg_cron';
    execute 'create extension if not exists pg_net with schema extensions';
  exception when others then
    raise exception 'Bitte im Supabase-Dashboard unter Database → Extensions „pg_cron“ und „pg_net“ aktivieren (%).', sqlerrm;
  end;

  v_token := public.kv_get('CRON_TOKEN');
  if v_token is null then
    v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
    perform public.kv_set('CRON_TOKEN', v_token);
  end if;

  execute 'select cron.unschedule(jobid) from cron.job where jobname in (''crm-calendar-sync'', ''crm-jobs'')';
  execute format(
    'select cron.schedule(%L, %L, %L)',
    'crm-calendar-sync', '*/5 * * * *',
    format('select net.http_post(url := %L, body := %L::jsonb, headers := %L::jsonb)',
           p_base || '/gcal-sync', '{"source":"cron"}',
           jsonb_build_object('Content-Type', 'application/json', 'x-crm-cron', v_token)::text));
  execute format(
    'select cron.schedule(%L, %L, %L)',
    'crm-jobs', '* * * * *',
    format('select net.http_post(url := %L, body := %L::jsonb, headers := %L::jsonb, timeout_milliseconds := 55000)',
           p_base || '/jobs', '{"source":"cron"}',
           jsonb_build_object('Content-Type', 'application/json', 'x-crm-cron', v_token)::text));
  return 'ok';
end $$;
