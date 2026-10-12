-- Dubletten zu einem einzelnen Lead schnell finden (Hinweis auf der Lead-Seite).
-- Bisher wurden dafür alle Paare im ganzen Bestand gebildet und erst danach gefiltert – bei 20.000 Leads über
-- eine Sekunde bei jedem Öffnen eines Leads. Jetzt sucht die Funktion gezielt nach den Nummern, Adressen und
-- dem Namen dieses einen Leads. Ohne Lead (Einstellungen → Dubletten) wie bisher über den ganzen Bestand.
--
-- Die Funktion läuft mit erweiterten Rechten, damit die Indizes auf Telefonnummern und E-Mail-Adressen greifen
-- (unter Zeilenrechten darf PostgreSQL sie für diese Vergleiche nicht nutzen). Wer welche Leads sieht, prüft sie
-- deshalb selbst: Paare nur aus Leads, die die angemeldete Person sehen darf (can_see_lead).

create or replace function public.find_duplicate_leads(p_lead uuid default null, p_limit int default 200)
returns table (lead_a uuid, lead_b uuid, reasons text)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_limit int := greatest(1, least(coalesce(p_limit, 200), 2000));
  v_found text[] := '{}';  -- „<anderer Lead>|<Grund>“
  v       text;
begin
  if not public.is_member() then
    return;
  end if;
  if p_lead is null then
    return query
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
     where not exists (select 1 from public.duplicate_dismissals d where d.lead_a = p.x and d.lead_b = p.y)
       and public.can_see_lead(p.x) and public.can_see_lead(p.y)
     group by p.x, p.y
     order by p.x, p.y
     limit v_limit;
    return;
  end if;
  if not public.can_see_lead(p_lead) then
    return;
  end if;

  -- je eigener Nummer/Adresse eine gezielte Abfrage, damit die Indizes greifen
  foreach v in array array(
    select distinct p ->> 'number' from public.contacts c cross join lateral jsonb_array_elements(c.phones) p
     where c.lead_id = p_lead and coalesce(p ->> 'number', '') like '+%')
  loop
    v_found := v_found || array(
      select c.lead_id::text || '|gleiche Telefonnummer' from public.contacts c
       where c.phones @> jsonb_build_array(jsonb_build_object('number', v)) and c.lead_id <> p_lead);
  end loop;
  foreach v in array array(
    select distinct x from public.contacts c cross join lateral jsonb_array_elements(c.emails) e
     cross join lateral unnest(array[e ->> 'email', lower(e ->> 'email')]) x
     where c.lead_id = p_lead and coalesce(e ->> 'email', '') like '%@%')
  loop
    v_found := v_found || array(
      select c.lead_id::text || '|gleiche E-Mail-Adresse' from public.contacts c
       where c.emails @> jsonb_build_array(jsonb_build_object('email', v)) and c.lead_id <> p_lead);
  end loop;
  v_found := v_found || array(
    select l.id::text || '|gleicher Name und PLZ'
      from public.leads me
      join public.leads l on l.address_zip = me.address_zip
                         and regexp_replace(lower(l.name), '[^a-z0-9äöüß]', '', 'g') = regexp_replace(lower(me.name), '[^a-z0-9äöüß]', '', 'g')
     where me.id = p_lead and coalesce(me.address_zip, '') <> '' and l.id <> p_lead);

  return query
  with pairs as (
    select least(p_lead, split_part(f, '|', 1)::uuid) as x, greatest(p_lead, split_part(f, '|', 1)::uuid) as y, split_part(f, '|', 2) as reason
      from unnest(v_found) f)
  select p.x, p.y, string_agg(distinct p.reason, ', ' order by p.reason)
    from pairs p
   where not exists (select 1 from public.duplicate_dismissals d where d.lead_a = p.x and d.lead_b = p.y)
     and public.can_see_lead(case when p.x = p_lead then p.y else p.x end)
   group by p.x, p.y
   order by p.x, p.y
   limit v_limit;
end $$;

revoke all on function public.find_duplicate_leads(uuid, int) from public, anon;
grant execute on function public.find_duplicate_leads(uuid, int) to authenticated, service_role;
