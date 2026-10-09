-- =====================================================================
--  Wählwerk CRM – Datenbank, Teil 1: Tabellen und Abläufe
--  Ausführen: automatisch über GitHub Actions (`supabase db push`).
--  Teil 2 (Funktionen), Teil 3 (Rechte) und Teil 4 (Startwerte) folgen
--  in den weiteren Dateien dieses Ordners.
-- =====================================================================

create extension if not exists pg_trgm with schema extensions;

-- ---------------------------------------------------------------------
--  Privater Speicher für Server-Geheimnisse (nur Edge Functions)
-- ---------------------------------------------------------------------
create schema if not exists private;
revoke all on schema private from public;

create table private.kv (
  key        text primary key,
  value      text not null,
  updated_at timestamptz not null default now()
);

create or replace function public.kv_get(p_key text)
returns text language sql stable security definer set search_path = '' as $$
  select value from private.kv where key = p_key
$$;

create or replace function public.kv_set(p_key text, p_value text)
returns void language sql security definer set search_path = '' as $$
  insert into private.kv (key, value) values (p_key, p_value)
  on conflict (key) do update set value = excluded.value, updated_at = now()
$$;

revoke all on function public.kv_get(text) from public, anon, authenticated;
revoke all on function public.kv_set(text, text) from public, anon, authenticated;
grant execute on function public.kv_get(text) to service_role;
grant execute on function public.kv_set(text, text) to service_role;

-- ---------------------------------------------------------------------
--  Telefonnummern normalisieren (+49…). Gleiche Logik wie _shared/phone.ts
-- ---------------------------------------------------------------------
create or replace function public.normalize_phone(p text)
returns text language plpgsql immutable as $$
declare
  s text;
  d text;
begin
  if p is null then return null; end if;
  s := regexp_replace(p, '\(\s*0\s*\)', '', 'g');
  s := regexp_replace(s, '[^0-9+]', '', 'g');
  if s = '' or s = '+' then return null; end if;
  if left(s, 1) = '+' then
    d := '+' || regexp_replace(substr(s, 2), '[^0-9]', '', 'g');
  elsif left(s, 2) = '00' then
    d := '+' || substr(s, 3);
  elsif left(s, 1) = '0' then
    d := '+49' || substr(s, 2);
  elsif left(s, 2) = '49' and length(s) >= 11 then
    d := '+' || s;
  else
    d := '+49' || s;
  end if;
  -- Verkehrsausscheidungsziffer nach Ländervorwahl entfernen (+49 0 69 → +49 69)
  if d ~ '^\+(49|43|41)0' then
    d := left(d, 3) || substr(d, 5);
  end if;
  if length(d) < 8 or length(d) > 16 then return null; end if;
  return d;
end $$;

-- Ziffern-Varianten für die Suche: +49691234 → "49691234 0691234"
create or replace function public.phone_search_variants(p text)
returns text language sql immutable as $$
  select case
    when p is null then ''
    when p like '+49%' then substr(p, 2) || ' 0' || substr(p, 4)
    else regexp_replace(p, '[^0-9]', '', 'g')
  end
$$;

-- ---------------------------------------------------------------------
--  Rollen & Rechte (wie in Close: Admin, Super User, User, Eingeschränkt
--  und beliebig viele eigene Rollen)
-- ---------------------------------------------------------------------
create or replace function public.all_permissions()
returns text[] language sql immutable as $$
  select array[
    -- Organisation
    'manage_organization', 'manage_customizations', 'manage_phone_numbers',
    'manage_team_smart_views', 'manage_team_templates', 'manage_workflows',
    -- Sammelaktionen & Daten
    'bulk_edit', 'bulk_delete', 'bulk_email', 'bulk_workflow', 'import', 'export',
    -- Leads
    'delete_leads', 'merge_leads', 'edit_restricted_fields',
    -- Aktivitäten, Opportunities, Aufgaben
    'manage_others_activities', 'delete_own_activities',
    'manage_others_opportunities', 'delete_own_opportunities',
    'manage_others_tasks', 'delete_own_tasks',
    -- Telefonie & Aufnahmen
    'calling', 'recordings_listen_all', 'recordings_download', 'recordings_delete',
    'call_coach_listen', 'call_coach_barge',
    -- Team & Auswertung
    'view_team_reports', 'view_others_inbox', 'use_ai'
  ]::text[]
$$;

create table public.roles (
  id              text primary key check (id ~ '^[a-z][a-z0-9_]{1,40}$'),
  name            text not null check (length(trim(name)) > 0),
  description     text not null default '',
  is_builtin      boolean not null default false,
  permissions     text[] not null default '{}',
  -- all = alle Leads, own = nur zugewiesene/selbst gelegte, own_and_unassigned = zusätzlich ohne Zuständigen
  lead_visibility text not null default 'all' check (lead_visibility in ('all', 'own', 'own_and_unassigned')),
  sort            int not null default 100,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------------
--  Benutzer und Gruppen
-- ---------------------------------------------------------------------
create table public.profiles (
  id             uuid primary key references auth.users (id) on delete cascade,
  email          text not null default '',
  full_name      text not null default '',
  role_id        text not null default 'user' references public.roles (id) on update cascade on delete restrict,
  team_function  text not null default 'opener'
                 check (team_function in ('opener', 'setter', 'closer', 'manager', 'other')),
  phone_number   text,                       -- eigene Absendernummer
  forward_number text,                       -- Handy für Weiterleitung
  forward_mode   text not null default 'never' check (forward_mode in ('never', 'no_answer', 'always')),
  available      boolean not null default true,  -- „Für Anrufe erreichbar“ (sonst Weiterleitung/Mailbox)
  active         boolean not null default false,
  color          text not null default '#2f6f5e',
  settings       jsonb not null default '{}'::jsonb,
  last_seen_at   timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index profiles_role_idx on public.profiles (role_id);

create table public.groups (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique check (length(trim(name)) > 0),
  color      text not null default '#5b6b7f',
  created_at timestamptz not null default now()
);

create table public.group_members (
  group_id uuid not null references public.groups (id) on delete cascade,
  user_id  uuid not null references public.profiles (id) on delete cascade,
  primary key (group_id, user_id)
);
create index group_members_user_idx on public.group_members (user_id);

-- Rechte-Helfer (werden in jeder Zugriffsregel benutzt)
create or replace function public.is_member()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.active)
$$;

create or replace function public.has_perm(p_perm text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
      from public.profiles pr
      join public.roles r on r.id = pr.role_id
     where pr.id = auth.uid() and pr.active
       and (r.id = 'admin' or p_perm = any (r.permissions)))
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.has_perm('manage_organization')
$$;

-- Welche Leads darf ich sehen? 'none' für Fremde
create or replace function public.lead_visibility()
returns text language sql stable security definer set search_path = '' as $$
  select coalesce((
    select case when r.id = 'admin' then 'all' else r.lead_visibility end
      from public.profiles pr
      join public.roles r on r.id = pr.role_id
     where pr.id = auth.uid() and pr.active), 'none')
$$;

create or replace function public.my_permissions()
returns text[] language sql stable security definer set search_path = '' as $$
  select case
    when r.id = 'admin' then public.all_permissions()
    else coalesce(r.permissions, '{}')
  end
    from public.profiles pr
    join public.roles r on r.id = pr.role_id
   where pr.id = auth.uid() and pr.active
$$;

-- Neuer Login → Profil. Der allererste Benutzer wird Admin.
-- Weitere Benutzer sind nur aktiv, wenn ein Admin sie angelegt hat
-- (app_metadata.crm_invited – das kann nur der Server setzen).
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_first   boolean;
  v_invited boolean := coalesce((new.raw_app_meta_data ->> 'crm_invited')::boolean, false);
  v_role    text := coalesce(new.raw_app_meta_data ->> 'crm_role', 'user');
  v_func    text := coalesce(new.raw_app_meta_data ->> 'crm_function', 'opener');
begin
  select not exists (select 1 from public.profiles) into v_first;
  if not exists (select 1 from public.roles where id = v_role) then
    v_role := 'user';
  end if;
  insert into public.profiles (id, email, full_name, role_id, team_function, active)
  values (
    new.id,
    lower(coalesce(new.email, '')),
    coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), split_part(coalesce(new.email, ''), '@', 1)),
    case when v_first then 'admin' else v_role end,
    case when v_func in ('opener', 'setter', 'closer', 'manager', 'other') then v_func else 'opener' end,
    v_first or v_invited
  );
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Nur „Organisation verwalten“ darf Rolle, Status, Funktion, Nummer ändern.
-- (security invoker: current_user ist hier die aufrufende Rolle)
create or replace function public.profiles_guard()
returns trigger language plpgsql as $$
begin
  if current_user in ('postgres', 'service_role', 'supabase_admin') or public.is_admin() then
    if old.role_id = 'admin' and (new.role_id <> 'admin' or not new.active)
       and not exists (select 1 from public.profiles p
                       where p.role_id = 'admin' and p.active and p.id <> old.id) then
      raise exception 'Es muss mindestens ein aktiver Admin bleiben.';
    end if;
  else
    if new.id <> auth.uid() then
      raise exception 'Keine Berechtigung.';
    end if;
    if new.role_id is distinct from old.role_id
       or new.active is distinct from old.active
       or new.team_function is distinct from old.team_function
       or new.phone_number is distinct from old.phone_number
       or new.email is distinct from old.email then
      raise exception 'Nur Admins dürfen Rolle, Status, Funktion oder Nummer ändern.';
    end if;
  end if;
  new.forward_number := public.normalize_phone(new.forward_number);
  new.updated_at := now();
  return new;
