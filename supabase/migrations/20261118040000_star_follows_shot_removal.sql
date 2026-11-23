-- A starred shot taken off a stop left the star pointing at a shot the stop no longer has (18 Nov 2026: Phil took
-- "both bends" (S9) off Snake River Overlook on the real Grand Teton trip; two of its three visits kept S9 starred, so the
-- planner still planned them on a shot that is not on the trip, and the practice copy's sync kept S9 because it never
-- removes a starred shot). solver_star_fallback only ran when the star itself was cleared, not when the shot's link
-- went. Now removing a stop's starred shot clears the star, and the fallback stars the stop's first remaining shot.
create or replace function public.stop_sun_pairs_unstar()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  update solver_stop_settings set star_vantage_id = null
   where stop_id = old.stop_id and star_vantage_id = old.vantage_id;
  return null;
end $$;

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'stop_sun_pairs_unstar' and tgrelid = 'public.stop_sun_pairs'::regclass) then
    create trigger stop_sun_pairs_unstar after delete on public.stop_sun_pairs
      for each row execute function public.stop_sun_pairs_unstar();
  end if;
end $$;

-- the two stars left behind (any trip): clear them, the fallback stars the stop's first remaining shot
update solver_stop_settings ss set star_vantage_id = null
 where ss.star_vantage_id is not null
   and not exists (select 1 from stop_sun_pairs p where p.stop_id = ss.stop_id and p.vantage_id = ss.star_vantage_id);
