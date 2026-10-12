-- Mein Verdienst: Fixgehalt, Provisionsmodell und gewonnene Kunden.
--
-- Jede Person trägt ihre eigenen Zahlen ein und sieht nur ihre eigenen – auch Admins sehen fremde Verdienste nicht.
-- Provisionsmodelle sind Vorlagen fürs Team (wer „Einstellungen anpassen“ darf, pflegt sie); beim Auswählen
-- wird das Modell in den eigenen Stand kopiert. So rechnen frühere Monate weiter mit dem Modell, das damals galt,
-- auch wenn die Vorlage später geändert wird.
--
-- Stufen: [{ "from": 25000, "rate": 2 }, …] – ab diesem Monatsumsatz gilt der Prozentsatz für den ganzen Umsatz
-- des Monats. Umsatz zählt im Monat des Abschlusses. Die Rechnung selbst passiert im Browser (src/lib/earnings.ts).

create table public.commission_models (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(trim(name)) > 0),
  description text not null default '',
  tiers       jsonb not null default '[]'::jsonb,
  per_deal    numeric(12, 2) not null default 0 check (per_deal >= 0),
  deal_value  numeric(12, 2) not null default 0 check (deal_value >= 0),
  sort        int not null default 100,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint commission_models_tiers check (jsonb_typeof(tiers) = 'array')
);

-- Stand von Fixgehalt und Provisionsmodell; gilt ab einem Monat, bis ein neuerer Stand beginnt
create table public.pay_plans (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  valid_from   date not null,
  base_salary  numeric(12, 2) not null default 0 check (base_salary >= 0),
  model_id     uuid references public.commission_models (id) on delete set null,
  model_name   text not null default '',
  tiers        jsonb not null default '[]'::jsonb,
  per_deal     numeric(12, 2) not null default 0 check (per_deal >= 0),
  deal_value   numeric(12, 2) not null default 0 check (deal_value >= 0),
  monthly_goal numeric(12, 2) check (monthly_goal is null or monthly_goal >= 0),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (user_id, valid_from),
  constraint pay_plans_month check (extract(day from valid_from) = 1),
  constraint pay_plans_tiers check (jsonb_typeof(tiers) = 'array')
);

-- Gewonnene Kunden (wie die Kundenliste in der Provisions-Tabelle)
create table public.won_deals (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  customer       text not null check (length(trim(customer)) > 0),
  lead_id        uuid references public.leads (id) on delete set null,
  opportunity_id uuid references public.opportunities (id) on delete set null,
  setting_date   date,
  closed_on      date not null,
  deal_value     numeric(12, 2) not null check (deal_value >= 0),
  canceled       boolean not null default false,
  note           text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index won_deals_user_idx on public.won_deals (user_id, closed_on desc);
create index won_deals_lead_idx on public.won_deals (lead_id) where lead_id is not null;
create index won_deals_opportunity_idx on public.won_deals (opportunity_id) where opportunity_id is not null;
-- dieselbe Opportunity nicht zweimal übernehmen
create unique index won_deals_opportunity_once on public.won_deals (user_id, opportunity_id) where opportunity_id is not null;

create trigger commission_models_updated before update on public.commission_models for each row execute function public.touch_updated_at();
create trigger pay_plans_updated         before update on public.pay_plans         for each row execute function public.touch_updated_at();
create trigger won_deals_updated         before update on public.won_deals         for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
--  Rechte
-- ---------------------------------------------------------------------
alter table public.commission_models enable row level security;
alter table public.pay_plans enable row level security;
alter table public.won_deals enable row level security;

create policy commission_models_select on public.commission_models for select to authenticated
  using ((select public.is_member()));
create policy commission_models_manage on public.commission_models for all to authenticated
  using ((select public.has_perm('manage_customizations')))
  with check ((select public.has_perm('manage_customizations')));

create policy pay_plans_own on public.pay_plans for all to authenticated
  using (user_id = (select auth.uid()) and (select public.is_member()))
  with check (user_id = (select auth.uid()) and (select public.is_member()));

create policy won_deals_own on public.won_deals for all to authenticated
  using (user_id = (select auth.uid()) and (select public.is_member()))
  with check (user_id = (select auth.uid()) and (select public.is_member()));

revoke all on public.commission_models, public.pay_plans, public.won_deals from anon;

-- Leads zusammenführen: eingetragene Kunden zeigen danach auf den behaltenen Lead (statt die Verknüpfung zu verlieren).
-- Die Funktion wird um eine Zeile ergänzt, ohne sie hier komplett zu wiederholen.
do $$
declare
  def    text := pg_get_functiondef('public.merge_leads(uuid, uuid)'::regprocedure);
  anchor text := 'update public.custom_activities set lead_id = p_keep where lead_id = p_merge;';
begin
  if position('public.won_deals' in def) = 0 then
    if position(anchor in def) = 0 then
      raise exception 'merge_leads: Stelle zum Ergänzen nicht gefunden';
    end if;
    execute replace(def, anchor, anchor || E'\n  update public.won_deals set lead_id = p_keep where lead_id = p_merge;');
  end if;
end $$;
