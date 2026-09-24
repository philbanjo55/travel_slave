-- Profile sampling as one join against dem_blocks. Pinning search_path stopped
-- dem_cell() from being inlined, and 25,560 separate calls per pin went from
-- ~0.7 s to ~2.3 s; the join is back to ~0.8 s with identical samples.
create or replace function public.terrain_profile_compute(p_profile uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  p      record;
  ground double precision;
  arr    double precision[];
begin
  select * into p from public.terrain_profiles where id = p_profile;
  if not found then return; end if;

  ground := public.dem_elevation(p.lat, p.lng);
  if ground is null then
    update public.terrain_profiles
       set status = 'outside_dem', ground_m = null, samples = null, completed_at = now()
     where id = p_profile;
    return;
  end if;

  -- One join against dem_blocks rather than 25,560 dem_cell() calls.
  with pts as (
    select a, k,
           round((62.45 - s.s_lat) * 3600)::int as r,
           round((s.s_lng + 7.75) * 1800)::int  as c
    from generate_series(0, 179) a
    cross join generate_series(0, 141) k
    cross join (select public.terrain_distances() as d) dd
    cross join lateral public.terrain_sample_coord(p.lat, p.lng, a * 2, dd.d[k + 1]) s
  )
  select array_agg(coalesce(b.cells[(pts.c % 90) + 1], 0)::double precision order by pts.a, pts.k)
    into arr
    from pts
    left join public.dem_blocks b
      on pts.r between 0 and 3959 and pts.c between 0 and 2789
     and b.r = pts.r and b.b = pts.c / 90;

  update public.terrain_profiles
     set ground_m = ground, samples = arr, status = 'complete', completed_at = now()
   where id = p_profile;
end $$;
revoke execute on function public.terrain_profile_compute(uuid) from public, anon, authenticated;
