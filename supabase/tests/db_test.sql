-- Datenbank-Tests (lokal): prüft Rollen & Rechte, Sichtbarkeit, Trigger,
-- Sammelaktionen, Zusammenführen, Workflows und Berichte.
-- Läuft nach supabase_stub.sql + allen Migrationen. Bricht beim ersten Fehler ab.
\set ON_ERROR_STOP 1

create or replace function pg_temp.check(cond boolean, msg text) returns void language plpgsql as $$
begin
  if cond is distinct from true then
    raise exception 'TEST FEHLGESCHLAGEN: %', msg;
  end if;
  raise notice 'ok  %', msg;
end $$;

-- Erwartet, dass sql mit einer Meldung scheitert, die pattern enthält
create or replace function pg_temp.fails(sql text, pattern text, msg text) returns void language plpgsql as $$
begin
  begin
    execute sql;
  exception when others then
    if sqlerrm ilike '%' || pattern || '%' then
      raise notice 'ok  %', msg;
      return;
    end if;
    raise exception 'TEST FEHLGESCHLAGEN: % (falsche Meldung: %)', msg, sqlerrm;
  end;
  raise exception 'TEST FEHLGESCHLAGEN: % (lief ohne Fehler durch)', msg;
end $$;

grant execute on function pg_temp.check(boolean, text) to public;
grant execute on function pg_temp.fails(text, text, text) to public;

-- IDs
\set ada   '''00000000-0000-0000-0000-00000000000a'''
\set bob   '''00000000-0000-0000-0000-00000000000b'''
\set fremd '''00000000-0000-0000-0000-00000000000c'''
\set dora  '''00000000-0000-0000-0000-00000000000d'''
\set emil  '''00000000-0000-0000-0000-00000000000e'''
\set sue   '''00000000-0000-0000-0000-00000000000f'''
\set l1    '''10000000-0000-0000-0000-000000000001'''
\set l2    '''10000000-0000-0000-0000-000000000002'''
\set l3    '''10000000-0000-0000-0000-000000000003'''

-- ---------- Telefonnummern ----------
select pg_temp.check(public.normalize_phone('069 123 456') = '+4969123456', 'normalize 069');
select pg_temp.check(public.normalize_phone('+49 (0) 69 / 123-456') = '+4969123456', 'normalize +49 (0)');
select pg_temp.check(public.normalize_phone('0049 6181 12345') = '+49618112345', 'normalize 0049');
select pg_temp.check(public.normalize_phone('0171 1234567') = '+491711234567', 'normalize mobil');
select pg_temp.check(public.normalize_phone('+43 1 234567') = '+431234567', 'normalize AT');
select pg_temp.check(public.normalize_phone('12') is null, 'normalize zu kurz');
select pg_temp.check(public.phone_search_variants('+4969123456') = '4969123456 069123456', 'Suchvarianten');

-- ---------- Startwerte ----------
select pg_temp.check((select count(*) = 4 from public.roles where is_builtin), '4 vordefinierte Rollen');
select pg_temp.check((select not ('manage_organization' = any (permissions)) and 'export' = any (permissions)
                        from public.roles where id = 'superuser'), 'Super User ohne Organisation verwalten');
select pg_temp.check((select count(*) = 6 from public.lead_statuses), 'Lead-Status aus Close');
select pg_temp.check((select count(*) = 2 from public.pipelines) and (select count(*) = 12 from public.opportunity_statuses), 'Pipelines aus Close');
select pg_temp.check((select count(*) = 3 from public.activity_types), 'Formulare aus Close');
select pg_temp.check((select jsonb_array_length(fields) = 20 from public.activity_types where name = 'Setting: Kundengewinnung'), 'Formular Kundengewinnung mit 20 Feldern');
select pg_temp.check((select count(*) = 16 from public.custom_fields), 'Felder aus Close');
select pg_temp.check((select count(*) = 6 from public.smart_views where pinned), 'angeheftete Smart Views');
select pg_temp.check((select name = 'Salus Digital GmbH' and voicemail_drop_outcome = 'nicht_erreicht' from public.org_settings), 'Organisation');

-- ---------- Benutzer ----------
insert into auth.users (id, email, raw_user_meta_data)
values (:ada, 'Admin@Firma.de', '{"full_name":"Ada Admin"}');
insert into auth.users (id, email, raw_app_meta_data)
values (:bob, 'bob@firma.de', '{"crm_invited":true,"crm_function":"closer"}');
insert into auth.users (id, email, raw_user_meta_data)
values (:fremd, 'fremd@example.com', '{"crm_invited":true,"crm_role":"admin"}');
insert into auth.users (id, email, raw_app_meta_data)
values (:dora, 'dora@firma.de', '{"crm_invited":true,"crm_role":"restricted"}');
insert into auth.users (id, email, raw_app_meta_data)
values (:sue, 'sue@firma.de', '{"crm_invited":true,"crm_role":"superuser"}');

select pg_temp.check((select role_id = 'admin' and active from public.profiles where id = :ada), 'erster Benutzer = aktiver Admin');
select pg_temp.check((select email from public.profiles where id = :ada) = 'admin@firma.de', 'E-Mail klein');
select pg_temp.check((select role_id = 'user' and active and team_function = 'closer' from public.profiles where id = :bob), 'eingeladener Benutzer = User');
select pg_temp.check((select not active and role_id = 'user' from public.profiles where id = :fremd), 'Selbst-Registrierung inaktiv, Rolle aus user_metadata zählt nicht');
select pg_temp.check((select role_id = 'restricted' from public.profiles where id = :dora), 'Rolle aus Einladung');

-- ---------- als Admin ----------
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';

