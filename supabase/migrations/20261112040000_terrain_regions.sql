-- 3D sun view (TEST app, Phil 12 Nov 2026): one elevation file per area, kept in Storage and saved on the phone.
-- The file is a 16-bit PNG of prediction residuals (tools/sun3d/build_dem.py); the app picks the region that holds a stop.
insert into storage.buckets (id, name, public) values ('terrain', 'terrain', true) on conflict (id) do nothing;

create table if not exists public.terrain_regions (
  id text primary key,
  north double precision not null, south double precision not null,
  west double precision not null, east double precision not null,
  n integer not null,                 -- the grid is n x n points, row 0 at the north edge
  width_m double precision not null, depth_m double precision not null,
  base_m double precision not null default 1500,   -- height = base_m + value * step_m
  step_m double precision not null default 0.5,
  path text not null,                 -- object path in bucket terrain
  bytes integer,
  ground text not null default 'snow' check (ground in ('snow', 'green')),
  note text,
  created_at timestamptz not null default now()
);
alter table public.terrain_regions enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'terrain_regions' and policyname = 'app_read') then
    create policy app_read on public.terrain_regions for select using (true);
  end if;
end $$;

insert into public.terrain_regions (id, north, south, west, east, n, width_m, depth_m, path, bytes, ground, note)
values ('grand_teton', 43.95, 43.45, -110.92, -110.24, 2048, 54727, 55566, 'grand_teton_z12.png', 2278232, 'snow',
        'Public terrarium tiles, zoom 12 (~27 m). Winter trip: snow.')
on conflict (id) do nothing;
