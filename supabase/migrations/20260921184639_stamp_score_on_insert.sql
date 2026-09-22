-- Stamp the score as the row is written, using the same function the view
-- uses. weather-pull sends its own score_* values today; they are overwritten
-- here, which is what lets the scoring be removed from that program without a
-- window where rows arrive unscored.
--
-- INSERT only, deliberately. The retention job rewrites `raw` on old rows,
-- stripping precip_total_mm among other things — re-scoring on update would
-- silently change the stars of a row purely because it was pruned.
--
-- Existing rows are left alone. They are the record of what was shown at the
-- time, and a backfill would rewrite it.
create or replace function public.weather_forecasts_stamp_score()
returns trigger language plpgsql as $$
declare
  st text;
  sc jsonb;
begin
  select shot_type into st from public.stops where id = new.stop_id;
  sc := public.weather_score(new, st);

  -- null for logistics and untyped stops, matching what weather-pull wrote.
  new.score_stars      := (sc ->> 'stars')::int;
  new.score_label      :=  sc ->> 'label';
  new.score_reason     :=  sc ->> 'reason';
  new.score_components :=  sc ->  'components';
  return new;
end $$;

drop trigger if exists weather_forecasts_score on public.weather_forecasts;
create trigger weather_forecasts_score
before insert on public.weather_forecasts
for each row execute function public.weather_forecasts_stamp_score();