select pg_temp.check(public.has_perm('manage_organization') and public.is_admin(), 'Admin hat alle Rechte');
select pg_temp.check(array_length(public.my_permissions(), 1) = array_length(public.all_permissions(), 1), 'my_permissions für Admin');

-- eigene Rolle anlegen
insert into public.roles (id, name, permissions, lead_visibility)
values ('opener', 'Opener', array['calling', 'delete_own_activities', 'calling'], 'own');
select pg_temp.check((select permissions = array['calling', 'delete_own_activities'] from public.roles where id = 'opener'), 'Rechte sortiert, doppelt entfernt');
select pg_temp.fails($$insert into public.roles (id, name, permissions) values ('x_role', 'X', array['fliegen'])$$, 'Unbekanntes Recht', 'unbekanntes Recht abgelehnt');
select pg_temp.fails($$delete from public.roles where id = 'user'$$, 'Vordefinierte Rollen', 'vordefinierte Rolle nicht löschbar');
select pg_temp.fails($$update public.roles set permissions = '{}' where id = 'admin'$$, 'Admin-Rolle', 'Admin-Rolle unveränderlich');

reset role;
insert into auth.users (id, email, raw_app_meta_data)
values (:emil, 'emil@firma.de', '{"crm_invited":true,"crm_role":"opener","crm_function":"opener"}');
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select pg_temp.check((select role_id = 'opener' from public.profiles where id = :emil), 'eigene Rolle bei Einladung');
select pg_temp.fails($$delete from public.roles where id = 'opener'$$, 'noch Personen zugewiesen', 'zugewiesene Rolle nicht löschbar');

insert into public.groups (id, name) values ('60000000-0000-0000-0000-000000000001', 'Opener-Team');
insert into public.group_members (group_id, user_id) values ('60000000-0000-0000-0000-000000000001', :emil);

-- geschütztes Feld
insert into public.custom_fields (key, entity, label, type, restricted) values ('provision', 'lead', 'Provision', 'number', true);

insert into public.leads (id, name, address_city, address_zip, status_id)
values (:l1, 'Löwen-Apotheke', 'Hanau', '63450', (select id from public.lead_statuses where label = 'Neu'));
insert into public.contacts (id, lead_id, name, phones, emails)
values ('20000000-0000-0000-0000-000000000001', :l1, 'Dr. Petra Muster',
        '[{"type":"office","number":"06181 / 12 34 56"},{"number":""}]', '[{"email":"  Info@Loewen.DE "}]');
insert into public.leads (id, name, owner_id, status_id)
values (:l2, 'Adler-Apotheke', :emil, (select id from public.lead_statuses where label = 'Neu'));
insert into public.contacts (lead_id, name, phones) values (:l2, 'Herr Adler', '[{"number":"030 555 777"}]');

select pg_temp.check((select phones = '[{"type":"office","number":"+496181123456"}]'::jsonb from public.contacts where id = '20000000-0000-0000-0000-000000000001'), 'Kontakt-Nummer normalisiert, leere entfernt');
select pg_temp.check((select search_text like '%06181123456%' and search_text like '%petra%' and search_text like '%hanau%' from public.leads where id = :l1), 'Suchtext enthält Nummer, Kontakt, Ort');
select pg_temp.check((select count(*) = 1 from public.lead_events where lead_id = :l1 and type = 'created'), 'Verlauf: Lead angelegt');

-- ---------- als Bob (User) ----------
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select pg_temp.check((select count(*) = 2 from public.leads), 'User sieht alle Leads');
select pg_temp.check('calling' = any (public.my_permissions()) and not public.has_perm('bulk_edit'), 'User-Rechte');
select pg_temp.check(not public.is_admin(), 'User ist kein Admin');

update public.leads set status_id = (select id from public.lead_statuses where label = 'Wiedervorlage') where id = :l1;
select pg_temp.check((select count(*) = 1 from public.lead_events where type = 'status' and user_id = :bob), 'Statuswechsel im Verlauf mit Benutzer');

select pg_temp.fails($$update public.leads set custom = '{"provision": 5}' where id = '10000000-0000-0000-0000-000000000001'$$,
                     'geschützt', 'geschütztes Feld nur mit Recht');
update public.leads set custom = '{"inhaber": "Petra Muster"}' where id = :l1;
select pg_temp.check((select custom ->> 'inhaber' = 'Petra Muster' from public.leads where id = :l1), 'normales Feld änderbar');

select pg_temp.fails($$update public.profiles set role_id = 'admin' where id = '00000000-0000-0000-0000-00000000000b'$$,
                     'Nur Admins', 'User kann sich nicht zum Admin machen');
select pg_temp.fails($$insert into public.roles (id, name) values ('hack', 'Hack')$$, 'row-level security', 'User darf keine Rollen anlegen');
update public.profiles set full_name = 'Bob B.', available = false where id = :bob;
select pg_temp.check((select full_name = 'Bob B.' and not available from public.profiles where id = :bob), 'eigenes Profil ändern');

update public.org_settings set recording_mode = 'auto' where id = 1;
select pg_temp.check((select recording_mode = 'manual' from public.org_settings), 'User kann Einstellungen nicht ändern');

select pg_temp.fails($$select public.kv_get('x')$$, 'permission denied', 'Geheimnisse für Benutzer gesperrt');
select pg_temp.fails($$select public.bulk_update_leads(array['10000000-0000-0000-0000-000000000001'::uuid], '{"source":"x"}')$$,
                     'Sammelbearbeitung', 'User ohne Sammelbearbeitung');

