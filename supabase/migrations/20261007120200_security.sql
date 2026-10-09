-- =====================================================================
--  Wählwerk CRM – Datenbank, Teil 3: Rechte (Row Level Security)
--
--  Grundregeln (wie in Close):
--  • Nur aktive Teammitglieder sehen überhaupt etwas.
--  • Welche Leads jemand sieht, bestimmt die Rolle (alle / nur eigene /
--    eigene + ohne Zuständigen). Alles, was an einem Lead hängt (Kontakte,
--    Anrufe, Notizen, E-Mails …), folgt dieser Sichtbarkeit.
--  • Einstellungen, Löschen, Sammelaktionen usw. hängen an einzelnen Rechten.
-- =====================================================================

-- Hilfsausdruck für Tabellen mit lead_id:
--   (select public.lead_visibility()) = 'all' or public.can_see_lead(lead_id)
-- Der Teil in Klammern wird pro Abfrage nur einmal berechnet.

-- ---------------------------------------------------------------------
--  Neue Tabelle für Dateien, die nach dem Löschen eines Anrufs noch aus dem
--  Speicher entfernt werden müssen (erledigt der Zeitplan „jobs“).
-- ---------------------------------------------------------------------
create table public.storage_trash (
  id        bigint generated always as identity primary key,
  bucket    text not null,
  path      text not null,
  queued_at timestamptz not null default now()
);

create or replace function public.calls_trash_files()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.recording_path is not null then
    insert into public.storage_trash (bucket, path) values ('recordings', old.recording_path);
  end if;
  insert into public.storage_trash (bucket, path)
  select 'recordings', r ->> 'path' from jsonb_array_elements(old.extra_recordings) r where r ->> 'path' is not null;
  return null;
end $$;

create trigger calls_trash_files after delete on public.calls
  for each row execute function public.calls_trash_files();