end $$;

create trigger profiles_guard before update on public.profiles
  for each row execute function public.profiles_guard();

-- Rollen: Admin bleibt unantastbar, Rechte nur aus dem Katalog
create or replace function public.roles_guard()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.is_builtin then
      raise exception 'Vordefinierte Rollen können nicht gelöscht werden.';
    end if;
    if exists (select 1 from public.profiles where role_id = old.id) then
      raise exception 'Die Rolle „%“ ist noch Personen zugewiesen.', old.name;
    end if;
    return old;
  end if;
  if tg_op = 'UPDATE' and old.id = 'admin'
     and current_user not in ('postgres', 'service_role', 'supabase_admin') then
    raise exception 'Die Admin-Rolle hat immer alle Rechte und kann nicht geändert werden.';
  end if;
  if tg_op = 'UPDATE' and new.id <> old.id then
    raise exception 'Die Kennung einer Rolle kann nicht geändert werden.';
  end if;
  if not (new.permissions <@ public.all_permissions()) then
    raise exception 'Unbekanntes Recht: %',
      (select string_agg(x, ', ') from unnest(new.permissions) x where not (x = any (public.all_permissions())));
  end if;
  new.permissions := (select coalesce(array_agg(distinct x order by x), '{}') from unnest(new.permissions) x);
  new.updated_at := now();
  return new;
end $$;

create trigger roles_guard before insert or update or delete on public.roles
  for each row execute function public.roles_guard();

-- ---------------------------------------------------------------------
--  Konfiguration
-- ---------------------------------------------------------------------
create table public.lead_statuses (
  id         uuid primary key default gen_random_uuid(),
  label      text not null unique,
  color      text not null default '#64748b',
  sort       int not null default 0,
  kind       text not null default 'open' check (kind in ('open', 'won', 'lost')),
  is_default boolean not null default false
);

create table public.call_outcomes (
  key                 text primary key check (key ~ '^[a-z0-9_]+$'),
  label               text not null,
  description         text not null default '',
  color               text not null default '#64748b',
  sort                int not null default 0,
  counts_as_connected boolean not null default false,
  is_meeting          boolean not null default false,
  next_status_id      uuid references public.lead_statuses (id) on delete set null,
  followup_days       int check (followup_days is null or followup_days between 0 and 365),
  active              boolean not null default true
);

create table public.pipelines (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique check (length(trim(name)) > 0),
  sort       int not null default 0,
  created_at timestamptz not null default now()
);

create table public.opportunity_statuses (
  id          uuid primary key default gen_random_uuid(),
  pipeline_id uuid not null references public.pipelines (id) on delete cascade,
  label       text not null,
  kind        text not null default 'open' check (kind in ('open', 'won', 'lost')),
  color       text not null default '#64748b',
  sort        int not null default 0,
  unique (pipeline_id, label)
);
create index opportunity_statuses_pipeline_idx on public.opportunity_statuses (pipeline_id, sort);

-- Eigene Felder für Leads, Kontakte und Opportunities
create table public.custom_fields (
  key          text primary key check (key ~ '^[a-z0-9_]+$'),
  entity       text not null default 'lead' check (entity in ('lead', 'contact', 'opportunity')),
  label        text not null,
  description  text not null default '',
  type         text not null default 'text'
               check (type in ('text', 'textarea', 'number', 'date', 'datetime', 'choice', 'multichoice',
                               'checkbox', 'url', 'user')),
  choices      jsonb not null default '[]'::jsonb,
  sort         int not null default 0,
  show_in_list boolean not null default false,
  restricted   boolean not null default false   -- nur mit Recht „Geschützte Felder bearbeiten“ änderbar
);

-- Formulare (in Close: Custom Activities), z. B. „Setting: Kundengewinnung“
create table public.activity_types (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(trim(name)) > 0),
  description text not null default '',
  color       text not null default '#2346a0',
  -- [{ "key": "ziel", "label": "Ziel", "type": "choice", "choices": [...], "required": false, "description": "" }]
  fields      jsonb not null default '[]'::jsonb,
  archived    boolean not null default false,
  sort        int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Integrations-Links (Lead-Seite): z. B. Google-Suche, Handelsregister
create table public.integration_links (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  url_template text not null check (url_template ~ '^https?://'),
  scope        text not null default 'lead' check (scope in ('lead', 'contact')),
  sort         int not null default 0,
  created_at   timestamptz not null default now()
);

