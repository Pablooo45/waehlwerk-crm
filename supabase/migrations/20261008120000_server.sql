-- =====================================================================
--  Wählwerk CRM – Datenbank, Teil 5: Server-Abläufe
--  • Umzug aus Close (Zuordnungstabelle, Import ohne Nebenwirkungen)
--  • Hintergrundaufgaben (geplante E-Mails/SMS, Postfach-Abruf, Löschfristen, Aufnahmen nachholen)
--  • Aufnahmen: Spuren tauschen, verpasste Anrufe nur einmal
--  • Anrufdaten (Dauer, Status, Aufnahme) setzt nur das Telefonsystem
-- =====================================================================

-- ---------------------------------------------------------------------
--  Umzug aus Close: welche Close-ID gehört zu welchem Eintrag hier?
-- ---------------------------------------------------------------------
create table public.import_map (
  source      text not null default 'close',
  kind        text not null,
  external_id text not null,
  local_id    text not null,
  created_at  timestamptz not null default now(),
  primary key (source, kind, external_id)
);
alter table public.import_map enable row level security;   -- keine Regeln → nur der Server

-- Was beim Umzug noch nachgeladen werden muss (z. B. Gesprächsaufnahmen aus Close)
create table public.import_queue (
  kind       text not null,
  ref        uuid not null,
  url        text not null,
  done       boolean not null default false,
  attempts   int not null default 0,
  error      text,
  created_at timestamptz not null default now(),
  primary key (kind, ref)
);
alter table public.import_queue enable row level security;  -- nur der Server

-- Während eines Imports laufen keine Workflows an, niemand wird benachrichtigt,
-- und Zeitstempel bleiben die aus Close.
create or replace function public.importing()
returns boolean language sql stable as $$
  select coalesce(current_setting('crm.import', true), '') = 'on'
$$;

-- Zeilen gesammelt einfügen (nur Server). Spalten = Schlüssel der ersten Zeile; "_ext" = Close-ID.
create or replace function public.import_rows(p_table text, p_rows jsonb, p_kind text default null)
returns int language plpgsql security definer set search_path = '' as $$
declare
  v_cols text;
  n int := 0;
begin
  if p_table not in ('leads', 'contacts', 'opportunities', 'calls', 'notes', 'emails', 'sms_messages', 'tasks',
                     'meetings', 'custom_activities', 'lead_events') then
    raise exception 'Import in % ist nicht vorgesehen.', p_table;
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    return 0;
  end if;
  perform set_config('crm.import', 'on', true);
  select string_agg(quote_ident(k), ', ') into v_cols
    from jsonb_object_keys(p_rows -> 0) k where k <> '_ext';
  execute format('insert into public.%I (%s) select %s from jsonb_populate_recordset(null::public.%I, $1) on conflict do nothing',
                 p_table, v_cols, v_cols, p_table)
    using p_rows;
  get diagnostics n = row_count;
  if p_kind is not null then
    insert into public.import_map (kind, external_id, local_id)
    select p_kind, r ->> '_ext', r ->> 'id'
      from jsonb_array_elements(p_rows) r
     where coalesce(r ->> '_ext', '') <> '' and r ? 'id'
    on conflict do nothing;
  end if;
  return n;
end $$;

revoke all on function public.import_rows(text, jsonb, text) from public, anon, authenticated;
grant execute on function public.import_rows(text, jsonb, text) to service_role;

-- Nach dem Import: Kennzahlen der betroffenen Leads neu berechnen
create or replace function public.import_refresh_leads(p_leads uuid[])
returns void language plpgsql security definer set search_path = '' as $$
declare
  l uuid;
begin
  foreach l in array coalesce(p_leads, '{}') loop
    perform public.refresh_lead_call_stats(l);
    perform public.refresh_lead_next_task(l);
    perform public.refresh_lead_next_meeting(l);
    update public.leads x set last_activity_at = greatest(x.last_activity_at, (
      select max(t.at) from public.lead_timeline t where t.lead_id = l and t.kind <> 'event'))
     where x.id = l;
  end loop;
end $$;

revoke all on function public.import_refresh_leads(uuid[]) from public, anon, authenticated;
grant execute on function public.import_refresh_leads(uuid[]) to service_role;