-- Aufnahme einzeln löschen (Recht „Aufnahmen löschen“ oder eigene Aufnahme mit
-- „Eigene Aktivitäten löschen“)
create or replace function public.delete_recording(p_call uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  c public.calls;
begin
  select * into c from public.calls where id = p_call for update;
  if c.id is null or not public.can_listen_call(p_call) then
    raise exception 'Aufnahme nicht gefunden.';
  end if;
  if not (public.has_perm('recordings_delete')
          or (c.user_id = auth.uid() and public.has_perm('delete_own_activities'))) then
    raise exception 'Keine Berechtigung zum Löschen von Aufnahmen.';
  end if;
  if c.recording_path is not null then
    insert into public.storage_trash (bucket, path) values ('recordings', c.recording_path);
  end if;
  insert into public.storage_trash (bucket, path)
  select 'recordings', r ->> 'path' from jsonb_array_elements(c.extra_recordings) r where r ->> 'path' is not null;
  update public.calls
     set recording_status = 'deleted', recording_path = null, extra_recordings = '[]'::jsonb,
         recording_deleted_at = now(), transcript_status = 'none', talk_agent_ms = null, talk_customer_ms = null
   where id = p_call;
  delete from public.call_insights where call_id = p_call;
  insert into public.lead_events (lead_id, user_id, type, data)
  select c.lead_id, auth.uid(), 'recording_deleted', jsonb_build_object('call_id', c.id)
   where c.lead_id is not null;
end $$;

-- Workflow-Lauf anhalten, fortsetzen oder beenden
create or replace function public.workflow_run_set_status(p_run uuid, p_status text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  r public.workflow_runs;
begin
  select * into r from public.workflow_runs where id = p_run for update;
  if r.id is null or not public.can_see_lead(r.lead_id) then
    raise exception 'Workflow-Lauf nicht gefunden.';
  end if;
  if p_status not in ('active', 'paused', 'canceled') then
    raise exception 'Ungültiger Status.';
  end if;
  if r.status not in ('active', 'paused') then
    raise exception 'Dieser Lauf ist schon beendet.';
  end if;
  update public.workflow_runs set
    status     = p_status,
    next_at    = case when p_status = 'active' then greatest(coalesce(r.next_at, now()), now()) else r.next_at end,
    ended_at   = case when p_status = 'canceled' then now() else null end,
    end_reason = case when p_status = 'canceled' then 'Von Hand beendet' else null end,
    locked_at  = null
  where id = p_run;
end $$;

-- ---------------------------------------------------------------------
--  RLS einschalten
-- ---------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'roles', 'profiles', 'groups', 'group_members', 'lead_statuses', 'call_outcomes', 'pipelines',
    'opportunity_statuses', 'custom_fields', 'activity_types', 'integration_links', 'org_settings',
    'leads', 'contacts', 'phone_numbers', 'voicemail_drops', 'calls', 'call_insights', 'notes',
    'email_templates', 'email_accounts', 'emails', 'sms_messages', 'tasks', 'meetings', 'opportunities',
    'custom_activities', 'lead_events', 'comments', 'notifications', 'workflows', 'workflow_runs',
    'smart_views', 'app_logs', 'duplicate_dismissals', 'storage_trash'] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
--  Benutzer, Rollen, Gruppen
-- ---------------------------------------------------------------------
create policy profiles_select on public.profiles for select to authenticated
  using ((select public.is_member()) or id = (select auth.uid()));
create policy profiles_update on public.profiles for update to authenticated
  using (id = (select auth.uid()) or (select public.is_admin()))
  with check (id = (select auth.uid()) or (select public.is_admin()));

create policy roles_select on public.roles for select to authenticated using ((select public.is_member()));
create policy roles_admin  on public.roles for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

create policy groups_select on public.groups for select to authenticated using ((select public.is_member()));
create policy groups_admin  on public.groups for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy group_members_select on public.group_members for select to authenticated using ((select public.is_member()));
create policy group_members_admin  on public.group_members for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- ---------------------------------------------------------------------
--  Konfiguration: alle lesen, „Anpassen“ bzw. „Telefonnummern verwalten“ schreibt
-- ---------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['lead_statuses', 'call_outcomes', 'pipelines', 'opportunity_statuses',
                           'custom_fields', 'activity_types', 'integration_links'] loop
    execute format('create policy %I on public.%I for select to authenticated using ((select public.is_member()))',
                   t || '_select', t);
    execute format('create policy %I on public.%I for all to authenticated '
                   'using ((select public.has_perm(''manage_customizations''))) '
                   'with check ((select public.has_perm(''manage_customizations'')))', t || '_manage', t);
  end loop;
end $$;

create policy phone_numbers_select on public.phone_numbers for select to authenticated using ((select public.is_member()));
create policy phone_numbers_manage on public.phone_numbers for all to authenticated
  using ((select public.has_perm('manage_phone_numbers'))) with check ((select public.has_perm('manage_phone_numbers')));

create policy org_settings_select on public.org_settings for select to authenticated using ((select public.is_member()));
create policy org_settings_update on public.org_settings for update to authenticated
  using ((select public.is_admin()) or (select public.has_perm('manage_customizations')))
  with check ((select public.is_admin()) or (select public.has_perm('manage_customizations')));

create policy workflows_select on public.workflows for select to authenticated using ((select public.is_member()));
create policy workflows_manage on public.workflows for all to authenticated
  using ((select public.has_perm('manage_workflows'))) with check ((select public.has_perm('manage_workflows')));

-- ---------------------------------------------------------------------
--  Leads und Kontakte
-- ---------------------------------------------------------------------
create policy leads_select on public.leads for select to authenticated using (
  (select public.lead_visibility()) = 'all'
  or ((select public.lead_visibility()) <> 'none' and (
        owner_id = (select auth.uid()) or opener_id = (select auth.uid())
        or (owner_id is null and (select public.lead_visibility()) = 'own_and_unassigned'))));
create policy leads_insert on public.leads for insert to authenticated
  with check ((select public.is_member()));
create policy leads_update on public.leads for update to authenticated using (
  (select public.lead_visibility()) = 'all'
  or ((select public.lead_visibility()) <> 'none' and (
        owner_id = (select auth.uid()) or opener_id = (select auth.uid())
        or (owner_id is null and (select public.lead_visibility()) = 'own_and_unassigned'))))
  with check ((select public.is_member()));
create policy leads_delete on public.leads for delete to authenticated using (
  (select public.has_perm('delete_leads')) and (
    (select public.lead_visibility()) = 'all'
    or owner_id = (select auth.uid()) or opener_id = (select auth.uid())
    or (owner_id is null and (select public.lead_visibility()) = 'own_and_unassigned')));

create policy contacts_all on public.contacts for all to authenticated
  using ((select public.lead_visibility()) = 'all' or public.can_see_lead(lead_id))
  with check ((select public.lead_visibility()) = 'all' or public.can_see_lead(lead_id));

create policy duplicate_dismissals_select on public.duplicate_dismissals for select to authenticated
  using ((select public.is_member()));
create policy duplicate_dismissals_insert on public.duplicate_dismissals for insert to authenticated
  with check ((select public.is_member()) and public.can_see_lead(lead_a) and public.can_see_lead(lead_b)
              and user_id = (select auth.uid()));
create policy duplicate_dismissals_delete on public.duplicate_dismissals for delete to authenticated
  using ((select public.is_admin()) or user_id = (select auth.uid()));

-- ---------------------------------------------------------------------
--  Telefonie
-- ---------------------------------------------------------------------
create policy calls_select on public.calls for select to authenticated using (
  (select public.is_member()) and (
    user_id = (select auth.uid())
    or (select public.lead_visibility()) = 'all'
    or (lead_id is not null and public.can_see_lead(lead_id))));
create policy calls_insert on public.calls for insert to authenticated with check (
  (select public.has_perm('calling')) and user_id = (select auth.uid())
  and (lead_id is null or (select public.lead_visibility()) = 'all' or public.can_see_lead(lead_id)));
create policy calls_update on public.calls for update to authenticated using (
  (select public.is_member())
  and (user_id = (select auth.uid()) or user_id is null or (select public.has_perm('manage_others_activities')))
  and (user_id = (select auth.uid()) or (select public.lead_visibility()) = 'all'
       or (lead_id is not null and public.can_see_lead(lead_id))))
  with check ((select public.is_member()));
create policy calls_delete on public.calls for delete to authenticated using (
  ((user_id = (select auth.uid()) and (select public.has_perm('delete_own_activities')))
   or (select public.has_perm('manage_others_activities')))
  and (user_id = (select auth.uid()) or (select public.lead_visibility()) = 'all'
       or (lead_id is not null and public.can_see_lead(lead_id))));

create policy call_insights_select on public.call_insights for select to authenticated
  using (public.can_listen_call(call_id));

create policy voicemail_drops_select on public.voicemail_drops for select to authenticated
  using ((select public.is_member()) and (shared or user_id = (select auth.uid())));
create policy voicemail_drops_insert on public.voicemail_drops for insert to authenticated
  with check ((select public.has_perm('calling')) and user_id = (select auth.uid()));
create policy voicemail_drops_modify on public.voicemail_drops for update to authenticated
  using ((select public.is_member()) and (user_id = (select auth.uid()) or (select public.is_admin())));
create policy voicemail_drops_delete on public.voicemail_drops for delete to authenticated
  using ((select public.is_member()) and (user_id = (select auth.uid()) or (select public.is_admin())));

-- ---------------------------------------------------------------------
--  Aktivitäten: eigene bearbeiten, fremde nur mit Recht
-- ---------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['notes', 'emails', 'custom_activities'] loop
    execute format($f$
      create policy %1$I on public.%2$I for select to authenticated
        using ((select public.lead_visibility()) = 'all' or public.can_see_lead(lead_id))$f$, t || '_select', t);
    execute format($f$
      create policy %1$I on public.%2$I for insert to authenticated
        with check (user_id = (select auth.uid())
                    and ((select public.lead_visibility()) = 'all' or public.can_see_lead(lead_id)))$f$, t || '_insert', t);
    execute format($f$
      create policy %1$I on public.%2$I for update to authenticated
        using (((select public.lead_visibility()) = 'all' or public.can_see_lead(lead_id))
               and (user_id = (select auth.uid()) or (select public.has_perm('manage_others_activities'))))
        with check ((select public.lead_visibility()) = 'all' or public.can_see_lead(lead_id))$f$, t || '_update', t);
    execute format($f$
      create policy %1$I on public.%2$I for delete to authenticated
        using (((select public.lead_visibility()) = 'all' or public.can_see_lead(lead_id))
               and ((user_id = (select auth.uid()) and (select public.has_perm('delete_own_activities')))
                    or (select public.has_perm('manage_others_activities'))))$f$, t || '_delete', t);
  end loop;
end $$;

create policy sms_select on public.sms_messages for select to authenticated using (
  (select public.is_member()) and (
    user_id = (select auth.uid())
    or (select public.lead_visibility()) = 'all'
    or (lead_id is not null and public.can_see_lead(lead_id))));
create policy sms_delete on public.sms_messages for delete to authenticated using (
  ((user_id = (select auth.uid()) and (select public.has_perm('delete_own_activities')))
   or (select public.has_perm('manage_others_activities')))
  and ((select public.lead_visibility()) = 'all' or (lead_id is not null and public.can_see_lead(lead_id))));

create policy comments_select on public.comments for select to authenticated
  using ((select public.lead_visibility()) = 'all' or public.can_see_lead(lead_id));
create policy comments_insert on public.comments for insert to authenticated
  with check (user_id = (select auth.uid())
              and ((select public.lead_visibility()) = 'all' or public.can_see_lead(lead_id)));
create policy comments_update on public.comments for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy comments_delete on public.comments for delete to authenticated
  using (user_id = (select auth.uid())
         or ((select public.has_perm('manage_others_activities'))
             and ((select public.lead_visibility()) = 'all' or public.can_see_lead(lead_id))));

create policy lead_events_select on public.lead_events for select to authenticated
  using ((select public.lead_visibility()) = 'all' or public.can_see_lead(lead_id));
create policy lead_events_insert on public.lead_events for insert to authenticated
  with check (user_id = (select auth.uid())
              and ((select public.lead_visibility()) = 'all' or public.can_see_lead(lead_id)));
create policy lead_events_delete on public.lead_events for delete to authenticated
  using ((select public.is_admin()));

-- Aufgaben: eigene und zugewiesene; fremde ändern/löschen nur mit Recht
create policy tasks_select on public.tasks for select to authenticated using (
  (select public.is_member()) and (
    assigned_to = (select auth.uid()) or created_by = (select auth.uid())
    or (select public.lead_visibility()) = 'all'
    or (lead_id is not null and public.can_see_lead(lead_id))));
create policy tasks_insert on public.tasks for insert to authenticated with check (
  (select public.is_member())
  and (lead_id is null or (select public.lead_visibility()) = 'all' or public.can_see_lead(lead_id)));
create policy tasks_update on public.tasks for update to authenticated using (
  (select public.is_member())
  and (assigned_to = (select auth.uid()) or created_by = (select auth.uid()) or assigned_to is null
       or (select public.has_perm('manage_others_tasks')))
  and (assigned_to = (select auth.uid()) or created_by = (select auth.uid())
       or (select public.lead_visibility()) = 'all' or (lead_id is not null and public.can_see_lead(lead_id))))
  with check ((select public.is_member()));
create policy tasks_delete on public.tasks for delete to authenticated using (
  (((assigned_to = (select auth.uid()) or created_by = (select auth.uid()))
    and (select public.has_perm('delete_own_tasks')))
   or (select public.has_perm('manage_others_tasks')))
  and (assigned_to = (select auth.uid()) or created_by = (select auth.uid())
       or (select public.lead_visibility()) = 'all' or (lead_id is not null and public.can_see_lead(lead_id))));

-- Termine
create policy meetings_select on public.meetings for select to authenticated using (
  (select public.is_member()) and (
    host_user_id = (select auth.uid()) or set_by = (select auth.uid())
    or (select public.lead_visibility()) = 'all'
    or (lead_id is not null and public.can_see_lead(lead_id))));
create policy meetings_insert on public.meetings for insert to authenticated with check (
  (select public.is_member())
  and (lead_id is null or (select public.lead_visibility()) = 'all' or public.can_see_lead(lead_id)));
create policy meetings_update on public.meetings for update to authenticated using (
  (select public.is_member()) and (
    host_user_id = (select auth.uid()) or set_by = (select auth.uid())
    or (select public.lead_visibility()) = 'all'
    or (lead_id is not null and public.can_see_lead(lead_id))))
  with check ((select public.is_member()));
create policy meetings_delete on public.meetings for delete to authenticated using (
  (select public.has_perm('manage_others_activities'))
  or (set_by = (select auth.uid()) and (select public.has_perm('delete_own_activities'))));

-- Opportunities
create policy opportunities_select on public.opportunities for select to authenticated
  using ((select public.lead_visibility()) = 'all' or public.can_see_lead(lead_id));
create policy opportunities_insert on public.opportunities for insert to authenticated with check (
  ((select public.lead_visibility()) = 'all' or public.can_see_lead(lead_id))
  and (user_id = (select auth.uid()) or (select public.has_perm('manage_others_opportunities'))));
create policy opportunities_update on public.opportunities for update to authenticated using (
  ((select public.lead_visibility()) = 'all' or public.can_see_lead(lead_id))
  and (user_id = (select auth.uid()) or user_id is null or (select public.has_perm('manage_others_opportunities'))))
  with check ((select public.lead_visibility()) = 'all' or public.can_see_lead(lead_id));
create policy opportunities_delete on public.opportunities for delete to authenticated using (
  ((select public.lead_visibility()) = 'all' or public.can_see_lead(lead_id))
  and ((user_id = (select auth.uid()) and (select public.has_perm('delete_own_opportunities')))
       or (select public.has_perm('manage_others_opportunities'))));

-- Benachrichtigungen: nur eigene (Inbox anderer mit Recht)
create policy notifications_select on public.notifications for select to authenticated using (
  user_id = (select auth.uid()) or (select public.has_perm('view_others_inbox')));
create policy notifications_update on public.notifications for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy notifications_delete on public.notifications for delete to authenticated
  using (user_id = (select auth.uid()));

-- Workflow-Läufe: sehen, wer den Lead sieht (ändern über workflow_run_set_status)
create policy workflow_runs_select on public.workflow_runs for select to authenticated
  using ((select public.lead_visibility()) = 'all' or public.can_see_lead(lead_id));
create policy workflow_runs_delete on public.workflow_runs for delete to authenticated
  using ((select public.has_perm('manage_workflows')));

-- ---------------------------------------------------------------------
--  Vorlagen, Smart Views, Postfächer, Fehlerprotokoll
-- ---------------------------------------------------------------------
create policy email_templates_select on public.email_templates for select to authenticated
  using ((select public.is_member()) and (shared or created_by = (select auth.uid())));
create policy email_templates_insert on public.email_templates for insert to authenticated
  with check ((select public.is_member()) and created_by = (select auth.uid()));
create policy email_templates_update on public.email_templates for update to authenticated
  using ((select public.is_member()) and (created_by = (select auth.uid()) or (select public.has_perm('manage_team_templates'))))
  with check ((select public.is_member()));
create policy email_templates_delete on public.email_templates for delete to authenticated
  using ((select public.is_member()) and (created_by = (select auth.uid()) or (select public.has_perm('manage_team_templates'))));

create policy smart_views_select on public.smart_views for select to authenticated
  using ((select public.is_member()) and (shared or created_by = (select auth.uid())));
create policy smart_views_insert on public.smart_views for insert to authenticated
  with check ((select public.is_member()) and created_by = (select auth.uid()));
create policy smart_views_update on public.smart_views for update to authenticated
  using ((select public.is_member()) and (created_by = (select auth.uid()) or (select public.has_perm('manage_team_smart_views'))))
  with check ((select public.is_member()));
create policy smart_views_delete on public.smart_views for delete to authenticated
  using ((select public.is_member()) and (created_by = (select auth.uid()) or (select public.has_perm('manage_team_smart_views'))));

create policy email_accounts_select on public.email_accounts for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));
create policy email_accounts_update on public.email_accounts for update to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()))
  with check (user_id = (select auth.uid()) or (select public.is_admin()));

