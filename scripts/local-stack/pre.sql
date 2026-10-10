-- Lokaler Nachbau einer Supabase-Datenbank, Teil 1 (vor den Migrationen von Supabase Auth).
set client_min_messages = warning;
-- Nur zum Testen (scripts/local-stack.sh), NICHT in Supabase ausführen.

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin noinherit bypassrls; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then create role authenticator login noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_admin') then create role supabase_admin nologin; end if;
end $$;

alter role service_role bypassrls;
grant anon, authenticated, service_role to authenticator;

create schema if not exists auth;
create schema if not exists extensions;
create schema if not exists storage;

grant usage on schema public, auth, extensions, storage to anon, authenticated, service_role;

alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