-- Anrufe → Kennzahlen am Lead
insert into public.calls (lead_id, contact_id, user_id, direction, outcome, started_at, duration)
values (:l1, '20000000-0000-0000-0000-000000000001', :bob, 'outbound', 'nicht_erreicht', now() - interval '2 hours', 0);
insert into public.calls (id, lead_id, user_id, direction, started_at, duration, recording_path, recording_status, twilio_call_sid)
values ('30000000-0000-0000-0000-000000000002', :l1, :bob, 'outbound', now() - interval '1 hour', 185,
        '2026/10/30000000-0000-0000-0000-000000000002-RE1.wav', 'ready', 'CAfake');
select pg_temp.check((select recording_path is null and recording_status = 'none' and twilio_call_sid is null
                             and status = 'completed' and ended_at is not null and duration = 185
                        from public.calls where id = '30000000-0000-0000-0000-000000000002'),
                     'von Hand protokollierter Anruf: ohne Technik-Felder, nie „läuft gerade“');
select pg_temp.check((select call_count = 2 and last_call_outcome = 'nicht_erreicht' and last_connected_at is null and opener_id is null
                        from public.leads where id = :l1), 'Anrufzähler');
update public.calls set outcome = 'setting_gelegt', note = 'Termin Do 10 Uhr' where id = '30000000-0000-0000-0000-000000000002';
select pg_temp.check((select last_call_outcome = 'setting_gelegt' and last_connected_at is not null and opener_id = :bob
                        from public.leads where id = :l1), 'Setting gelegt → erreicht + Opener');
reset role;
-- wie der Server: Aufnahme ablegen
update public.calls set recording_path = '2026/10/30000000-0000-0000-0000-000000000002-RE1.wav', recording_status = 'ready',
                        recording_duration = 185, answered_at = now() - interval '1 hour'
 where id = '30000000-0000-0000-0000-000000000002';
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
update public.calls set duration = 9999, status = 'failed', recording_path = '2026/10/anders.wav', user_id = :ada,
                        note = 'Termin Do 11 Uhr'
 where id = '30000000-0000-0000-0000-000000000002';
select pg_temp.check((select duration = 185 and status = 'completed' and recording_path like '%-RE1.wav' and user_id = :bob
                             and note = 'Termin Do 11 Uhr'
                        from public.calls where id = '30000000-0000-0000-0000-000000000002'),
                     'Gesprächsdauer, Status, Aufnahme und Person nicht änderbar – Notiz schon');
reset role;
insert into public.call_insights (call_id, talk, transcript_text)
values ('30000000-0000-0000-0000-000000000002', '{"agent_ms":1000}', 'Guten Tag, hier ist Bob');
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select pg_temp.check(public.can_read_recording('2026/10/30000000-0000-0000-0000-000000000002-RE1.wav'), 'eigene Aufnahme hörbar');
select pg_temp.check((select count(*) = 1 from public.call_insights), 'eigene Abschrift lesbar');
select pg_temp.check(not public.can_read_recording('2026/10/kaputt.wav'), 'unbekannte Datei nicht lesbar');

-- Aufgaben
insert into public.tasks (id, lead_id, assigned_to, title, due_at)
values ('40000000-0000-0000-0000-000000000001', :l1, :bob, 'Rückruf', now() + interval '1 day');
select pg_temp.check((select next_task_due is not null from public.leads where id = :l1), 'nächste Aufgabe gesetzt');
update public.tasks set done = true where id = '40000000-0000-0000-0000-000000000001';
select pg_temp.check((select done_at is not null and done_by = :bob from public.tasks where id = '40000000-0000-0000-0000-000000000001'), 'Aufgabe erledigt mit Zeit und Person');
select pg_temp.check((select next_task_due is null from public.leads where id = :l1), 'nächste Aufgabe zurückgesetzt');

-- Termine
insert into public.meetings (lead_id, source, external_id, title, starts_at, set_by, host_user_id)
values (:l1, 'calendly', 'inv-1', 'Erstgespräch', now() + interval '2 days', :bob, :ada);
select pg_temp.check((select next_meeting_at is not null from public.leads where id = :l1), 'nächster Termin gesetzt');

-- Notiz mit Erwähnung, Kommentar
insert into public.notes (lead_id, body, mentions) values (:l1, '@Ada Chefin ist dienstags da', array[:ada]::uuid[]);
insert into public.comments (lead_id, target_kind, target_id, body, at_ms)
values (:l1, 'call', '30000000-0000-0000-0000-000000000002', 'Ab hier gut', 42000);

-- Formular „Wiedervorlage / Follow-Up“: Aufgabe + Sperre
insert into public.custom_activities (type_id, lead_id, data)
values ((select id from public.activity_types where name = 'Wiedervorlage / Follow-Up'), :l1,
        jsonb_build_object('datum_uhrzeit', (now() + interval '3 days')::text, 'grund', 'Urlaub / abwesend', 'sperrdauer', '1 Woche'));
select pg_temp.check((select count(*) = 1 from public.tasks where lead_id = :l1 and not done and title = 'Wiedervorlage / Follow-Up'
                        and note like '%Grund: Urlaub / abwesend%' and assigned_to = :bob), 'Formular legt Wiedervorlage an');
select pg_temp.check((select (custom ->> 'gesperrt_bis')::date = (now() at time zone 'Europe/Berlin')::date + 7 from public.leads where id = :l1),
                     'Sperrdauer setzt „Gesperrt bis“');
select pg_temp.check((select count(*) = 1 from public.lead_timeline where lead_id = :l1 and kind = 'activity'), 'Formular im Verlauf');

-- Opportunity in Pipeline „Sales“
insert into public.opportunities (id, lead_id, status_id, value, value_period)
values ('50000000-0000-0000-0000-000000000001', :l1,
        (select s.id from public.opportunity_statuses s join public.pipelines p on p.id = s.pipeline_id
          where p.name = 'Sales' and s.label = 'Setting terminiert'), 2800, 'one_time');
