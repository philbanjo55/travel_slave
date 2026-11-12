-- HD 3D sun view (TEST app, 12 Nov 2026): the tiles-proxy edge function counts the billable requests
-- (Google's root tile set, one per HD view opened) per UTC day here and refuses them over its cap.
-- Backend only: RLS on with no policy, so the app's public key reads nothing.
create table if not exists public.tiles_proxy_days (
  day date primary key,
  roots integer not null default 0,      -- root requests passed on to Google
  refused integer not null default 0,    -- root requests turned away at the cap
  updated_at timestamptz not null default now()
);
alter table public.tiles_proxy_days enable row level security;

-- Takes one root request from today's allowance. True = go ahead, false = the cap is reached.
create or replace function public.tiles_proxy_take_root(p_cap integer)
returns boolean
language plpgsql
set search_path = public
as $$
declare
  v_day date := (now() at time zone 'utc')::date;
  v_roots integer;
begin
  insert into tiles_proxy_days (day) values (v_day) on conflict (day) do nothing;
  update tiles_proxy_days set roots = roots + 1, updated_at = now()
   where day = v_day and roots < p_cap
  returning roots into v_roots;
  if v_roots is null then
    update tiles_proxy_days set refused = refused + 1, updated_at = now() where day = v_day;
    return false;
  end if;
  return true;
end $$;
revoke all on function public.tiles_proxy_take_root(integer) from public, anon, authenticated;
grant execute on function public.tiles_proxy_take_root(integer) to service_role;
