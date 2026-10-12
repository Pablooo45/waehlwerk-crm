-- E-Mail-Öffnungen und Link-Klicks erfassen (wie in Close).
-- Standardmäßig aus: Zählpixel und umgeleitete Links brauchen in Deutschland meist eine Einwilligung
-- (TDDDG). Ein Admin schaltet es unter Einstellungen → E-Mail-Postfach für das ganze Team ein.

alter table public.org_settings
  add column if not exists email_track_opens  boolean not null default false,
  add column if not exists email_track_clicks boolean not null default false;

alter table public.emails
  add column if not exists clicks          int not null default 0,
  add column if not exists last_clicked_at timestamptz,
  add column if not exists track_events    jsonb not null default '[]'::jsonb;  -- [{ kind, at, url? }], höchstens 50

-- Schlüssel zum Signieren der Zähl-Links (nur Server-Funktionen lesen ihn)
insert into private.kv (key, value)
values ('TRACKING_KEY', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
on conflict (key) do nothing;

-- Öffnung oder Klick vermerken. Rückgabe: Angaben für eine Benachrichtigung (oder null, wenn nicht gezählt).
create or replace function public.email_track_event(p_email uuid, p_kind text, p_url text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  e       public.emails%rowtype;
  v_first boolean;
begin
  if p_kind not in ('open', 'click') then
    return null;
  end if;
  select * into e from public.emails where id = p_email for update;
  if not found or e.direction <> 'outbound' or e.status <> 'sent' then
    return null;
  end if;
  -- Virenscanner und Vorschaudienste holen Bilder und Links oft sofort nach dem Zustellen ab
  if e.sent_at is not null and now() - e.sent_at < interval '10 seconds' then
    return null;
  end if;
  v_first := case when p_kind = 'open' then e.opens = 0 else e.clicks = 0 end;
  update public.emails set
    -- ein Klick heißt auch: geöffnet (falls Bilder blockiert waren)
    opens           = case when p_kind = 'open' or opens = 0 then opens + 1 else opens end,
    last_opened_at  = case when p_kind = 'open' or opens = 0 then now() else last_opened_at end,
    clicks          = clicks + (p_kind = 'click')::int,
    last_clicked_at = case when p_kind = 'click' then now() else last_clicked_at end,
    track_events    = (case when jsonb_array_length(track_events) >= 50 then track_events - 0 else track_events end)
                      || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('kind', p_kind, 'at', now(), 'url', left(p_url, 500))))
  where id = p_email;
  return jsonb_build_object('first', v_first, 'lead_id', e.lead_id, 'user_id', e.user_id, 'subject', e.subject, 'to', e.to_address);
end $$;

revoke all on function public.email_track_event(uuid, text, text) from public, anon, authenticated;
grant execute on function public.email_track_event(uuid, text, text) to service_role;