update public.opportunities set status_id = (select s.id from public.opportunity_statuses s join public.pipelines p on p.id = s.pipeline_id
                                               where p.name = 'Sales' and s.label = '✅ Kunde')
 where id = '50000000-0000-0000-0000-000000000001';
select pg_temp.check((select closed_at is not null from public.opportunities where id = '50000000-0000-0000-0000-000000000001'), 'Abschlussdatum gesetzt');

-- Berichte
select pg_temp.check((select dials = 2 and reached = 1 and meetings_logged = 1 and talk_seconds = 185
                             and meetings_booked = 1 and deals_won = 1 and won_value = 2800 and opened_won = 1 and notes = 1
                             and tasks_done = 1 and forms = 1
                        from public.report_activity(now() - interval '1 day', now() + interval '1 day')
                       where user_id = :bob), 'Aktivitätsbericht');
select pg_temp.check((select count(*) >= 4 from public.report_activity(now() - interval '1 day', now() + interval '1 day')), 'User sieht Team-Bericht');
select pg_temp.check((select sum(dials) = 2 from public.report_daily(now() - interval '1 day', now() + interval '1 day')), 'Tagesbericht');
select pg_temp.check((select count(*) = 2 from public.report_outcomes(now() - interval '1 day', now() + interval '1 day')), 'Ergebnisbericht');
select pg_temp.check((select sum(cnt) = 1 from public.report_status_changes(now() - interval '1 day', now() + interval '1 day')), 'Statuswechsel-Bericht');
select pg_temp.check((select sum(dials) = 2 and sum(reached) = 1 from public.report_call_hours(now() - interval '1 day', now() + interval '1 day')), 'Anrufzeiten-Bericht');
select pg_temp.check((select reached = 1 from public.report_funnel(now() - interval '1 day', now() + interval '1 day',
                                                                 (select id from public.pipelines where name = 'Sales')) f
                        join public.opportunity_statuses s on s.id = f.status_id where s.label = 'Setting terminiert'), 'Trichter: Stufe erreicht');
select pg_temp.check((select cnt = 1 from public.report_form_values((select id from public.activity_types where name = 'Wiedervorlage / Follow-Up'),
                                                                      'grund', now() - interval '1 day', now() + interval '1 day')
                       where value = 'Urlaub / abwesend'), 'Formular-Auswertung');

-- Power Dialer Reservierung
select pg_temp.check(public.dialer_claim(:l1), 'Bob reserviert Lead');

-- ---------- als Ada: Benachrichtigungen ----------
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select pg_temp.check((select count(*) = 1 from public.notifications where user_id = :ada and kind = 'mention'), 'Erwähnung → Benachrichtigung');
select pg_temp.check((select notifications_new = 1 from public.inbox_counts()), 'Inbox-Zähler');
select pg_temp.check(not public.dialer_claim(:l1), 'Ada kann reservierten Lead nicht nehmen');

-- ---------- als Bob: Kommentar-Benachrichtigung von Ada ----------
insert into public.comments (lead_id, target_kind, target_id, body)
values (:l1, 'call', '30000000-0000-0000-0000-000000000002', 'Starker Einstieg!');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select pg_temp.check((select count(*) = 1 from public.notifications where user_id = :bob and kind = 'comment'), 'Kommentar → Benachrichtigung an Anrufer');
select pg_temp.check((select count(*) = 0 from public.notifications where user_id = :ada), 'fremde Benachrichtigungen unsichtbar');
select public.dialer_release(:l1);

-- ---------- als Emil (eigene Rolle „Opener“: nur eigene Leads) ----------
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000e';
select pg_temp.check((select count(*) = 1 and min(name) = 'Adler-Apotheke' from public.leads), 'Opener sieht nur eigene Leads');
select pg_temp.check((select count(*) = 1 from public.contacts), 'Opener sieht nur Kontakte eigener Leads');
select pg_temp.check((select count(*) = 0 from public.calls), 'Opener sieht fremde Anrufe nicht');
select pg_temp.check((select count(*) = 0 from public.lead_timeline where lead_id = :l1), 'Opener sieht fremden Verlauf nicht');
update public.leads set name = 'Gehackt' where id = :l1;
reset role;
select pg_temp.check((select name = 'Löwen-Apotheke' from public.leads where id = :l1), 'Opener kann fremden Lead nicht ändern');
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000e';
select pg_temp.check(not public.dialer_claim(:l1), 'Opener kann fremden Lead nicht reservieren');
select pg_temp.check(not public.can_read_recording('2026/10/30000000-0000-0000-0000-000000000002-RE1.wav'), 'Opener hört fremde Aufnahme nicht');
select pg_temp.check((select count(*) = 1 from public.report_activity(now() - interval '1 day', now() + interval '1 day')), 'ohne Team-Berichte nur eigene Zeile');
select pg_temp.fails($$select public.merge_leads('10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002')$$,
                     'Keine Berechtigung', 'Opener darf nicht zusammenführen');
insert into public.leads (name, owner_id) values ('Emils neuer Lead', '00000000-0000-0000-0000-00000000000e');
select pg_temp.check((select count(*) = 2 from public.leads), 'Opener legt eigenen Lead an');

