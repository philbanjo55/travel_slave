-- Phil, 23 Oct 2026: he removes the auto-made "main" vantages in the app as
-- he adds his own. Removing the starred vantage set star_vantage_id to null
-- (FK on delete set null), which silently took the stop out of the planner.
-- Now another of the stop's vantages is starred instead, when it has one.
create or replace function public.solver_star_fallback()
 returns trigger language plpgsql set search_path to 'public'
as $function$
begin
  -- The starred vantage was removed (FK sets it to null): star another of the
  -- stop's vantages, the first by position, so the stop stays in the planner.
  if new.star_vantage_id is null and old.star_vantage_id is not null then
    select p.vantage_id into new.star_vantage_id
      from stop_sun_pairs p join scout_vantages v on v.id = p.vantage_id
     where p.stop_id = new.stop_id and p.vantage_id <> old.star_vantage_id
     order by p.position nulls last, v.name
     limit 1;
  end if;
  return new;
end $function$;
create trigger solver_star_fallback before update of star_vantage_id on public.solver_stop_settings
  for each row execute function public.solver_star_fallback();
