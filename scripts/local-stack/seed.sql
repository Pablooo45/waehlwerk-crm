-- Testdaten für die lokale Umgebung (scripts/local-stack.sh). Nur zum Testen.
do $$
declare
  v_admin uuid := (select id from public.profiles where email = 'admin@waehlwerk.test');
  v_mia   uuid := (select id from public.profiles where email = 'mia@waehlwerk.test');
  v_neu   uuid := (select id from public.lead_statuses where is_default limit 1);
begin
  insert into public.leads (name, status_id, owner_id, address_city, address_zip, created_by) values
    ('Adler-Apotheke',  v_neu, v_mia,   'Köln',    '50667', v_admin),
    ('Bären-Apotheke',  v_neu, v_mia,   'Bonn',    '53111', v_admin),
    ('Linden-Apotheke', v_neu, v_admin, 'Hanau',   '63450', v_admin),
    ('Stern-Apotheke',  v_neu, null,    'Maintal', '63477', v_admin);
  insert into public.contacts (lead_id, name, phones, emails, sort)
  select l.id, 'Dr. ' || split_part(l.name, '-', 1) || ' Muster',
         jsonb_build_array(jsonb_build_object('type', 'office', 'number', '+49691000' || lpad(n::text, 3, '0'))),
         jsonb_build_array(jsonb_build_object('type', 'office', 'email', lower(split_part(l.name, '-', 1)) || '@apotheke.test')),
         0
  from (select l.*, row_number() over (order by l.name) as n from public.leads l) l;
  -- viele Leads, um Seiten und Grenzen zu prüfen (PostgREST liefert höchstens 1000 Zeilen)
  insert into public.leads (name, status_id, owner_id, address_zip, created_by)
  select 'Testapotheke ' || g, v_neu, case when g % 3 = 0 then v_mia else v_admin end, lpad((10000 + g)::text, 5, '0'), v_admin
  from generate_series(1, 2500) g;
  -- Zuweisungs-Hinweise aus dem Anlegen der Testdaten nicht in die Inbox
  delete from public.notifications;
end $$;