-- ---------- als Dora (Eingeschränkt) ----------
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000d';
select pg_temp.check((select count(*) = 3 from public.leads), 'Eingeschränkt sieht alle Leads');
select pg_temp.check(not public.can_read_recording('2026/10/30000000-0000-0000-0000-000000000002-RE1.wav'), 'Eingeschränkt hört fremde Aufnahme nicht');
select pg_temp.check((select count(*) = 0 from public.call_insights), 'Eingeschränkt liest fremde Abschrift nicht');
delete from public.leads where id = :l2;
select pg_temp.check((select count(*) = 3 from public.leads), 'Eingeschränkt darf keine Leads löschen');
select pg_temp.fails($$select public.delete_recording('30000000-0000-0000-0000-000000000002')$$, 'nicht gefunden', 'Eingeschränkt löscht keine Aufnahmen');
delete from public.notes where lead_id = '10000000-0000-0000-0000-000000000001';
select pg_temp.check((select count(*) = 1 from public.notes), 'fremde Notiz nicht löschbar');

-- ---------- als Sue (Super User) ----------
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000f';
select pg_temp.check(not public.is_admin() and public.has_perm('bulk_edit'), 'Super User ohne Organisation, mit Sammelbearbeitung');
update public.org_settings set call_script = 'Guten Tag, hier ist …' where id = 1;
select pg_temp.check((select call_script like 'Guten Tag%' from public.org_settings), 'Super User ändert Gesprächsleitfaden');
select pg_temp.fails($$update public.org_settings set recording_mode = 'auto' where id = 1$$, 'Organisation verwaltet', 'Super User ändert keine Aufnahme-Einstellung');
select pg_temp.check(public.bulk_update_leads(array[:l1, :l2]::uuid[], jsonb_build_object('owner_id', :bob, 'custom', '{"provision": 3}'::jsonb)) = 2, 'Sammelbearbeitung');
select pg_temp.check((select count(*) = 2 from public.leads where owner_id = :bob and (custom ->> 'provision')::int = 3), 'Sammelbearbeitung wirkt, geschütztes Feld mit Recht');
select pg_temp.fails($$select public.bulk_update_leads(array['10000000-0000-0000-0000-000000000001'::uuid], '{"custom":"x"}')$$, 'Feldwerte', 'Sammelbearbeitung prüft Feldwerte');
select pg_temp.fails($$select public.bulk_update_leads(array['10000000-0000-0000-0000-000000000001'::uuid], '{"name":"x"}')$$, 'nicht gesammelt', 'Sammelbearbeitung nur erlaubte Felder');
select pg_temp.check((select count(*) = 2 from public.lead_events where type = 'owner' and user_id = :sue), 'Zuständigkeitswechsel im Verlauf');
select pg_temp.check((select count(*) >= 1 from public.live_calls()) is not null, 'live_calls aufrufbar');

-- Dubletten & Zusammenführen
insert into public.leads (id, name, address_zip) values (:l3, 'Loewen Apotheke', '63450');
insert into public.contacts (lead_id, name, phones) values (:l3, 'Petra', '[{"number":"+49 6181 123456"}]');
insert into public.notes (lead_id, body) values (:l3, 'Notiz am doppelten Lead');
select pg_temp.check((select reasons like '%Telefonnummer%' from public.find_duplicate_leads(:l1)), 'Dublette über Nummer gefunden');
select public.merge_leads(:l1, :l3);
select pg_temp.check((select count(*) = 0 from public.leads where id = :l3), 'zusammengeführter Lead entfernt');
select pg_temp.check((select count(*) = 2 from public.contacts where lead_id = :l1), 'Kontakte übernommen');
select pg_temp.check((select count(*) = 2 from public.notes where lead_id = :l1), 'Notizen übernommen');
select pg_temp.check((select count(*) = 1 from public.lead_events where lead_id = :l1 and type = 'merged'), 'Zusammenführen im Verlauf');
select pg_temp.check((select count(*) = 0 from public.find_duplicate_leads(:l1)), 'keine Dublette mehr');

-- ---------- Workflows (als Ada) ----------
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
insert into public.workflows (id, name, status, trigger, steps, goal)
values ('70000000-0000-0000-0000-000000000001', 'Wiedervorlage nachfassen', 'active',
        jsonb_build_object('type', 'status_changed', 'value', (select id from public.lead_statuses where label = 'Wiedervorlage')),
        '[{"id":"s1","type":"task","wait":{"amount":2,"unit":"days"},"config":{"title":"Nachfassen"}}]',
        jsonb_build_object('type', 'status', 'value', (select id from public.lead_statuses where label = 'Kunde')));
update public.leads set status_id = (select id from public.lead_statuses where label = 'Wiedervorlage') where id = :l2;
select pg_temp.check((select count(*) = 1 and min(next_at) > now() + interval '47 hours' from public.workflow_runs
                       where lead_id = :l2 and status = 'active'), 'Auslöser startet Workflow mit Wartezeit');
update public.leads set status_id = (select id from public.lead_statuses where label = 'Kunde') where id = :l2;
select pg_temp.check((select status = 'goal_met' from public.workflow_runs where lead_id = :l2), 'Ziel erreicht beendet Workflow');
select pg_temp.check(public.workflow_enroll('70000000-0000-0000-0000-000000000001', array[:l1]::uuid[]) = 1, 'von Hand aufnehmen');
select pg_temp.check(public.workflow_enroll('70000000-0000-0000-0000-000000000001', array[:l1]::uuid[]) = 0, 'nicht doppelt aufnehmen');
select public.workflow_run_set_status((select id from public.workflow_runs where lead_id = :l1), 'paused');
select pg_temp.check((select status = 'paused' from public.workflow_runs where lead_id = :l1), 'Workflow anhalten');

