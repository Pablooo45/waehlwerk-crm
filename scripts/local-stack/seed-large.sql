-- Große Testmenge für Leistungsmessungen (scripts/local-stack.sh large): 20.000 Leads mit Kontakten,
-- rund 60.000 Anrufen, Notizen, offenen Aufgaben und Feldwerten. Nur zum Testen.
set statement_timeout = 0;
select set_config('crm.import', 'on', false);  -- keine Workflows, Benachrichtigungen oder Verlaufseinträge

do $$
declare
  v_admin    uuid := (select id from public.profiles where email = 'admin@waehlwerk.test');
  v_mia      uuid := (select id from public.profiles where email = 'mia@waehlwerk.test');
  v_statuses uuid[] := array(select id from public.lead_statuses order by sort);
  v_outcomes text[] := array(select key from public.call_outcomes order by sort);
  v_states   text[] := array['Bayern', 'Hessen', 'Nordrhein-Westfalen', 'Sachsen', 'Baden-Württemberg', 'Niedersachsen'];
  v_cities   text[] := array['Köln', 'Bonn', 'Hanau', 'Frankfurt am Main', 'München', 'Berlin', 'Leipzig', 'Nürnberg', 'Kassel'];
begin
  insert into public.leads (name, status_id, owner_id, opener_id, address_city, address_zip, address_street, url, custom, created_by, created_at)
  select 'Lastapotheke ' || g || ' ' || v_cities[1 + g % 9],
         v_statuses[1 + (g * 7) % array_length(v_statuses, 1)],
         case g % 4 when 0 then v_mia when 1 then v_admin else null end,
         case g % 5 when 0 then v_mia else null end,
         v_cities[1 + g % 9],
         lpad(((g * 37) % 99000 + 1000)::text, 5, '0'),
         'Hauptstraße ' || (g % 120 + 1),
         'last' || g || '.apotheke.test',
         jsonb_build_object('bundesland', v_states[1 + g % 6], 'anzahl_filialen', 1 + g % 4),
         v_admin,
         now() - ((g % 400) || ' days')::interval
  from generate_series(1, 20000) g;

  insert into public.contacts (lead_id, name, title, phones, emails, sort)
  select l.id, 'Dr. Kontakt ' || l.n, 'Inhaber',
         jsonb_build_array(jsonb_build_object('type', 'office', 'number', '+49' || (6100000000 + l.n)::text)),
         jsonb_build_array(jsonb_build_object('type', 'office', 'email', 'inhaber' || l.n || '@apotheke.test')),
         0
  from (select id, row_number() over (order by created_at, id) as n from public.leads where name like 'Lastapotheke %') l;

  -- drei Anrufe je Lead im Schnitt, verteilt über ein Jahr
  insert into public.calls (lead_id, user_id, direction, status, outcome, started_at, answered_at, ended_at, duration, note)
  select l.id, case when (l.n + k) % 3 = 0 then v_mia else v_admin end, 'outbound', 'completed',
         v_outcomes[1 + (l.n + k) % array_length(v_outcomes, 1)],
         now() - (((l.n * 13 + k * 97) % 365) || ' days')::interval - ((k * 37) || ' minutes')::interval,
         now() - (((l.n * 13 + k * 97) % 365) || ' days')::interval - ((k * 37) || ' minutes')::interval,
         now() - (((l.n * 13 + k * 97) % 365) || ' days')::interval - ((k * 37 - 3) || ' minutes')::interval,
         30 + (l.n * k) % 400,
         case when k = 1 then 'Inhaber kurz erreicht, Infos per Mail' else null end
  from (select id, row_number() over (order by created_at, id) as n from public.leads where name like 'Lastapotheke %') l
  cross join generate_series(1, 3) k
  where (l.n + k) % 4 <> 0;

  insert into public.notes (lead_id, user_id, body, created_at)
  select id, v_admin, 'Gesprächsnotiz für ' || name || ': Budget im Frühjahr, Entscheidung beim Inhaber.', now() - ((random() * 200)::int || ' days')::interval
  from public.leads where name like 'Lastapotheke %';

  insert into public.tasks (lead_id, assigned_to, title, due_at, done)
  select id, case when random() < 0.5 then v_mia else v_admin end, 'Wiedervorlage', now() + ((random() * 20 - 5)::int || ' days')::interval, false
  from public.leads where name like 'Lastapotheke %' and random() < 0.2;
end $$;

-- Kennzahlen der Leads (letzter Anruf, Anzahl, nächste Aufgabe, letzte Aktivität) in einem Rutsch
update public.leads l set
  last_call_at   = c.last_call,
  call_count     = c.n
from (select lead_id, max(started_at) as last_call, count(*) as n from public.calls group by lead_id) c
where c.lead_id = l.id;
update public.leads l set last_call_outcome = c.outcome
from (select distinct on (lead_id) lead_id, outcome from public.calls order by lead_id, started_at desc) c
where c.lead_id = l.id;
update public.leads l set next_task_due = t.due
from (select lead_id, min(due_at) as due from public.tasks where not done group by lead_id) t
where t.lead_id = l.id;
update public.leads set last_activity_at = greatest(last_call_at, created_at) where name like 'Lastapotheke %';
analyze;