-- ---------------------------------------------------------------------
--  Trigger: im Import-Modus keine Nebenwirkungen
-- ---------------------------------------------------------------------
create or replace function public.leads_after_write()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    insert into public.lead_events (lead_id, user_id, type, data, created_at)
    values (new.id, coalesce(auth.uid(), new.created_by), 'created',
            jsonb_build_object('source', new.source, 'status_id', new.status_id),
            case when public.importing() then new.created_at else now() end);
    if new.owner_id is not null and not public.importing() then
      perform public.notify(new.owner_id, 'assigned', new.id, 'lead', new.id, 'Neuer Lead für dich: ' || new.name);
    end if;
  else
    if new.status_id is distinct from old.status_id then
      insert into public.lead_events (lead_id, user_id, type, data)
      values (new.id, auth.uid(), 'status', jsonb_build_object('from', old.status_id, 'to', new.status_id));
    end if;
    if new.owner_id is distinct from old.owner_id then
      insert into public.lead_events (lead_id, user_id, type, data)
      values (new.id, auth.uid(), 'owner', jsonb_build_object('from', old.owner_id, 'to', new.owner_id));
      if not public.importing() then
        perform public.notify(new.owner_id, 'assigned', new.id, 'lead', new.id, 'Dir zugewiesen: ' || new.name);
      end if;
    end if;
  end if;
  return null;
end $$;

create or replace function public.calls_after_write()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_is_meeting boolean;
begin
  if tg_op in ('INSERT', 'UPDATE') and new.lead_id is not null then
    perform public.refresh_lead_call_stats(new.lead_id);
    if tg_op = 'INSERT' then
      update public.leads
         set last_activity_at = case when public.importing()
                                     then greatest(last_activity_at, new.started_at) else now() end
       where id = new.lead_id;
    end if;
    if new.outcome is not null and new.user_id is not null
       and (tg_op = 'INSERT' or new.outcome is distinct from old.outcome) then
      select o.is_meeting into v_is_meeting from public.call_outcomes o where o.key = new.outcome;
      if coalesce(v_is_meeting, false) then
        update public.leads set opener_id = new.user_id where id = new.lead_id and opener_id is null;
      end if;
    end if;
  end if;
  if tg_op in ('UPDATE', 'DELETE') and old.lead_id is not null
     and (tg_op = 'DELETE' or old.lead_id is distinct from new.lead_id) then
    perform public.refresh_lead_call_stats(old.lead_id);
  end if;
  return null;
end $$;

create or replace function public.touch_lead_activity()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.leads
     set last_activity_at = case when public.importing() then greatest(last_activity_at, new.created_at) else now() end
   where id = new.lead_id;
  return null;
end $$;

create or replace function public.touch_lead_activity_nullable()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.lead_id is not null then
    update public.leads
       set last_activity_at = case when public.importing() then greatest(last_activity_at, new.created_at) else now() end
     where id = new.lead_id;
  end if;
  return null;
end $$;

create or replace function public.meetings_after_write()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op in ('INSERT', 'UPDATE') and new.lead_id is not null then
    perform public.refresh_lead_next_meeting(new.lead_id);
    if tg_op = 'INSERT' then
      update public.leads
         set last_activity_at = case when public.importing() then greatest(last_activity_at, new.created_at) else now() end
       where id = new.lead_id;
    end if;
    if new.set_by is not null and new.status <> 'canceled' then
      update public.leads set opener_id = new.set_by where id = new.lead_id and opener_id is null;
    end if;
  end if;
  if tg_op in ('UPDATE', 'DELETE') and old.lead_id is not null
     and (tg_op = 'DELETE' or old.lead_id is distinct from new.lead_id) then
    perform public.refresh_lead_next_meeting(old.lead_id);
  end if;
  return null;
end $$;

create or replace function public.opportunities_before_write()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_kind text;
begin
  select kind into v_kind from public.opportunity_statuses where id = new.status_id;
  if coalesce(v_kind, 'open') <> 'open' then
    if public.importing() then
      new.closed_at := coalesce(new.closed_at, new.created_at, now());
    elsif tg_op = 'INSERT' or new.status_id is distinct from old.status_id then
      new.closed_at := now();
    end if;
  else
    new.closed_at := null;
  end if;
  if not public.importing() then
    new.updated_at := now();
  end if;
  return new;
end $$;