-- Admin: Aufnahmen löschen, letzter Admin bleibt
select pg_temp.check(public.can_read_recording('2026/10/30000000-0000-0000-0000-000000000002-RE1.wav'), 'Admin darf Aufnahme hören');
select public.delete_recording('30000000-0000-0000-0000-000000000002');
select pg_temp.check((select recording_status = 'deleted' and recording_path is null from public.calls where id = '30000000-0000-0000-0000-000000000002'), 'Aufnahme gelöscht');
reset role;
select pg_temp.check((select count(*) = 1 from public.storage_trash where path like '%RE1.wav'), 'Datei zum Löschen vorgemerkt');
select pg_temp.check((select count(*) = 0 from public.call_insights), 'Abschrift mitgelöscht');
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select pg_temp.fails($$update public.profiles set role_id = 'user' where id = '00000000-0000-0000-0000-00000000000a'$$,
                     'mindestens ein aktiver Admin', 'letzter Admin bleibt Admin');
update public.org_settings set recording_mode = 'auto' where id = 1;
select pg_temp.check((select recording_mode = 'auto' from public.org_settings), 'Admin ändert Einstellungen');
select pg_temp.check((public.admin_jobs_state() ->> 'scheduled')::boolean = false, 'Admin sieht: Hintergrundaufgaben noch aus');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select pg_temp.check(public.admin_jobs_state() is null, 'Stand der Hintergrundaufgaben nur für Admins');
select pg_temp.fails($$select public.claim_recording_retries(1)$$, 'permission denied', 'Aufnahmen nachholen nur der Server');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';

-- ---------- inaktiver Benutzer ----------
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
select pg_temp.check((select count(*) = 0 from public.leads), 'inaktiver Benutzer sieht nichts');
select pg_temp.fails($$insert into public.leads (name) values ('Hack')$$, 'row-level security', 'inaktiver Benutzer kann nichts anlegen');

-- ---------- Gast ----------
reset role;
set role anon;
select pg_temp.fails($$select 1 from public.leads$$, 'permission denied', 'Gast hat keinen Zugriff');

-- ---------- Server (service_role) ----------
reset role;
set role service_role;
insert into public.calls (id, direction, status) values ('30000000-0000-0000-0000-000000000099', 'outbound', 'initiated');
select public.call_status_advance('30000000-0000-0000-0000-000000000099', 'ringing', 'CAchild');
select public.call_status_advance('30000000-0000-0000-0000-000000000099', 'answered');
select pg_temp.check((select status = 'in-progress' and answered_at is not null and twilio_child_sid = 'CAchild'
                        from public.calls where id = '30000000-0000-0000-0000-000000000099'), 'Anruf angenommen');
select public.call_status_advance('30000000-0000-0000-0000-000000000099', 'completed', null, 42);
select public.call_status_advance('30000000-0000-0000-0000-000000000099', 'ringing', null, null);
select pg_temp.check((select status = 'completed' and duration = 42 and ended_at is not null
                        from public.calls where id = '30000000-0000-0000-0000-000000000099'), 'Status geht nicht rückwärts');
select public.kv_set('twilio_app_sid', 'AP123');
select pg_temp.check(public.kv_get('twilio_app_sid') = 'AP123', 'Server-Geheimnisse lesen/schreiben');
update public.workflow_runs set status = 'active', next_at = now() - interval '1 minute' where lead_id = :l1;
select pg_temp.check((select count(*) = 1 from public.workflow_claim_due(10)), 'fällige Workflow-Schritte reservieren');
select pg_temp.check((select count(*) = 0 from public.workflow_claim_due(10)), 'reservierte Schritte nicht doppelt');

reset role;
update public.calls set recording_path = '2026/10/x-RE9.wav' where id = '30000000-0000-0000-0000-000000000099';
delete from public.calls where id = '30000000-0000-0000-0000-000000000099';
select pg_temp.check((select count(*) = 1 from public.storage_trash where path = '2026/10/x-RE9.wav'), 'gelöschter Anruf → Datei vorgemerkt');
delete from public.leads where id = :l1;
select pg_temp.check((select count(*) = 0 from public.contacts where lead_id = :l1), 'Lead löschen entfernt Kontakte');
select pg_temp.check((select count(*) = 2 from public.calls where lead_id is null), 'Anrufe bleiben erhalten');


-- ---------- Server-Abläufe (Teil 5) ----------
reset role;
set role service_role;

-- Umzug aus Close: ohne Benachrichtigungen, ohne Workflows, Zeitstempel bleiben
insert into public.workflows (id, name, status, trigger, steps)
values ('70000000-0000-0000-0000-000000000009', 'Neu-Lead-Mail', 'active', '{"type":"lead_created"}', '[{"id":"s1","type":"task","wait":{"amount":0,"unit":"days"},"config":{"title":"Hallo"}}]');
select pg_temp.check(public.import_rows('leads', jsonb_build_array(jsonb_build_object(
  'id', '10000000-0000-0000-0000-000000000077', 'name', 'Import-Apotheke', 'owner_id', :emil::text,
  'created_at', '2024-03-01T10:00:00Z', 'custom', '{}'::jsonb, 'source', 'Close', '_ext', 'lead_abc')), 'lead') = 1, 'Import legt Lead an');
select pg_temp.check((select count(*) = 0 from public.notifications where lead_id = '10000000-0000-0000-0000-000000000077'), 'Import benachrichtigt niemanden');
select pg_temp.check((select count(*) = 0 from public.workflow_runs where lead_id = '10000000-0000-0000-0000-000000000077'), 'Import startet keine Workflows');
select pg_temp.check((select created_at = '2024-03-01T10:00:00Z' from public.lead_events where lead_id = '10000000-0000-0000-0000-000000000077' and type = 'created'), 'Import behält Datum im Verlauf');
select pg_temp.check((select local_id = '10000000-0000-0000-0000-000000000077' from public.import_map where kind = 'lead' and external_id = 'lead_abc'), 'Import merkt Close-ID');
select pg_temp.check(public.import_rows('leads', jsonb_build_array(jsonb_build_object(
  'id', '10000000-0000-0000-0000-000000000077', 'name', 'Doppelt', 'custom', '{}'::jsonb, '_ext', 'lead_abc')), 'lead') = 0, 'Import legt nichts doppelt an');
