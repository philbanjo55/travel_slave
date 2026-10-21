-- Coarse grids invent nearby walls. On the 0.0015 deg (~55 m) Teton grid the
-- Grand Teton aim point sits at 4,084 m while cells ~100 m away reach
-- 4,128 m, so its horizon showed 23-33 deg to the S/SW and the summit was
-- "in shadow" all December day. Horizons from a region grid now ignore
-- terrain closer than two grid steps (min_dist_m); the Faroe DEM (1 arc-sec)
-- keeps 0. Teton profiles are recomputed and the skyline and light caches
-- refreshed in place (upserts, nothing deleted).

alter table public.terrain_profiles add column if not exists min_dist_m real not null default 0;

do $do$
declare d text; n text;
begin
  d := pg_get_functiondef('public.terrain_profile_compute(uuid)'::regprocedure);
  n := replace(d,
$a$  update public.terrain_profiles
     set ground_m = ground, samples = arr, status = 'complete', completed_at = now()
   where id = p_profile;
end $function$$a$,
$b$  update public.terrain_profiles
     set ground_m = ground, samples = arr, status = 'complete', completed_at = now(),
         min_dist_m = case when g.region is null then 0 else 2 * g.step * 111000 end
   where id = p_profile;
end $function$$b$);
  if n = d then raise exception 'terrain_profile_compute text not matched'; end if;
  execute n;

  d := pg_get_functiondef('public.terrain_horizon(uuid, double precision)'::regprocedure);
  n := replace(d,
$a$    where p.id = p_profile and p.status = 'complete'$a$,
$b$    where p.id = p_profile and p.status = 'complete'
      and dd.d[((u.i - 1) % n) + 1] >= p.min_dist_m$b$);
  if n = d then raise exception 'terrain_horizon text not matched'; end if;
  execute n;
end $do$;

-- Applied as the function changes above only; then, by hand (the recompute
-- did not fit the 60 s migration window, and the samples don't change):
--   update terrain_profiles set min_dist_m = 2 * step * 111000 for complete
--     profiles inside grand_teton outside the Faroe DEM (38 rows);
--   update terrain_skyline_cache set sky = terrain_horizon(...) for them;
--   upsert solver_light_cache from vantage_light() for the Teton trip days.
-- Result: Grand Teton summit horizon S/SW -4 deg (was +23..33).