create or replace function public.opportunities_log()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    insert into public.lead_events (lead_id, user_id, type, data, created_at)
    values (new.lead_id, coalesce(auth.uid(), new.user_id), 'opportunity_created',
            jsonb_build_object('opportunity_id', new.id, 'status_id', new.status_id,
                               'value', new.value, 'value_period', new.value_period),
            case when public.importing() then new.created_at else now() end);
  elsif new.status_id is distinct from old.status_id then
    insert into public.lead_events (lead_id, user_id, type, data)
    values (new.lead_id, auth.uid(), 'opportunity_status',
            jsonb_build_object('opportunity_id', new.id, 'from', old.status_id, 'to', new.status_id,
                               'value', new.value, 'value_period', new.value_period));
  end if;
  return null;
end $$;

create or replace function public.custom_activities_validate()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  f jsonb;
  v jsonb;
begin
  if new.status = 'published' and not public.importing() then
    for f in select jsonb_array_elements(t.fields) from public.activity_types t where t.id = new.type_id loop
      if coalesce((f ->> 'required')::boolean, false) then
        v := new.data -> (f ->> 'key');
        if v is null or v = 'null'::jsonb or v = '""'::jsonb or v = '[]'::jsonb then
          raise exception 'Bitte „%“ ausfüllen.', f ->> 'label';
        end if;
      end if;
    end loop;
  end if;
  if not public.importing() then
    new.updated_at := now();
  end if;
  return new;
end $$;

-- Formular-Automatik (Aufgaben, Sperrdaten) nicht für übernommene Formulare
do $$
declare
  v_src text;
begin
  select pg_get_functiondef('public.custom_activities_automation()'::regprocedure) into v_src;
  if position('public.importing()' in v_src) = 0 then
    v_src := replace(v_src,
      'if new.status <> ''published'' or (tg_op = ''UPDATE'' and old.status = ''published'') then',
      'if public.importing() or new.status <> ''published'' or (tg_op = ''UPDATE'' and old.status = ''published'') then');
    if position('public.importing()' in v_src) = 0 then
      raise exception 'Formular-Automatik konnte nicht angepasst werden.';
    end if;
    execute v_src;
  end if;
end $$;