create table public.org_settings (
  id                          int primary key default 1 check (id = 1),
  name                        text not null default 'Mein Vertriebsteam',
  currency                    text not null default 'EUR',
  default_caller_id           text,
  local_presence              boolean not null default false,
  -- Aufnahmen
  recording_mode              text not null default 'manual'
                              check (recording_mode in ('off', 'manual', 'auto', 'auto_agent')),
  recording_format            text not null default 'wav' check (recording_format in ('wav', 'mp3')),
  recording_retention_days    int check (recording_retention_days is null or recording_retention_days between 1 and 3650),
  recording_announcement      boolean not null default false,
  recording_announcement_text text not null default
    'Dieses Gespräch wird zu Qualitäts- und Schulungszwecken aufgezeichnet.',
  delete_twilio_recordings    boolean not null default true,
  transcription_enabled       boolean not null default false,
  summary_enabled             boolean not null default false,
  -- Telefonie
  conference_mode             boolean not null default false,  -- Mithören, Einflüstern, Übergabe mit Rücksprache
  allowed_prefixes            text[] not null default array['+49', '+43', '+41'],
  inbound_ring_timeout        int not null default 25 check (inbound_ring_timeout between 5 and 60),
  dialer_ring_timeout         int not null default 30 check (dialer_ring_timeout between 10 and 60),
  missed_call_tasks           boolean not null default true,
  voicemail_drop_outcome      text references public.call_outcomes (key) on update cascade on delete set null,
  voicemail_greeting_text     text not null default
    'Hallo, leider ist gerade niemand erreichbar. Bitte hinterlassen Sie nach dem Signalton Ihren Namen und Ihre Nummer. Wir rufen zurück.',
  voicemail_greeting_path     text,
  call_script                 text not null default '',
  dialer_skip_recent_minutes  int not null default 60 check (dialer_skip_recent_minutes between 0 and 10080),
  -- Termine
  meeting_status_id           uuid references public.lead_statuses (id) on delete set null,
  calendly_create_leads       boolean not null default true,
  calendly_links              jsonb not null default '[]'::jsonb,
  calendly_connected_at       timestamptz,
  gcal_calendars              jsonb not null default '[]'::jsonb,
  gcal_last_sync              timestamptz,
  gcal_last_error             text,
  updated_at                  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
--  Leads & Kontakte
-- ---------------------------------------------------------------------
create table public.leads (
  id                uuid primary key default gen_random_uuid(),
  name              text not null check (length(trim(name)) > 0),
  status_id         uuid references public.lead_statuses (id) on delete set null,
  owner_id          uuid references public.profiles (id) on delete set null,
  opener_id         uuid references public.profiles (id) on delete set null,
  url               text,
  description       text,
  address_street    text,
  address_zip       text,
  address_city      text,
  address_state     text,
  address_country   text default 'DE',
  source            text,
  custom            jsonb not null default '{}'::jsonb,
  do_not_call       boolean not null default false,
  last_call_at      timestamptz,
  last_call_outcome text references public.call_outcomes (key) on update cascade on delete set null,
  last_connected_at timestamptz,
  call_count        int not null default 0,
  last_activity_at  timestamptz,
  next_task_due     timestamptz,
  next_meeting_at   timestamptz,
  search_text       text not null default '',
  dialer_lock_user  uuid,
  dialer_lock_until timestamptz,
  created_by        uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index leads_status_idx      on public.leads (status_id);
create index leads_owner_idx       on public.leads (owner_id);
create index leads_opener_idx      on public.leads (opener_id);
create index leads_last_call_idx   on public.leads (last_call_at);
create index leads_next_task_idx   on public.leads (next_task_due);
create index leads_created_idx     on public.leads (created_at desc);
create index leads_name_idx        on public.leads (lower(name));
create index leads_zip_idx         on public.leads (address_zip);
create index leads_custom_idx      on public.leads using gin (custom jsonb_path_ops);
create index leads_search_trgm_idx on public.leads using gin (search_text extensions.gin_trgm_ops);

create table public.contacts (
  id         uuid primary key default gen_random_uuid(),
  lead_id    uuid not null references public.leads (id) on delete cascade,
  name       text not null default '',
  title      text,
  phones     jsonb not null default '[]'::jsonb,  -- [{ "type": "office", "number": "+4969…" }]
  emails     jsonb not null default '[]'::jsonb,  -- [{ "type": "office", "email": "…" }]
  custom     jsonb not null default '{}'::jsonb,
  sort       int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index contacts_lead_idx   on public.contacts (lead_id);
create index contacts_phones_idx on public.contacts using gin (phones jsonb_path_ops);
create index contacts_emails_idx on public.contacts using gin (emails jsonb_path_ops);

-- Nummern/E-Mails beim Speichern vereinheitlichen
create or replace function public.contacts_normalize()
returns trigger language plpgsql as $$
begin
  new.phones := coalesce((
    select jsonb_agg(
             jsonb_build_object(
               'type', coalesce(nullif(p ->> 'type', ''), 'office'),
               'number', coalesce(public.normalize_phone(p ->> 'number'), p ->> 'number')))
    from jsonb_array_elements(case when jsonb_typeof(new.phones) = 'array' then new.phones else '[]'::jsonb end) p
    where coalesce(trim(p ->> 'number'), '') <> ''
  ), '[]'::jsonb);
  new.emails := coalesce((
    select jsonb_agg(
             jsonb_build_object(
               'type', coalesce(nullif(e ->> 'type', ''), 'office'),
               'email', lower(trim(e ->> 'email'))))
    from jsonb_array_elements(case when jsonb_typeof(new.emails) = 'array' then new.emails else '[]'::jsonb end) e
    where coalesce(trim(e ->> 'email'), '') <> ''
  ), '[]'::jsonb);
  new.updated_at := now();
  return new;
end $$;

create trigger contacts_normalize before insert or update on public.contacts
  for each row execute function public.contacts_normalize();

-- Suchtext = Firmenname, Ort, Kontakte, Nummern (auch 069…-Schreibweise), E-Mails
create or replace function public.leads_before_write()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.search_text := lower(concat_ws(' ',
    new.name, new.address_city, new.address_zip, new.address_street, new.url,
    (select string_agg(concat_ws(' ',
              c.name, c.title,
              (select string_agg((p ->> 'number') || ' ' || public.phone_search_variants(p ->> 'number'), ' ')
                 from jsonb_array_elements(c.phones) p),
              (select string_agg(e ->> 'email', ' ') from jsonb_array_elements(c.emails) e)), ' ')
       from public.contacts c where c.lead_id = new.id)));
  return new;
end $$;

create trigger leads_before_write
  before insert or update of name, address_city, address_zip, address_street, url, search_text
  on public.leads
  for each row execute function public.leads_before_write();

create or replace function public.leads_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger leads_touch
  before update of name, status_id, owner_id, opener_id, url, description, address_street, address_zip,
                   address_city, address_state, address_country, source, custom, do_not_call
  on public.leads
  for each row execute function public.leads_touch();

-- Geschützte Felder nur mit Recht ändern (security invoker!)
create or replace function public.leads_guard()
returns trigger language plpgsql as $$
declare
  f record;
begin
  if current_user in ('postgres', 'service_role', 'supabase_admin') or auth.uid() is null then
    return new;
  end if;
  if new.custom is distinct from old.custom and not public.has_perm('edit_restricted_fields') then
    for f in select cf.key, cf.label from public.custom_fields cf where cf.entity = 'lead' and cf.restricted loop
      if (new.custom -> f.key) is distinct from (old.custom -> f.key) then
        raise exception 'Das Feld „%“ ist geschützt und darf nur mit dem Recht „Geschützte Felder bearbeiten“ geändert werden.', f.label;
      end if;
    end loop;
  end if;
  return new;
end $$;

create trigger leads_guard before update of custom on public.leads
  for each row execute function public.leads_guard();

create or replace function public.contacts_after_write()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op in ('INSERT', 'UPDATE') then
    update public.leads set search_text = '' where id = new.lead_id;
  end if;
  if tg_op in ('UPDATE', 'DELETE') and (tg_op = 'DELETE' or old.lead_id <> new.lead_id) then
    update public.leads set search_text = '' where id = old.lead_id;
  end if;
  return null;
end $$;

create trigger contacts_after_write after insert or update or delete on public.contacts
  for each row execute function public.contacts_after_write();

-- ---------------------------------------------------------------------
--  Telefonie
-- ---------------------------------------------------------------------
create table public.phone_numbers (
  number               text primary key,               -- E.164
  label                text not null default '',
  twilio_sid           text,
  sms_capable          boolean not null default false,
  members              uuid[] not null default '{}',   -- leer = ganzes Team
  group_id             uuid references public.groups (id) on delete set null,
  ring_mode            text not null default 'simultaneous' check (ring_mode in ('simultaneous', 'round_robin')),
  ring_timeout         int not null default 25 check (ring_timeout between 5 and 120),
  route_to_owner       boolean not null default true,  -- bekannte Anrufer zuerst beim Zuständigen
  available_to_all     boolean not null default true,  -- alle dürfen damit anrufen (Absender)
  forward_to           text,
  forward_mode         text not null default 'never'
                       check (forward_mode in ('never', 'no_answer', 'always', 'outside_hours')),
  business_hours       jsonb,                           -- {"mon":[["08:00","18:00"]], …}; null = immer
  outside_hours_action text not null default 'voicemail' check (outside_hours_action in ('voicemail', 'forward', 'ring')),
  greeting_text        text,
  greeting_path        text,
  ivr                  jsonb,                           -- Telefonmenü, siehe twilio-voice
  record_inbound       boolean,                         -- null = wie Organisation
  rr_pointer           int not null default 0,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create table public.voicemail_drops (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid references public.profiles (id) on delete cascade default auth.uid(),
  name         text not null,
  storage_path text not null,
  duration     int,
  shared       boolean not null default false,
  created_at   timestamptz not null default now()
);

create table public.calls (
  id                  uuid primary key default gen_random_uuid(),
  lead_id             uuid references public.leads (id) on delete set null,
  contact_id          uuid references public.contacts (id) on delete set null,
  user_id             uuid references public.profiles (id) on delete set null,
  direction           text not null default 'outbound' check (direction in ('outbound', 'inbound')),
  from_number         text,
  to_number           text,
  status              text not null default 'initiated',
  outcome             text references public.call_outcomes (key) on update cascade on delete set null,
  note                text,
  started_at          timestamptz not null default now(),
  answered_at         timestamptz,
  ended_at            timestamptz,
  duration            int not null default 0,
  twilio_call_sid     text unique,
  twilio_child_sid    text,
  conference_sid      text,
  conference_name     text,
  -- Aufnahme
  recording_status    text not null default 'none'
                      check (recording_status in ('none', 'recording', 'paused', 'processing', 'ready', 'failed', 'deleted')),
  recording_sid       text,
  recording_path      text,
  recording_duration  int,
  recording_track     text,
  recording_format    text,
  recording_channels  smallint,
  agent_channel       smallint,        -- 1 oder 2: auf welcher Spur ist unsere Stimme
  recording_bytes     bigint,
  recording_deleted_at timestamptz,
  extra_recordings    jsonb not null default '[]'::jsonb,
  talk_agent_ms       int,             -- Redeanteile aus der Aufnahme (Details in call_insights)
  talk_customer_ms    int,
  quality             jsonb,           -- Verbindungsqualität aus dem Browser (MOS, Jitter, Verlust, RTT)
  transcript_status   text not null default 'none'
                      check (transcript_status in ('none', 'queued', 'processing', 'ready', 'failed')),
  monitors            jsonb not null default '[]'::jsonb,  -- Mithören/Einflüstern/Aufschalten: [{user_id, mode, at}]
  -- Sonstiges
  is_voicemail        boolean not null default false,
  voicemail_drop_id   uuid references public.voicemail_drops (id) on delete set null,
  dialer_session      uuid,
  transferred_to      uuid references public.profiles (id) on delete set null,
  parent_call_id      uuid references public.calls (id) on delete set null,
  created_at          timestamptz not null default now()
);

create index calls_lead_idx      on public.calls (lead_id, started_at desc);
create index calls_user_idx      on public.calls (user_id, started_at desc);
create index calls_started_idx   on public.calls (started_at desc);
create index calls_child_idx     on public.calls (twilio_child_sid);
create index calls_conf_idx      on public.calls (conference_name) where conference_name is not null;
create index calls_recording_idx on public.calls (recording_path) where recording_path is not null;
create index calls_live_idx      on public.calls (started_at) where ended_at is null;

-- Auswertung einer Aufnahme: Wellenform, Redeanteile, Abschrift, KI-Zusammenfassung.
-- Eigene Tabelle, damit nur sieht, wer die Aufnahme auch anhören darf.
create table public.call_insights (
  call_id           uuid primary key references public.calls (id) on delete cascade,
  peaks             jsonb,   -- { "bucket_ms": 50, "agent": [0..255], "customer": [0..255] }
  talk              jsonb,   -- { "agent_ms", "customer_ms", "overlap_ms", "silence_ms", "longest_customer_ms", "switches" }
  transcript_job    text,
  segments          jsonb,   -- [{ "speaker": "agent"|"customer", "start": ms, "end": ms, "text": "…" }]
  transcript_text   text,
  summary           jsonb,   -- { "text", "next_steps": [], "objections": [], "mood" }
  language          text,
  error             text,
  updated_at        timestamptz not null default now()
);
create index call_insights_text_trgm_idx on public.call_insights using gin (transcript_text extensions.gin_trgm_ops)
  where transcript_text is not null;

-- ---------------------------------------------------------------------
--  Aktivitäten: Notizen, E-Mails, Aufgaben, Termine, Formulare, Pipeline
-- ---------------------------------------------------------------------
create table public.notes (
  id         uuid primary key default gen_random_uuid(),
  lead_id    uuid not null references public.leads (id) on delete cascade,
  contact_id uuid references public.contacts (id) on delete set null,
  user_id    uuid references public.profiles (id) on delete set null default auth.uid(),
  body       text not null,
  mentions   uuid[] not null default '{}',
  pinned     boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index notes_lead_idx on public.notes (lead_id, created_at desc);

create table public.email_templates (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  kind       text not null default 'email' check (kind in ('email', 'sms')),
  subject    text not null default '',
  body       text not null default '',
  is_html    boolean not null default false,
  shared     boolean not null default true,
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Verbundene Postfächer (z. B. IONOS über IMAP/SMTP). Das Passwort liegt
-- nur in private.kv (Schlüssel email_pw:<id>), nie in dieser Tabelle.
create table public.email_accounts (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles (id) on delete cascade,
  email         text not null,
  display_name  text not null default '',
  imap_host     text not null,
  imap_port     int not null default 993,
  smtp_host     text not null,
  smtp_port     int not null default 465,
  username      text not null,
  signature     text not null default '',
  sync_enabled  boolean not null default true,
  sync_folder   text not null default 'INBOX',
  sent_folder   text,
  last_uid      bigint,
  last_sync_at  timestamptz,
  last_error    text,
  created_at    timestamptz not null default now(),
  unique (user_id, email)
);

create table public.emails (
  id              uuid primary key default gen_random_uuid(),
  lead_id         uuid not null references public.leads (id) on delete cascade,
  contact_id      uuid references public.contacts (id) on delete set null,
  user_id         uuid references public.profiles (id) on delete set null default auth.uid(),
  account_id      uuid references public.email_accounts (id) on delete set null,
  direction       text not null default 'outbound' check (direction in ('outbound', 'inbound')),
  -- logged = nur vermerkt (eigenes Mailprogramm), draft/scheduled/sending/sent/failed = über das CRM, received = Postfach
  status          text not null default 'logged'
                  check (status in ('logged', 'draft', 'scheduled', 'sending', 'sent', 'failed', 'received')),
  from_address    text,
  to_address      text,
  cc              text,
  bcc             text,
  subject         text not null default '',
  body            text not null default '',
  is_html         boolean not null default false,
  attachments     jsonb not null default '[]'::jsonb,   -- [{ "name", "size", "path" }]
  message_id      text,
  in_reply_to     text,
  thread_key      text,
  template_id     uuid references public.email_templates (id) on delete set null,
  workflow_run_id uuid,
  send_at         timestamptz,
  sent_at         timestamptz,
  opens           int not null default 0,
  last_opened_at  timestamptz,
  error           text,
  created_at      timestamptz not null default now()
);
create index emails_lead_idx    on public.emails (lead_id, created_at desc);
create index emails_outbox_idx  on public.emails (status, send_at) where status in ('scheduled', 'sending');
create unique index emails_message_idx on public.emails (account_id, message_id) where message_id is not null;

create table public.sms_messages (
  id          uuid primary key default gen_random_uuid(),
  lead_id     uuid references public.leads (id) on delete cascade,
  contact_id  uuid references public.contacts (id) on delete set null,
  user_id     uuid references public.profiles (id) on delete set null default auth.uid(),
  direction   text not null default 'outbound' check (direction in ('outbound', 'inbound')),
  from_number text,
  to_number   text,
  body        text not null default '',
  status      text not null default 'queued'
              check (status in ('draft', 'scheduled', 'queued', 'sending', 'sent', 'delivered', 'undelivered', 'failed', 'received')),
  twilio_sid  text unique,
  send_at     timestamptz,
  error       text,
  workflow_run_id uuid,
  created_at  timestamptz not null default now()
);
create index sms_lead_idx   on public.sms_messages (lead_id, created_at desc);
create index sms_number_idx on public.sms_messages (from_number, to_number, created_at desc);

create table public.tasks (
  id          uuid primary key default gen_random_uuid(),
  lead_id     uuid references public.leads (id) on delete cascade,
  contact_id  uuid references public.contacts (id) on delete set null,
  assigned_to uuid references public.profiles (id) on delete set null,
  created_by  uuid references public.profiles (id) on delete set null default auth.uid(),
  type        text not null default 'todo'
              check (type in ('todo', 'call', 'email', 'missed_call', 'voicemail', 'meeting_followup', 'workflow')),
  title       text not null,
  note        text,
  due_at      timestamptz,
  done        boolean not null default false,
  done_at     timestamptz,
  done_by     uuid references public.profiles (id) on delete set null,
  call_id     uuid references public.calls (id) on delete set null,
  created_at  timestamptz not null default now()
);
create index tasks_assigned_idx on public.tasks (assigned_to, done, due_at);
create index tasks_lead_idx     on public.tasks (lead_id);
create index tasks_open_idx     on public.tasks (done, due_at);

create table public.meetings (
  id           uuid primary key default gen_random_uuid(),
  lead_id      uuid references public.leads (id) on delete set null,
  contact_id   uuid references public.contacts (id) on delete set null,
  source       text not null default 'crm' check (source in ('calendly', 'google', 'crm')),
  external_id  text,
  calendar_id  text,
  google_event_id text,
  title        text not null default '',
  description  text,
  location     text,
  join_url     text,
  starts_at    timestamptz not null,
  ends_at      timestamptz,
  host_user_id uuid references public.profiles (id) on delete set null,
  host_email   text,
  host_name    text,
  set_by       uuid references public.profiles (id) on delete set null,
  invitee_name  text,
  invitee_email text,
  invitee_phone text,
  status       text not null default 'scheduled'
               check (status in ('scheduled', 'canceled', 'rescheduled', 'completed', 'no_show')),
  outcome_note text,
  raw          jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (source, external_id)
);
create index meetings_starts_idx on public.meetings (starts_at);
create index meetings_lead_idx   on public.meetings (lead_id);
create index meetings_setby_idx  on public.meetings (set_by, created_at);
create index meetings_host_idx   on public.meetings (host_user_id, starts_at);

create table public.opportunities (
  id             uuid primary key default gen_random_uuid(),
  lead_id        uuid not null references public.leads (id) on delete cascade,
  contact_id     uuid references public.contacts (id) on delete set null,
  user_id        uuid references public.profiles (id) on delete set null default auth.uid(),
  status_id      uuid references public.opportunity_statuses (id) on delete set null,
  value          numeric(12, 2) not null default 0,
  value_period   text not null default 'monthly' check (value_period in ('one_time', 'monthly', 'annual')),
  confidence     int not null default 50 check (confidence between 0 and 100),
  expected_close date,
  note           text,
  custom         jsonb not null default '{}'::jsonb,
  closed_at      timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index opportunities_lead_idx   on public.opportunities (lead_id);
create index opportunities_status_idx on public.opportunities (status_id);

create table public.custom_activities (
  id         uuid primary key default gen_random_uuid(),
  type_id    uuid not null references public.activity_types (id) on delete restrict,
  lead_id    uuid not null references public.leads (id) on delete cascade,
  contact_id uuid references public.contacts (id) on delete set null,
  user_id    uuid references public.profiles (id) on delete set null default auth.uid(),
  call_id    uuid references public.calls (id) on delete set null,
  data       jsonb not null default '{}'::jsonb,
  status     text not null default 'published' check (status in ('draft', 'published')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index custom_activities_lead_idx on public.custom_activities (lead_id, created_at desc);
create index custom_activities_type_idx on public.custom_activities (type_id, created_at desc);
create index custom_activities_user_idx on public.custom_activities (user_id, created_at desc);

create table public.lead_events (
  id         uuid primary key default gen_random_uuid(),
  lead_id    uuid not null references public.leads (id) on delete cascade,
  user_id    uuid references public.profiles (id) on delete set null,
  type       text not null,
  data       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index lead_events_lead_idx on public.lead_events (lead_id, created_at desc);
create index lead_events_type_idx on public.lead_events (type, created_at);

-- Kommentare an Aktivitäten (auch Markierungen in Aufnahmen: at_ms)
create table public.comments (
  id          uuid primary key default gen_random_uuid(),
  lead_id     uuid not null references public.leads (id) on delete cascade,
  target_kind text not null check (target_kind in ('note', 'call', 'email', 'meeting', 'activity', 'opportunity', 'task', 'event')),
  target_id   uuid not null,
  user_id     uuid references public.profiles (id) on delete set null default auth.uid(),
  body        text not null check (length(trim(body)) > 0),
  at_ms       int check (at_ms is null or at_ms >= 0),
  mentions    uuid[] not null default '{}',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index comments_target_idx on public.comments (target_kind, target_id, created_at);
create index comments_lead_idx   on public.comments (lead_id);

-- Benachrichtigungen (Inbox): Erwähnungen, Zuweisungen, Kommentare …
create table public.notifications (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles (id) on delete cascade,
  kind          text not null check (kind in ('mention', 'comment', 'assigned', 'missed_call', 'voicemail',
                                              'sms', 'email', 'meeting', 'workflow', 'system')),
  lead_id       uuid references public.leads (id) on delete cascade,
  ref_kind      text,
  ref_id        uuid,
  actor_id      uuid references public.profiles (id) on delete set null,
  title         text not null default '',
  body          text not null default '',
  created_at    timestamptz not null default now(),
  read_at       timestamptz,
  done_at       timestamptz,
  snoozed_until timestamptz
);
create index notifications_user_idx on public.notifications (user_id, done_at, created_at desc);

-- Workflows (in Close: Workflows/Sequenzen): Auslöser → Schritte mit Wartezeiten → Ziel
create table public.workflows (
  id             uuid primary key default gen_random_uuid(),
  name           text not null check (length(trim(name)) > 0),
  description    text not null default '',
  status         text not null default 'draft' check (status in ('draft', 'active', 'paused')),
  -- { "type": "manual" | "lead_created" | "status_changed" | "call_outcome" | "meeting_booked"
  --           | "activity_created" | "opportunity_status", "value": …, "filters": {conditions…} }
  trigger        jsonb not null default '{"type":"manual"}'::jsonb,
  -- [{ "id", "type": "email"|"sms"|"call"|"task"|"update_lead"|"assign"|"opportunity"|"notify"|"filter",
  --    "wait": { "amount": 2, "unit": "days" }, "config": {…} }]
  steps          jsonb not null default '[]'::jsonb,
  -- { "type": "none"|"status"|"meeting"|"replied"|"outcome", "value": … }
  goal           jsonb not null default '{"type":"none"}'::jsonb,
  -- Kommunikationsfenster: { "days": [1,2,3,4,5], "from": "08:00", "to": "18:00" } (Europe/Berlin)
  send_window    jsonb not null default '{"days":[1,2,3,4,5],"from":"08:00","to":"18:00"}'::jsonb,
  allow_reenroll boolean not null default false,
  stop_on_reply  boolean not null default true,
  sender_mode    text not null default 'owner' check (sender_mode in ('owner', 'enroller', 'fixed')),
  sender_user    uuid references public.profiles (id) on delete set null,
  created_by     uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table public.workflow_runs (
  id          uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references public.workflows (id) on delete cascade,
  lead_id     uuid not null references public.leads (id) on delete cascade,
  contact_id  uuid references public.contacts (id) on delete set null,
  status      text not null default 'active'
              check (status in ('active', 'paused', 'finished', 'goal_met', 'canceled', 'failed')),
  step_index  int not null default 0,
  next_at     timestamptz default now(),
  locked_at   timestamptz,
  started_by  uuid references public.profiles (id) on delete set null default auth.uid(),
  started_at  timestamptz not null default now(),
  ended_at    timestamptz,
  end_reason  text,
  log         jsonb not null default '[]'::jsonb,   -- [{ "at", "step", "result" }]
  created_at  timestamptz not null default now()
);
create index workflow_runs_due_idx  on public.workflow_runs (next_at) where status = 'active';
create index workflow_runs_lead_idx on public.workflow_runs (lead_id, status);
create unique index workflow_runs_one_active_idx on public.workflow_runs (workflow_id, lead_id)
  where status in ('active', 'paused');

alter table public.emails       add constraint emails_run_fk foreign key (workflow_run_id) references public.workflow_runs (id) on delete set null;
alter table public.sms_messages add constraint sms_run_fk    foreign key (workflow_run_id) references public.workflow_runs (id) on delete set null;

create table public.smart_views (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text not null default '',
  kind        text not null default 'lead' check (kind in ('lead', 'contact')),
  filters     jsonb not null default '{}'::jsonb,
  sort        jsonb not null default '{}'::jsonb,
  columns     jsonb not null default '[]'::jsonb,
  shared      boolean not null default true,
  pinned      boolean not null default false,   -- für alle im Menü angeheftet
  position    int not null default 0,
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

create table public.app_logs (
  id      bigint generated always as identity primary key,
  at      timestamptz not null default now(),
  source  text not null,
  level   text not null default 'error' check (level in ('debug', 'info', 'warn', 'error')),
  user_id uuid default auth.uid(),
  message text not null,
  details jsonb not null default '{}'::jsonb
);
create index app_logs_at_idx on public.app_logs (at desc);

-- ---------------------------------------------------------------------
--  Verlauf eines Leads (alles in einer Liste)
-- ---------------------------------------------------------------------
create view public.lead_timeline with (security_invoker = true) as
  select 'call'::text as kind, c.id, c.lead_id, c.user_id, c.started_at as at, to_jsonb(c) as data
    from public.calls c where c.lead_id is not null
  union all
  select 'note', n.id, n.lead_id, n.user_id, n.created_at, to_jsonb(n) from public.notes n
  union all
  select 'email', e.id, e.lead_id, e.user_id, coalesce(e.sent_at, e.send_at, e.created_at), to_jsonb(e)
    from public.emails e
  union all
  select 'sms', s.id, s.lead_id, s.user_id, coalesce(s.send_at, s.created_at), to_jsonb(s)
    from public.sms_messages s where s.lead_id is not null
  union all
  select 'meeting', m.id, m.lead_id, coalesce(m.set_by, m.host_user_id), m.created_at, to_jsonb(m) - 'raw'
    from public.meetings m where m.lead_id is not null
  union all
  select 'event', le.id, le.lead_id, le.user_id, le.created_at, to_jsonb(le) from public.lead_events le
  union all
  select 'task', t.id, t.lead_id, t.done_by, coalesce(t.done_at, t.created_at), to_jsonb(t)
    from public.tasks t where t.done and t.lead_id is not null
  union all
  select 'activity', a.id, a.lead_id, a.user_id, a.created_at, to_jsonb(a)
    from public.custom_activities a;

-- ---------------------------------------------------------------------
--  Kennzahlen am Lead aktuell halten
-- ---------------------------------------------------------------------
create or replace function public.refresh_lead_call_stats(p_lead uuid)
returns void language sql security definer set search_path = '' as $$
  update public.leads l set
    call_count        = s.cnt,
    last_call_at      = s.last_call,
    last_connected_at = s.last_conn,
    last_call_outcome = s.last_outcome
  from (
    select
      count(*) filter (where c.direction = 'outbound')                    as cnt,
      max(c.started_at) filter (where c.direction = 'outbound')          as last_call,
      max(c.started_at) filter (where coalesce(o.counts_as_connected, false)) as last_conn,
      (select c2.outcome from public.calls c2
        where c2.lead_id = p_lead and c2.outcome is not null
        order by c2.started_at desc limit 1)                              as last_outcome
    from public.calls c
    left join public.call_outcomes o on o.key = c.outcome
    where c.lead_id = p_lead
  ) s
  where l.id = p_lead
$$;

create or replace function public.calls_after_write()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_is_meeting boolean;
begin
  if tg_op in ('INSERT', 'UPDATE') and new.lead_id is not null then
    perform public.refresh_lead_call_stats(new.lead_id);
    if tg_op = 'INSERT' then
      update public.leads set last_activity_at = now() where id = new.lead_id;
    end if;
    -- Erster gelegter Termin → Opener merken
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

create trigger calls_after_write
  after insert or update of lead_id, outcome, started_at, direction or delete on public.calls
  for each row execute function public.calls_after_write();

create or replace function public.refresh_lead_next_task(p_lead uuid)
returns void language sql security definer set search_path = '' as $$
  update public.leads set next_task_due =
    (select min(t.due_at) from public.tasks t where t.lead_id = p_lead and not t.done)
  where id = p_lead
$$;

create or replace function public.tasks_after_write()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op in ('INSERT', 'UPDATE') and new.lead_id is not null then
    perform public.refresh_lead_next_task(new.lead_id);
  end if;
  if tg_op in ('UPDATE', 'DELETE') and old.lead_id is not null
     and (tg_op = 'DELETE' or old.lead_id is distinct from new.lead_id) then
    perform public.refresh_lead_next_task(old.lead_id);
  end if;
  return null;
end $$;

create trigger tasks_after_write after insert or update or delete on public.tasks
  for each row execute function public.tasks_after_write();

create or replace function public.tasks_before_write()
returns trigger language plpgsql as $$
begin
  if new.done and (tg_op = 'INSERT' or not old.done) then
    new.done_at := coalesce(new.done_at, now());
    new.done_by := coalesce(new.done_by, auth.uid());
  elsif not new.done then
    new.done_at := null;
    new.done_by := null;
  end if;
  return new;
end $$;

create trigger tasks_before_write before insert or update on public.tasks
  for each row execute function public.tasks_before_write();

create or replace function public.refresh_lead_next_meeting(p_lead uuid)
returns void language sql security definer set search_path = '' as $$
  update public.leads set next_meeting_at =
    (select min(m.starts_at) from public.meetings m
      where m.lead_id = p_lead and m.status = 'scheduled' and m.starts_at >= now() - interval '2 hours')
  where id = p_lead
$$;

create or replace function public.meetings_after_write()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op in ('INSERT', 'UPDATE') and new.lead_id is not null then
    perform public.refresh_lead_next_meeting(new.lead_id);
    if tg_op = 'INSERT' then
      update public.leads set last_activity_at = now() where id = new.lead_id;
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

create trigger meetings_after_write after insert or update or delete on public.meetings
  for each row execute function public.meetings_after_write();

create or replace function public.touch_lead_activity()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.leads set last_activity_at = now() where id = new.lead_id;
  return null;
end $$;

create trigger notes_touch_lead      after insert on public.notes             for each row execute function public.touch_lead_activity();
create trigger emails_touch_lead     after insert on public.emails            for each row execute function public.touch_lead_activity();
create trigger activities_touch_lead after insert on public.custom_activities for each row execute function public.touch_lead_activity();

create or replace function public.touch_lead_activity_nullable()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.lead_id is not null then
    update public.leads set last_activity_at = now() where id = new.lead_id;
  end if;
  return null;
end $$;

create trigger sms_touch_lead after insert on public.sms_messages for each row execute function public.touch_lead_activity_nullable();

-- Benachrichtigung anlegen (nicht für sich selbst, nicht für Inaktive)
create or replace function public.notify(
  p_user uuid, p_kind text, p_lead uuid, p_ref_kind text, p_ref_id uuid, p_title text, p_body text default ''
) returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_user is null or p_user = auth.uid() then return; end if;
  if not exists (select 1 from public.profiles where id = p_user and active) then return; end if;
  insert into public.notifications (user_id, kind, lead_id, ref_kind, ref_id, actor_id, title, body)
  values (p_user, p_kind, p_lead, p_ref_kind, p_ref_id, auth.uid(), coalesce(p_title, ''), left(coalesce(p_body, ''), 500));
end $$;

revoke all on function public.notify(uuid, text, uuid, text, uuid, text, text) from public, anon, authenticated;
grant execute on function public.notify(uuid, text, uuid, text, uuid, text, text) to service_role;

-- Status-/Besitzerwechsel im Verlauf festhalten, neuen Zuständigen benachrichtigen
create or replace function public.leads_after_write()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    insert into public.lead_events (lead_id, user_id, type, data)
    values (new.id, coalesce(auth.uid(), new.created_by), 'created',
            jsonb_build_object('source', new.source, 'status_id', new.status_id));
    if new.owner_id is not null then
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
      perform public.notify(new.owner_id, 'assigned', new.id, 'lead', new.id, 'Dir zugewiesen: ' || new.name);
    end if;
  end if;
  return null;
end $$;

create trigger leads_after_write after insert or update of status_id, owner_id on public.leads
  for each row execute function public.leads_after_write();

create or replace function public.opportunities_before_write()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_kind text;
begin
  select kind into v_kind from public.opportunity_statuses where id = new.status_id;
  if coalesce(v_kind, 'open') <> 'open' then
    if tg_op = 'INSERT' or new.status_id is distinct from old.status_id then
      new.closed_at := now();
    end if;
  else
    new.closed_at := null;
  end if;
  new.updated_at := now();
  return new;
end $$;

create trigger opportunities_before_write before insert or update on public.opportunities
  for each row execute function public.opportunities_before_write();

create or replace function public.opportunities_log()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    insert into public.lead_events (lead_id, user_id, type, data)
    values (new.lead_id, coalesce(auth.uid(), new.user_id), 'opportunity_created',
            jsonb_build_object('opportunity_id', new.id, 'status_id', new.status_id,
                               'value', new.value, 'value_period', new.value_period));
  elsif new.status_id is distinct from old.status_id then
    insert into public.lead_events (lead_id, user_id, type, data)
    values (new.lead_id, auth.uid(), 'opportunity_status',
            jsonb_build_object('opportunity_id', new.id, 'from', old.status_id, 'to', new.status_id,
                               'value', new.value, 'value_period', new.value_period));
  end if;
  return null;
end $$;

create trigger opportunities_log after insert or update of status_id on public.opportunities
  for each row execute function public.opportunities_log();

-- Formulare: Pflichtfelder prüfen
create or replace function public.custom_activities_validate()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  f jsonb;
  v jsonb;
begin
  if new.status = 'published' then
    for f in select jsonb_array_elements(t.fields) from public.activity_types t where t.id = new.type_id loop
      if coalesce((f ->> 'required')::boolean, false) then
        v := new.data -> (f ->> 'key');
        if v is null or v = 'null'::jsonb or v = '""'::jsonb or v = '[]'::jsonb then
          raise exception 'Bitte „%“ ausfüllen.', f ->> 'label';
        end if;
      end if;
    end loop;
  end if;
  new.updated_at := now();
  return new;
end $$;

create trigger custom_activities_validate before insert or update on public.custom_activities
  for each row execute function public.custom_activities_validate();

-- Formular-Automatik:
--  • Datumsfeld mit "creates_task": legt eine Wiedervorlage-Aufgabe zu diesem Zeitpunkt an
--  • Auswahlfeld mit "sets_lead_date": setzt ein Datumsfeld am Lead auf heute + Dauer
--    (z. B. Sperrdauer „3 Monate“ → „Gesperrt bis“)
create or replace function public.custom_activities_automation()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  t      public.activity_types;
  f      jsonb;
  v      text;
  v_due  timestamptz;
  v_iv   interval;
  v_note text;
begin
  if new.status <> 'published' or (tg_op = 'UPDATE' and old.status = 'published') then
    return null;
  end if;
  select * into t from public.activity_types where id = new.type_id;
  select string_agg((x ->> 'label') || ': ' || (new.data ->> (x ->> 'key')), E'\n' order by o)
    into v_note
    from jsonb_array_elements(t.fields) with ordinality as e(x, o)
   where x ->> 'type' in ('text', 'textarea', 'choice', 'number')
     and coalesce(new.data ->> (x ->> 'key'), '') <> '';

  for f in select jsonb_array_elements(t.fields) loop
    v := new.data ->> (f ->> 'key');
    if v is null or v = '' then continue; end if;

    if coalesce((f ->> 'creates_task')::boolean, false) and f ->> 'type' in ('date', 'datetime') then
      begin
        v_due := case when f ->> 'type' = 'date'
                      then (v::date + time '09:00') at time zone 'Europe/Berlin'
                      else v::timestamptz end;
      exception when others then
        v_due := null;
      end;
      if v_due is not null then
        insert into public.tasks (lead_id, contact_id, assigned_to, created_by, type, title, note, due_at)
        values (new.lead_id, new.contact_id, coalesce(new.user_id, auth.uid()), new.user_id, 'call',
                t.name, v_note, v_due);
      end if;
    end if;

    if jsonb_typeof(f -> 'sets_lead_date') = 'object' and coalesce(f #>> '{sets_lead_date,field}', '') <> '' then
      begin
        v_iv := (f -> 'sets_lead_date' -> 'map' ->> v)::interval;
      exception when others then
        v_iv := null;
      end;
      if v_iv is not null then
        update public.leads
           set custom = custom || jsonb_build_object(
                 f #>> '{sets_lead_date,field}',
                 to_char((now() at time zone 'Europe/Berlin')::date + v_iv, 'YYYY-MM-DD'))
         where id = new.lead_id;
      end if;
    end if;
  end loop;
  return null;
end $$;

create trigger custom_activities_automation after insert or update of status on public.custom_activities
  for each row execute function public.custom_activities_automation();

-- Erwähnungen (@Name) in Notizen und Kommentaren → Benachrichtigung
create or replace function public.mentions_notify()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  u uuid;
  v_lead text;
  v_old uuid[] := '{}';
begin
  if tg_op = 'UPDATE' then v_old := old.mentions; end if;
  select name into v_lead from public.leads where id = new.lead_id;
  foreach u in array coalesce(new.mentions, '{}') loop
    if not (u = any (v_old)) then
      perform public.notify(u, 'mention', new.lead_id,
                            case when tg_table_name = 'notes' then 'note' else 'comment' end, new.id,
                            'Erwähnt bei ' || coalesce(v_lead, 'einem Lead'), new.body);
    end if;
  end loop;
  return null;
end $$;

create trigger notes_mentions after insert or update of mentions on public.notes
  for each row execute function public.mentions_notify();
create trigger comments_mentions after insert or update of mentions on public.comments
  for each row execute function public.mentions_notify();

-- Kommentar → wer die Aktivität angelegt hat, erfährt es
create or replace function public.comments_notify_owner()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_owner uuid;
  v_lead  text;
begin
  v_owner := case new.target_kind
    when 'note'        then (select user_id from public.notes where id = new.target_id)
    when 'call'        then (select user_id from public.calls where id = new.target_id)
    when 'email'       then (select user_id from public.emails where id = new.target_id)
    when 'activity'    then (select user_id from public.custom_activities where id = new.target_id)
    when 'opportunity' then (select user_id from public.opportunities where id = new.target_id)
    when 'meeting'     then (select set_by from public.meetings where id = new.target_id)
    else null end;
  if v_owner is not null and not (v_owner = any (new.mentions)) then
    select name into v_lead from public.leads where id = new.lead_id;
    perform public.notify(v_owner, 'comment', new.lead_id, 'comment', new.id,
                          'Kommentar bei ' || coalesce(v_lead, 'einem Lead'), new.body);
  end if;
  return null;
end $$;

create trigger comments_notify_owner after insert on public.comments
  for each row execute function public.comments_notify_owner();

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger notes_updated          before update on public.notes           for each row execute function public.touch_updated_at();
create trigger meetings_updated       before update on public.meetings        for each row execute function public.touch_updated_at();
create trigger comments_updated       before update on public.comments        for each row execute function public.touch_updated_at();
create trigger phone_numbers_updated  before update on public.phone_numbers   for each row execute function public.touch_updated_at();
create trigger activity_types_updated before update on public.activity_types  for each row execute function public.touch_updated_at();
create trigger templates_updated      before update on public.email_templates for each row execute function public.touch_updated_at();
create trigger workflows_updated      before update on public.workflows       for each row execute function public.touch_updated_at();
-- Organisationseinstellungen: Telefonie, Aufnahmen und Integrationen nur mit
-- „Organisation verwalten“; Gesprächsleitfaden & Termin-Status auch mit „Anpassen“.
create or replace function public.org_settings_guard()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  if current_user in ('postgres', 'service_role', 'supabase_admin') or public.is_admin() then
    return new;
  end if;
  if public.has_perm('manage_customizations')
     and (to_jsonb(new) - array['call_script', 'meeting_status_id', 'updated_at'])
       = (to_jsonb(old) - array['call_script', 'meeting_status_id', 'updated_at']) then
    return new;
  end if;
  raise exception 'Diese Einstellung darf nur ändern, wer die Organisation verwaltet.';
end $$;

create trigger org_settings_guard before update on public.org_settings
  for each row execute function public.org_settings_guard();

-- Geteilte Smart Views und Vorlagen nur mit passendem Recht
create or replace function public.shared_guard()
returns trigger language plpgsql as $$
declare
  v_perm text := case tg_table_name when 'smart_views' then 'manage_team_smart_views' else 'manage_team_templates' end;
begin
  if current_user in ('postgres', 'service_role', 'supabase_admin') or auth.uid() is null then
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE' then
    if old.created_by is distinct from auth.uid() and not public.has_perm(v_perm) then
      raise exception 'Keine Berechtigung für geteilte Einträge anderer.';
    end if;
    return old;
  end if;
  if new.shared and not public.has_perm(v_perm)
     and (tg_op = 'INSERT' or not old.shared or old.created_by is distinct from auth.uid()) then
    raise exception 'Für das ganze Team freigeben darf nur, wer das Recht dazu hat.';
  end if;
  if tg_op = 'UPDATE' and old.created_by is distinct from auth.uid() and not public.has_perm(v_perm) then
    raise exception 'Keine Berechtigung für geteilte Einträge anderer.';
  end if;
  return new;
end $$;

create trigger smart_views_guard before insert or update or delete on public.smart_views
  for each row execute function public.shared_guard();
create trigger templates_guard before insert or update or delete on public.email_templates
  for each row execute function public.shared_guard();