select public.import_rows('calls', jsonb_build_array(jsonb_build_object(
  'id', '30000000-0000-0000-0000-000000000077', 'lead_id', '10000000-0000-0000-0000-000000000077', 'direction', 'outbound',
  'status', 'completed', 'started_at', '2024-03-02T09:00:00Z', 'duration', 65, 'outcome', 'setting_gelegt', 'user_id', :emil::text)), 'call');
select pg_temp.check((select last_call_at = '2024-03-02T09:00:00Z' and call_count = 1 and opener_id = :emil
                        and last_activity_at = '2024-03-02T09:00:00Z' from public.leads where id = '10000000-0000-0000-0000-000000000077'),
                     'Import: Anruf zählt mit altem Datum');
select pg_temp.check((select count(*) = 0 from public.workflow_runs where lead_id = '10000000-0000-0000-0000-000000000077'), 'Import: Anruf-Ergebnis startet nichts');
select pg_temp.fails($$select public.import_rows('profiles', '[{"id":"x"}]'::jsonb)$$, 'nicht vorgesehen', 'Import nur in erlaubte Tabellen');

-- verpasster Anruf: je Anruf nur eine Aufgabe
insert into public.tasks (title, type, call_id) values ('Verpasst', 'missed_call', '30000000-0000-0000-0000-000000000077');
select pg_temp.fails($$insert into public.tasks (title, type, call_id) values ('Nochmal', 'voicemail', '30000000-0000-0000-0000-000000000077')$$,
                     'duplicate key', 'verpasster Anruf nur einmal');

-- Sichtbarkeit für Server-Funktionen
select pg_temp.check(public.user_can_see_lead(:emil, '10000000-0000-0000-0000-000000000077'), 'Opener sieht eigenen Lead');
select pg_temp.check(not public.user_can_see_lead(:emil, :l2) or (select owner_id = :emil from public.leads where id = :l2), 'Opener sieht fremde Leads nicht');
select pg_temp.check(public.user_can_see_lead(:ada, '10000000-0000-0000-0000-000000000077'), 'Admin sieht alles');

-- geplante E-Mails nur einmal reservieren
insert into public.emails (id, lead_id, direction, status, to_address, subject, send_at)
values ('80000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000077', 'outbound', 'scheduled', 'a@b.de', 'Hallo', now() - interval '1 minute'),
       ('80000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000077', 'outbound', 'scheduled', 'a@b.de', 'Später', now() + interval '1 hour');
select pg_temp.check((select array_agg(x) = array['80000000-0000-0000-0000-000000000001'::uuid] from public.claim_scheduled_emails(10) x), 'fällige E-Mail reserviert');
select pg_temp.check((select count(*) = 0 from public.claim_scheduled_emails(10)), 'E-Mail nicht doppelt reserviert');

-- Abwesenheitsnotiz beendet keinen Workflow, echte Antwort schon
insert into public.workflow_runs (id, workflow_id, lead_id, status, next_at)
values ('71000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000009', '10000000-0000-0000-0000-000000000077', 'active', now() + interval '1 day');
update public.workflows set stop_on_reply = true where id = '70000000-0000-0000-0000-000000000009';
insert into public.emails (lead_id, direction, status, subject, auto_reply) values ('10000000-0000-0000-0000-000000000077', 'inbound', 'received', 'Abwesend', true);
select pg_temp.check((select status = 'active' from public.workflow_runs where id = '71000000-0000-0000-0000-000000000001'), 'Abwesenheitsnotiz ist keine Antwort');
insert into public.emails (lead_id, direction, status, subject) values ('10000000-0000-0000-0000-000000000077', 'inbound', 'received', 'Re: Hallo');
select pg_temp.check((select status = 'finished' from public.workflow_runs where id = '71000000-0000-0000-0000-000000000001'), 'Antwort beendet Workflow');

-- Löschfrist und hängengebliebene Anrufe
insert into public.calls (id, direction, status, started_at, recording_path, recording_status)
values ('30000000-0000-0000-0000-000000000078', 'outbound', 'completed', now() - interval '40 days', '2025/09/30000000-0000-0000-0000-000000000078-RE7.wav', 'ready'),
       ('30000000-0000-0000-0000-000000000079', 'outbound', 'in-progress', now() - interval '5 hours', null, 'none');
update public.calls set answered_at = now() - interval '5 hours' where id = '30000000-0000-0000-0000-000000000079';
select pg_temp.check(public.expire_recordings(30) = 1, 'alte Aufnahme abgelaufen');
select pg_temp.check((select recording_status = 'deleted' from public.calls where id = '30000000-0000-0000-0000-000000000078')
                     and (select count(*) = 1 from public.storage_trash where path like '%RE7.wav'), 'abgelaufene Aufnahme vorgemerkt');
insert into public.calls (id, direction, status, started_at, recording_status, recording_sid)
values ('30000000-0000-0000-0000-000000000089', 'outbound', 'in-progress', now() - interval '5 hours', 'recording', 'RE89');
select pg_temp.check(public.close_stale_calls() >= 2, 'hängengebliebener Anruf geschlossen');
select pg_temp.check((select status = 'completed' and ended_at is not null from public.calls where id = '30000000-0000-0000-0000-000000000079'), 'angenommen → abgeschlossen');
select pg_temp.check((select recording_status = 'recording' and ended_at is not null from public.calls where id = '30000000-0000-0000-0000-000000000089'),
                     'laufende Aufnahme bleibt zum Nachholen markiert');

