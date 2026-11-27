-- Expose the score through the view, so it is computed in one place and the
-- app stops carrying its own copy of the maths.
--
-- shot_type is joined LIVE from stops rather than read from the stored row:
-- change a stop from landscape to reflection and the stars follow on the next
-- read, which is the behaviour the app's local copy existed to provide.
--
-- Retroactive, like the rest of the contract. Rows scored by an older
-- generation of the function (the one that carried a `light` penalty) are
-- re-scored under current rules on read; their stored score_* columns keep
-- the original as a record of what was shown at the time.
--
-- `score` is appended after `display`; nothing before it moves, so existing
-- readers are unaffected.
create or replace view public.latest_weather_per_stop as
select l.*,
       public.weather_display(l.*)              as display,
       public.weather_score(l.*, st.shot_type)  as score
from (
  select distinct on (stop_id) *
  from public.weather_forecasts
  order by
    stop_id,
    ((raw -> 'provenance' ->> 'date_mode') = 'trip-date') desc nulls last,
    fetched_at desc
) l
left join public.stops st on st.id = l.stop_id;