-- Workflow-Auslöser und -Ziele: nicht beim Import; Abwesenheitsnotizen sind keine Antwort
create or replace function public.workflow_event(p_lead uuid, p_kind text, p_value text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  w record;
  v_lead public.leads;
begin
  if p_lead is null or public.importing() then return; end if;

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

alter table public.emails add column if not exists auto_reply boolean not null default false;

create or replace function public.wf_on_reply()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.direction = 'inbound' and new.lead_id is not null
     and not coalesce((to_jsonb(new) ->> 'auto_reply')::boolean, false) then
    perform public.workflow_event(new.lead_id, 'replied', null);
  end if;
  return null;
end $$;

-- ---------------------------------------------------------------------
--  Verpasste Anrufe / Mailbox: je Anruf höchstens eine Aufgabe
-- ---------------------------------------------------------------------
create unique index if not exists tasks_call_missed_idx on public.tasks (call_id)
  where call_id is not null and type in ('missed_call', 'voicemail');

-- ---------------------------------------------------------------------
--  Sichtbarkeit für Server-Funktionen (die mit dem Service-Schlüssel arbeiten)
-- ---------------------------------------------------------------------
create or replace function public.user_visible_leads(p_user uuid, p_leads uuid[])
returns setof uuid language sql stable security definer set search_path = '' as $$
  select l.id
    from public.leads l
    join public.profiles pr on pr.id = p_user and pr.active
    join public.roles r on r.id = pr.role_id
   where l.id = any (p_leads)
     and (r.id = 'admin' or r.lead_visibility = 'all'
          or l.owner_id = p_user or l.opener_id = p_user
          or (l.owner_id is null and r.lead_visibility = 'own_and_unassigned'))
$$;

create or replace function public.user_can_see_lead(p_user uuid, p_lead uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.user_visible_leads(p_user, array[p_lead]))
$$;

revoke all on function public.user_visible_leads(uuid, uuid[]) from public, anon, authenticated;
revoke all on function public.user_can_see_lead(uuid, uuid) from public, anon, authenticated;
grant execute on function public.user_visible_leads(uuid, uuid[]) to service_role;
grant execute on function public.user_can_see_lead(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------
--  Postfächer: Abrufstand je Ordner
-- ---------------------------------------------------------------------
alter table public.email_accounts add column if not exists sync_state jsonb not null default '{}'::jsonb;

-- ---------------------------------------------------------------------
--  Hintergrundaufgaben (nur Server)
-- ---------------------------------------------------------------------
-- Zeitplan (pg_cron) und Web-Aufrufe aus der Datenbank (pg_net) gleich mit einschalten,
-- dann muss das niemand im Supabase-Dashboard von Hand tun. Fehlen sie (z. B. lokal), weiter ohne.
do $$
begin
  begin
    create extension if not exists pg_cron;
  exception when others then
    raise notice 'pg_cron nicht verfügbar: %', sqlerrm;
  end;
  begin
    create extension if not exists pg_net with schema extensions;
  exception when others then
    raise notice 'pg_net nicht verfügbar: %', sqlerrm;
  end;
end $$;

create or replace function public.claim_scheduled_emails(p_limit int default 15)
returns setof uuid language sql security definer set search_path = '' as $$
  update public.emails e set status = 'sending'
   where e.id in (
     select x.id from public.emails x
      where x.status = 'scheduled' and x.send_at <= now()
      order by x.send_at
      limit greatest(1, least(p_limit, 100))
      for update skip locked)
  returning e.id
$$;

create or replace function public.claim_scheduled_sms(p_limit int default 20)
returns setof uuid language sql security definer set search_path = '' as $$
  update public.sms_messages s set status = 'queued'
   where s.id in (
     select x.id from public.sms_messages x
      where x.status = 'scheduled' and x.send_at <= now()
      order by x.send_at
      limit greatest(1, least(p_limit, 100))
      for update skip locked)
  returning s.id
$$;

-- Postfächer, die dran sind (je Postfach höchstens alle p_minutes Minuten)
create or replace function public.claim_mail_sync(p_limit int default 5, p_minutes int default 5)
returns setof public.email_accounts language sql security definer set search_path = '' as $$
  update public.email_accounts a set last_sync_at = now()
   where a.id in (
     select x.id from public.email_accounts x
      where x.sync_enabled
        and (x.last_sync_at is null or x.last_sync_at < now() - make_interval(mins => p_minutes))
      order by x.last_sync_at nulls first
      limit greatest(1, least(p_limit, 50))
      for update skip locked)
  returning a.*
$$;

create or replace function public.stale_transcripts(p_minutes int default 10, p_limit int default 5)
returns table (call_id uuid, transcript_job text) language sql stable security definer set search_path = '' as $$
  select c.id, i.transcript_job
    from public.calls c
    left join public.call_insights i on i.call_id = c.id
   where c.transcript_status in ('queued', 'processing')
     and coalesce(i.updated_at, c.started_at) < now() - make_interval(mins => p_minutes)
   order by coalesce(i.updated_at, c.started_at)
   limit greatest(1, least(p_limit, 50))
$$;

-- Löschfrist: Aufnahmen (und daraus gewonnene Abschriften) nach p_days Tagen entfernen
create or replace function public.expire_recordings(p_days int, p_limit int default 200)
returns int language plpgsql security definer set search_path = '' as $$
declare
  c record;
  n int := 0;
begin
  if p_days is null or p_days < 1 then return 0; end if;
  for c in
    select id, recording_path, extra_recordings from public.calls
     where recording_path is not null and started_at < now() - make_interval(days => p_days)
     order by started_at
     limit greatest(1, least(p_limit, 1000))
     for update skip locked
  loop
    insert into public.storage_trash (bucket, path) values ('recordings', c.recording_path);
    insert into public.storage_trash (bucket, path)
    select 'recordings', r ->> 'path' from jsonb_array_elements(c.extra_recordings) r where coalesce(r ->> 'path', '') <> '';
    update public.calls
       set recording_status = 'deleted', recording_path = null, extra_recordings = '[]'::jsonb,
           recording_deleted_at = now(), transcript_status = 'none'
     where id = c.id;
    delete from public.call_insights where call_id = c.id;
    n := n + 1;
  end loop;
  return n;
end $$;

-- Anrufe ohne Abschlussmeldung (Rückmeldung von Twilio verloren) nach 4 Stunden schließen.
-- Eine Aufnahme, die dabei noch als „läuft“ markiert ist, holt danach claim_recording_retries nach.
create or replace function public.close_stale_calls()
returns int language plpgsql security definer set search_path = '' as $$
declare
  n int;
begin
  update public.calls
     set status   = case when answered_at is not null then 'completed' else 'failed' end,
         ended_at = coalesce(ended_at, now())
   where ended_at is null and started_at < now() - interval '4 hours';
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------------------------------------------------------------------
--  Aufnahmen nachholen. Bei Twilio wird eine Aufnahme erst gelöscht, wenn sie sicher bei uns
--  liegt – sie lässt sich also neu holen, wenn
--  • die Verarbeitung abbrach (Server-Funktion beendet, Speicher kurz nicht erreichbar),
--  • sie fehlschlug (neuer Versuch nach 10, 20, 30 Minuten),
--  • die Meldung „Aufnahme fertig“ von Twilio nie ankam.
-- ---------------------------------------------------------------------
alter table public.calls
  add column if not exists recording_attempts smallint not null default 0,  -- Verarbeitungsversuche
  add column if not exists recording_tried_at timestamptz,                   -- Beginn des letzten Versuchs
  add column if not exists recording_error    text;                          -- letzter Fehler (für die Anzeige)

create index if not exists calls_recording_retry_idx on public.calls (started_at)
  where recording_path is null and recording_status in ('recording', 'paused', 'processing', 'failed');

create or replace function public.claim_recording_retries(p_limit int default 3)
returns setof uuid language plpgsql security definer set search_path = '' as $$
begin
  -- Aufgegeben (vier Versuche, zuletzt abgebrochen) oder zu alt: als fehlgeschlagen zeigen,
  -- statt ewig „wird gespeichert“ – der Knopf „Erneut holen“ bleibt.
  update public.calls x
     set recording_status = 'failed',
         recording_error  = coalesce(x.recording_error, 'Die Aufnahme konnte nach mehreren Versuchen nicht gespeichert werden.')
   where x.recording_path is null
     and x.recording_status in ('recording', 'paused', 'processing')
     and (x.started_at < now() - interval '7 days'
          or (x.recording_attempts >= 4 and coalesce(x.recording_tried_at, x.started_at) < now() - interval '10 minutes'));

  return query
  update public.calls c set recording_status = 'processing', recording_tried_at = now()
   where c.id in (
     select x.id from public.calls x
      where x.recording_path is null
        and x.recording_status in ('recording', 'paused', 'processing', 'failed')
        and x.recording_attempts < 4
        and x.started_at > now() - interval '7 days'
        and (
          (x.recording_status = 'processing'
             and coalesce(x.recording_tried_at, x.started_at) < now() - interval '10 minutes')
          or (x.recording_status = 'failed'
             and coalesce(x.recording_tried_at, x.started_at) < now() - make_interval(mins => 10 * greatest(x.recording_attempts, 1)))
          or (x.recording_status in ('recording', 'paused')
             and x.ended_at is not null and x.ended_at < now() - interval '10 minutes')
        )
      order by x.started_at
      limit greatest(1, least(p_limit, 20))
      for update skip locked)
  returning c.id;
end $$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.claim_scheduled_emails(int)', 'public.claim_scheduled_sms(int)', 'public.claim_mail_sync(int, int)',
    'public.stale_transcripts(int, int)', 'public.expire_recordings(int, int)', 'public.close_stale_calls()',
    'public.claim_recording_retries(int)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

-- Stand der Hintergrundaufgaben für den Hinweis an Admins (eingeschaltet? zuletzt gelaufen?)
create or replace function public.admin_jobs_state()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then
    return null;
  end if;
  return jsonb_build_object('scheduled', public.kv_get('CRON_TOKEN') is not null,
                            'lastRun', public.kv_get('JOBS_LAST_RUN'));
end $$;

revoke all on function public.admin_jobs_state() from public, anon;
grant execute on function public.admin_jobs_state() to authenticated;

-- Zeitplan einrichten. Ruft die Installation (GitHub-Workflow „Server“) direkt auf, damit niemand
-- etwas einschalten muss; im CRM geht es über admin_schedule_jobs (nur Admins).
create or replace function public.crm_schedule_jobs(p_base text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_token text;
begin
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

revoke all on function public.crm_schedule_jobs(text) from public, anon, authenticated;
grant execute on function public.crm_schedule_jobs(text) to service_role;

create or replace function public.admin_schedule_jobs(p_base text)
returns text language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then
    raise exception 'Nur für Admins.';
  end if;
  return public.crm_schedule_jobs(p_base);
end $$;

-- ---------------------------------------------------------------------
--  Anrufe: Status, Dauer, Leitungen und Aufnahme setzt nur das Telefonsystem.
--  Im Browser lassen sich Ergebnis, Notiz, Lead/Kontakt und die gemessene Leitungsqualität
--  ändern – so bleiben Gesprächszeiten und Berichte verlässlich.
-- ---------------------------------------------------------------------
create or replace function public.calls_guard()
returns trigger language plpgsql set search_path = '' as $$
declare
  editable constant text[] := array['outcome', 'note', 'lead_id', 'contact_id', 'quality'];
begin
  if current_user in ('postgres', 'service_role', 'supabase_admin') or auth.uid() is null then
    return new;
  end if;
  if tg_op = 'UPDATE' then
    -- alles außer den freigegebenen Feldern bleibt, wie es war
    new := jsonb_populate_record(new, to_jsonb(old) - editable);
    return new;
  end if;
  -- Von Hand protokollierter Anruf (oder einer, der Twilio nie erreicht hat): ohne Technik-Felder
  if new.status not in ('completed', 'failed') then
    new.status := 'completed';
  end if;
  new.ended_at := coalesce(new.ended_at, now());
  new.twilio_call_sid := null;
  new.twilio_child_sid := null;
  new.conference_sid := null;
  new.conference_name := null;
  new.recording_status := 'none';
  new.recording_sid := null;
  new.recording_path := null;
  new.recording_duration := null;
  new.recording_track := null;
  new.recording_format := null;
  new.recording_channels := null;
  new.agent_channel := null;
  new.recording_bytes := null;
  new.recording_deleted_at := null;
  new.extra_recordings := '[]'::jsonb;
  new.recording_attempts := 0;
  new.recording_tried_at := null;
  new.recording_error := null;
  new.talk_agent_ms := null;
  new.talk_customer_ms := null;
  new.transcript_status := 'none';
  new.monitors := '[]'::jsonb;
  new.is_voicemail := false;
  new.voicemail_drop_id := null;
  new.dialer_session := null;
  new.transferred_to := null;
  new.parent_call_id := null;
  return new;
end $$;

create trigger calls_guard before insert or update on public.calls
  for each row execute function public.calls_guard();

-- ---------------------------------------------------------------------
--  Aufnahme: Spuren tauschen, falls „wir“ und „Kunde“ vertauscht sind
-- ---------------------------------------------------------------------
create or replace function public.swap_recording_channels(p_call uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  c public.calls;
begin
  select * into c from public.calls where id = p_call for update;
  if c.id is null or not public.can_listen_call(p_call) then
    raise exception 'Aufnahme nicht gefunden.';
  end if;
  if coalesce(c.recording_channels, 1) < 2 then
    raise exception 'Diese Aufnahme hat nur eine Spur.';
  end if;
  if c.user_id is distinct from auth.uid() and not public.has_perm('manage_others_activities') then
    raise exception 'Nur wer telefoniert hat (oder fremde Aktivitäten bearbeiten darf), kann die Spuren tauschen.';
  end if;
  update public.calls
     set agent_channel   = case when coalesce(agent_channel, 1) = 1 then 2 else 1 end,
         talk_agent_ms    = talk_customer_ms,
         talk_customer_ms = talk_agent_ms
   where id = p_call;
  update public.call_insights i set
    peaks = case when i.peaks is null then null
                 else jsonb_build_object('bucket_ms', i.peaks -> 'bucket_ms', 'agent', i.peaks -> 'customer', 'customer', i.peaks -> 'agent') end,
    talk = case when i.talk is null then null
                -- längster Monolog des Kunden lässt sich nicht tauschen (war ja unsere Stimme) → entfällt
                else (i.talk - 'longest_customer_ms') || jsonb_build_object('agent_ms', i.talk -> 'customer_ms', 'customer_ms', i.talk -> 'agent_ms') end,
    segments = case when jsonb_typeof(i.segments) = 'array' then (
                 select coalesce(jsonb_agg(s || jsonb_build_object('speaker',
                          case s ->> 'speaker' when 'agent' then 'customer' else 'agent' end) order by o), '[]'::jsonb)
                   from jsonb_array_elements(i.segments) with ordinality as e(s, o))
               else i.segments end,
    updated_at = now()
   where i.call_id = p_call;
end $$;

revoke all on function public.swap_recording_channels(uuid) from public, anon;
grant execute on function public.swap_recording_channels(uuid) to authenticated;