create policy app_logs_insert on public.app_logs for insert to authenticated with check ((select public.is_member()));
create policy app_logs_select on public.app_logs for select to authenticated using ((select public.is_admin()));
create policy app_logs_delete on public.app_logs for delete to authenticated using ((select public.is_admin()));

-- storage_trash: keine Regeln → nur der Server (service_role) kommt heran

-- ---------------------------------------------------------------------
--  Datei-Speicher: Aufnahmen, Mailbox-Ansagen, E-Mail-Anhänge
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('recordings', 'recordings', false), ('voicemails', 'voicemails', false), ('attachments', 'attachments', false)
on conflict (id) do nothing;

create policy crm_recordings_read on storage.objects for select to authenticated
  using (bucket_id = 'recordings' and public.can_read_recording(name));

create policy crm_voicemails_read on storage.objects for select to authenticated
  using (bucket_id = 'voicemails' and (select public.is_member()));
create policy crm_voicemails_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'voicemails' and (select public.is_member()) and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or ((storage.foldername(name))[1] = 'org'
          and ((select public.is_admin()) or (select public.has_perm('manage_phone_numbers'))))));
create policy crm_voicemails_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'voicemails' and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or (select public.is_admin()) or (select public.has_perm('manage_phone_numbers'))));

create policy crm_attachments_read on storage.objects for select to authenticated
  using (bucket_id = 'attachments' and (select public.is_member()));
create policy crm_attachments_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'attachments' and (select public.is_member())
              and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy crm_attachments_delete on storage.objects for delete to authenticated
  using (bucket_id = 'attachments' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- ---------------------------------------------------------------------
--  Live-Aktualisierung (Realtime)
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table
      public.calls, public.tasks, public.meetings, public.notifications, public.sms_messages,
      public.emails, public.call_insights;
  end if;
end $$;

-- ---------------------------------------------------------------------
--  Funktionen, die nur der Server aufrufen darf
-- ---------------------------------------------------------------------
revoke all on function public.refresh_lead_call_stats(uuid)   from public, anon, authenticated;
revoke all on function public.refresh_lead_next_task(uuid)    from public, anon, authenticated;
revoke all on function public.refresh_lead_next_meeting(uuid) from public, anon, authenticated;

-- Gäste (anon) bekommen gar nichts
revoke all on all tables in schema public from anon;
revoke execute on all functions in schema public from anon;
