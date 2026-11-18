-- HD 3D sun view (TEST app, 12 Nov 2026): the tiles-proxy edge function counts the requests Google
-- bills (the root tile set, one per HD session) here and refuses them at a daily and a monthly cap.
-- Google's free allowance is 1,000 root requests per calendar month (SKU C6E1-98B2-DBD0, then $6 per
-- 1,000), so the monthly cap (default 900, set in the function) is what keeps it free.
-- Days and months are US Pacific time (America/Los_Angeles), Google's billing month.
-- Backend only: RLS on with no policy, so the app's public key reads nothing.
create table if not exists public.tiles_proxy_days (
  day date primary key,                  -- US Pacific calendar day
  roots integer not null default 0,      -- root requests passed on to Google
  refused integer not null default 0,    -- root requests turned away at a cap
  updated_at timestamptz not null default now()
);
alter table public.tiles_proxy_days enable row level security;

-- Takes one root request from the allowance. ok true = go ahead; else reason 'month' or 'day'.
-- Every caller locks today's row first, so two requests can't both take the last one.
create or replace function public.tiles_proxy_take_root(p_day_cap integer, p_month_cap integer)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_day date := (now() at time zone 'America/Los_Angeles')::date;
  v_from date := date_trunc('month', v_day)::date;
  v_today integer;
  v_month integer;
  v_why text;
begin
  insert into tiles_proxy_days (day) values (v_day) on conflict (day) do nothing;
  select roots into v_today from tiles_proxy_days where day = v_day for update;
  select coalesce(sum(roots), 0) into v_month from tiles_proxy_days where day >= v_from and day <= v_day;
  if v_month >= p_month_cap then v_why := 'month';
  elsif v_today >= p_day_cap then v_why := 'day';
  end if;
  if v_why is null then
    update tiles_proxy_days set roots = roots + 1, updated_at = now() where day = v_day;
    v_today := v_today + 1;
    v_month := v_month + 1;
  else
    update tiles_proxy_days set refused = refused + 1, updated_at = now() where day = v_day;
  end if;
  return jsonb_build_object('ok', v_why is null, 'reason', v_why, 'day', v_day,
                            'month', to_char(v_day, 'YYYY-MM'), 'day_used', v_today, 'month_used', v_month);
end $$;

-- What is used so far today and this month (US Pacific), for the function's health answer.
create or replace function public.tiles_proxy_usage()
returns jsonb
language sql
stable
set search_path = public
as $$
  with d as (select (now() at time zone 'America/Los_Angeles')::date as day)
  select jsonb_build_object(
    'day', d.day, 'month', to_char(d.day, 'YYYY-MM'),
    'day_used', coalesce((select roots from tiles_proxy_days t where t.day = d.day), 0),
    'month_used', coalesce((select sum(roots) from tiles_proxy_days t where t.day >= date_trunc('month', d.day)::date and t.day <= d.day), 0))
  from d;
$$;

revoke all on function public.tiles_proxy_take_root(integer, integer) from public, anon, authenticated;
revoke all on function public.tiles_proxy_usage() from public, anon, authenticated;
grant execute on function public.tiles_proxy_take_root(integer, integer) to service_role;
grant execute on function public.tiles_proxy_usage() to service_role;
