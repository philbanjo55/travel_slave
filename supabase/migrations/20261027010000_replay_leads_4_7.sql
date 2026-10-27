-- Planner test bench: forecasts made 4 to 7 days ahead (Phil, 27 Oct 2026: "do
-- archived as deep as possible for testing/tuning"). Open-Meteo's Previous Runs
-- archive keeps each model's run from 1 to 7 days before (previous_day1..7) and
-- starts in early 2024, so both Teton winters (Dec-Jan 2024-25, 2025-26) are as
-- deep as it goes in time; this adds the missing leads 4-7 for the Teton cell.
-- Model key 'x@4567' fetches them in one request and stores 'x@4' .. 'x@7'.
-- HRRR is left out (its runs only reach 2 days).

do $$
declare d text := pg_get_functiondef('replay_fetch_tick()'::regprocedure);
  a1 text := 'select unnest(case when r.model like ''%@23'' then array[2, 3]';
  a2 text := '      when r.model like ''%@0''' || chr(10) || '      then ''https://previous-runs-api.open-meteo.com/v1/forecast?hourly=direct_radiation,cloud_cover&models='' || split_part(r.model, ''@'', 1)';
begin
  if position(a1 in d) = 0 or position(a2 in d) = 0 then raise exception 'replay_fetch_tick: text not found'; end if;
  d := replace(d, a1, 'select unnest(case when r.model like ''%@4567'' then array[4, 5, 6, 7] when r.model like ''%@23'' then array[2, 3]');
  d := replace(d, a2, '      when r.model like ''%@4567''' || chr(10)
    || '      then ''https://previous-runs-api.open-meteo.com/v1/forecast?hourly=direct_radiation_previous_day4,cloud_cover_previous_day4,direct_radiation_previous_day5,cloud_cover_previous_day5,direct_radiation_previous_day6,cloud_cover_previous_day6,direct_radiation_previous_day7,cloud_cover_previous_day7&models='' || split_part(r.model, ''@'', 1)' || chr(10) || a2);
  execute d;
end $$;

insert into replay_fetch (kind, model, point_key, start_date, end_date)
select f.kind, split_part(f.model, '@', 1) || '@4567', f.point_key, f.start_date, f.end_date
  from replay_fetch f join replay_points p on p.point_key = f.point_key
 where f.model like '%@23' and p.lat < 55 and f.model not like 'ncep_hrrr%'
on conflict do nothing;

select cron.schedule('replay-fetch', '*/2 * * * *', 'select public.replay_fetch_tick();');
