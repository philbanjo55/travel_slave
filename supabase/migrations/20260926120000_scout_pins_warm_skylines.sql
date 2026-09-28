-- Terrain is automatic for every vantage and subject, not only linked pairs.
--
-- Already in place: scout_attach_terrain (BEFORE INSERT/UPDATE OF lat, lng)
-- builds the pin's terrain profile from the local DEM as the row is saved.
-- Added here: once the row is saved, its final skyline is computed at the
-- observer height the planner uses and kept in terrain_skyline_cache, so a
-- stop linked later is ready at once. Also re-runs when a vantage's
-- elevation_m or a subject's height_m changes, since those set the height.
-- A failure here never blocks saving a pin: it is logged and the skyline is
-- computed on first use instead.
--
-- One-time catch-up for pins saved before scout_attach_terrain existed (run
-- once, in batches, after this migration):
--   update public.scout_vantages set lat = lat where lat is not null and terrain_profile_id is null;
--   update public.scout_subjects set lat = lat where lat is not null and terrain_profile_id is null;
--
-- Undo:
--   drop trigger if exists scout_vantages_warm_skyline on public.scout_vantages;
--   drop trigger if exists scout_subjects_warm_skyline on public.scout_subjects;
--   drop function if exists public.scout_warm_skyline();

create or replace function public.scout_warm_skyline()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  ground double precision;
begin
  if new.terrain_profile_id is null then return new; end if;
  select ground_m into ground from public.terrain_profiles where id = new.terrain_profile_id;
  begin
    if tg_table_name = 'scout_vantages' then
      perform public.skyline_cached(new.terrain_profile_id, coalesce(new.elevation_m, ground, 0) + 1.6);
    else
      perform public.skyline_cached(new.terrain_profile_id, coalesce(new.height_m, ground, 0) + 2);
    end if;
  exception when others then
    raise warning 'skyline warm-up failed for % %: %', tg_table_name, new.id, sqlerrm;
  end;
  return new;
end $$;

drop trigger if exists scout_vantages_warm_skyline on public.scout_vantages;
create trigger scout_vantages_warm_skyline
  after insert or update of lat, lng, elevation_m on public.scout_vantages
  for each row execute function public.scout_warm_skyline();

drop trigger if exists scout_subjects_warm_skyline on public.scout_subjects;
create trigger scout_subjects_warm_skyline
  after insert or update of lat, lng, height_m on public.scout_subjects
  for each row execute function public.scout_warm_skyline();