-- Aufnahmen nachholen
insert into public.calls (id, direction, status, started_at, ended_at, recording_status, recording_sid, recording_attempts, recording_tried_at)
values
  -- Verarbeitung vor 20 Minuten begonnen und nie fertig geworden → nachholen
  ('30000000-0000-0000-0000-000000000081', 'outbound', 'completed', now() - interval '1 hour', now() - interval '50 minutes', 'processing', 'RE81', 1, now() - interval '20 minutes'),
  -- Verarbeitung läuft gerade → nicht anfassen
  ('30000000-0000-0000-0000-000000000082', 'outbound', 'completed', now() - interval '1 hour', now() - interval '50 minutes', 'processing', 'RE82', 1, now() - interval '2 minutes'),
  -- nach 1 Versuch fehlgeschlagen, vor 15 Minuten → nachholen (Pause 10 Minuten)
  ('30000000-0000-0000-0000-000000000083', 'outbound', 'completed', now() - interval '1 hour', now() - interval '50 minutes', 'failed', 'RE83', 1, now() - interval '15 minutes'),
  -- nach 2 Versuchen fehlgeschlagen, vor 15 Minuten → noch warten (Pause 20 Minuten)
  ('30000000-0000-0000-0000-000000000084', 'outbound', 'completed', now() - interval '1 hour', now() - interval '50 minutes', 'failed', 'RE84', 2, now() - interval '15 minutes'),
  -- vier Versuche → aufgegeben
  ('30000000-0000-0000-0000-000000000085', 'outbound', 'completed', now() - interval '3 hours', now() - interval '3 hours', 'failed', 'RE85', 4, now() - interval '2 hours'),
  -- Gespräch seit 30 Minuten vorbei, Meldung „Aufnahme fertig“ kam nie → nachholen
  ('30000000-0000-0000-0000-000000000086', 'inbound', 'completed', now() - interval '40 minutes', now() - interval '30 minutes', 'recording', null, 0, null),
  -- Gespräch läuft noch → nicht anfassen
  ('30000000-0000-0000-0000-000000000087', 'inbound', 'in-progress', now() - interval '40 minutes', null, 'recording', 'RE87', 0, null),
  -- älter als 7 Tage → nicht mehr
  ('30000000-0000-0000-0000-000000000088', 'outbound', 'completed', now() - interval '8 days', now() - interval '8 days', 'failed', 'RE88', 1, now() - interval '8 days'),
  -- im vierten Versuch abgebrochen → aufgeben, als fehlgeschlagen zeigen
  ('30000000-0000-0000-0000-000000000090', 'outbound', 'completed', now() - interval '2 hours', now() - interval '2 hours', 'processing', 'RE90', 4, now() - interval '20 minutes');
select pg_temp.check((select array_agg(x order by x) from public.claim_recording_retries(10) x)
                     = array['30000000-0000-0000-0000-000000000081', '30000000-0000-0000-0000-000000000083',
                             '30000000-0000-0000-0000-000000000086']::uuid[],
                     'Aufnahmen nachholen: abgebrochen, fehlgeschlagen (mit Pause), Meldung verloren');
select pg_temp.check((select recording_status = 'failed' and recording_error like '%mehreren Versuchen%'
                        from public.calls where id = '30000000-0000-0000-0000-000000000090'),
                     'nach vier Versuchen: fehlgeschlagen statt ewig „wird gespeichert“');
select pg_temp.check((select count(*) = 3 from public.calls
                       where id in ('30000000-0000-0000-0000-000000000081', '30000000-0000-0000-0000-000000000083', '30000000-0000-0000-0000-000000000086')
                         and recording_status = 'processing' and recording_tried_at > now() - interval '1 minute'),
                     'nachzuholende Aufnahmen reserviert');
select pg_temp.check((select count(*) = 0 from public.claim_recording_retries(10)), 'Aufnahmen nicht doppelt reserviert');

-- Spuren tauschen (als Person, die telefoniert hat)
reset role;
insert into public.calls (id, lead_id, user_id, direction, status, recording_path, recording_status, recording_channels, agent_channel, talk_agent_ms, talk_customer_ms)
values ('30000000-0000-0000-0000-000000000080', '10000000-0000-0000-0000-000000000077', :emil, 'outbound', 'completed',
        '2026/10/30000000-0000-0000-0000-000000000080-RE8.wav', 'ready', 2, 1, 1000, 3000);
insert into public.call_insights (call_id, peaks, talk, segments)
values ('30000000-0000-0000-0000-000000000080', '{"bucket_ms":50,"agent":[1,2],"customer":[9,9]}',
        '{"agent_ms":1000,"customer_ms":3000,"switches":4}', '[{"speaker":"agent","start":0,"end":500,"text":"Hallo"}]');
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000e';
select public.swap_recording_channels('30000000-0000-0000-0000-000000000080');
select pg_temp.check((select agent_channel = 2 and talk_agent_ms = 3000 and talk_customer_ms = 1000 from public.calls where id = '30000000-0000-0000-0000-000000000080'), 'Spuren getauscht');
select pg_temp.check((select peaks -> 'agent' = '[9,9]'::jsonb and talk ->> 'agent_ms' = '3000' and talk ->> 'switches' = '4'
                             and segments -> 0 ->> 'speaker' = 'customer'
                        from public.call_insights where call_id = '30000000-0000-0000-0000-000000000080'), 'Wellenform, Redeanteile und Abschrift getauscht');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000d';
select pg_temp.fails($$select public.swap_recording_channels('30000000-0000-0000-0000-000000000080')$$, 'nicht gefunden', 'fremde Aufnahme nicht tauschbar');
reset role;

select 'ALLE DATENBANK-TESTS BESTANDEN' as ergebnis;
