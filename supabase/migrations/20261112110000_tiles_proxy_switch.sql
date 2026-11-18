-- HD 3D sun view: the on / off switch for the tiles-proxy door, kept in the database (12 Nov 2026).
-- Phil: "I don't wanna have to do it thru supabase" (function secrets), so the switch is one row here that a
-- session can set with SQL; the door reads it at most once a minute. Off by default. A function secret
-- TILES_ENABLED = "true" / "false" still overrides it either way.
-- Backend only: RLS on with no policy, the function for the service role only.
create table if not exists public.tiles_proxy_switch (
  id boolean primary key default true check (id),   -- one row only
  enabled boolean not null default false,
  note text,
  updated_at timestamptz not null default now()
);
alter table public.tiles_proxy_switch enable row level security;
insert into public.tiles_proxy_switch (id, enabled, note) values (true, false, 'off until Phil says') on conflict (id) do nothing;

create or replace function public.tiles_proxy_enabled()
returns boolean
language sql
stable
set search_path = public
as $$
  select coalesce((select enabled from tiles_proxy_switch where id), false);
$$;
revoke all on function public.tiles_proxy_enabled() from public, anon, authenticated;
grant execute on function public.tiles_proxy_enabled() to service_role;
