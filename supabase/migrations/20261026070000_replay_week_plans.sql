-- Planner test bench, part 10: the four-way test (Phil, 26 Oct 2026: "add the
-- rules then run it"). solver-replay plans blk (improve my week, day blocks)
-- and imp (improve my week, free) over all the trip's remaining days: the
-- forecast for the next 3 days, light only beyond. replay_run_tick now makes
-- the 1-3 day builds for them too and fills the light geometry of the later
-- days (cleared behind the runs as before).

do $$
declare d text := pg_get_functiondef('replay_run_tick()'::regprocedure);
  a text := 'v_hz := case when v_kinds && array[''fc3'', ''lt3'', ''hs3''] then 2 else 0 end;';
  b text := '    exception when others then';
begin
  if position(a in d) = 0 or position(b in d) = 0 then raise exception 'replay_run_tick: text not found'; end if;
  d := replace(d, a, 'v_hz := case when v_kinds && array[''fc3'', ''lt3'', ''hs3'', ''blk'', ''imp''] then 2 else 0 end;');
  d := replace(d, b, '      if v_kinds && array[''blk'', ''imp''] and r.night + 3 <= r.nights - 1 then
        perform solver_fill_light_cache(r.trip_id, array(select (r.start_date + j)::date from generate_series(r.night + 3, r.nights - 1) j), 30);
      end if;
' || b);
  execute d;
end $$;

-- The Grand Teton runs: 56 past weeks (every 2nd day from 1 Dec to 25 Jan,
-- both winters), today's schedule and settings, four planners plus fc3.
--   fc1 = the old planner, tomorrow only   fc3 = the old planner, 3 days together
--   blk / imp = improve my week            my = Phil's schedule as written
-- Day 1 and Day 7 are fixed (flights); ski pickup and return stay on their
-- trip days; ski stops only between them.
insert into replay_runs (trip_id, start_date, trip_dates, nights, config)
select '5e247891-d800-4d07-b5e0-8ad748ae2754', s::date,
       (select array_agg(date order by date) from days where trip_id = '5e247891-d800-4d07-b5e0-8ad748ae2754'), 7,
       '{"name": "week4", "kinds": ["fc1", "fc3", "blk", "imp", "my"], "budget_ms": 700,
         "fixed_days": ["2026-12-29", "2027-01-04"],
         "anchors_on": [{"stop_id": "e8cd127e-cee8-4376-a8a2-7a4808513019", "date": "2026-12-30"},
                        {"stop_id": "ad52beaf-9a1c-466d-94b7-9f469e207794", "date": "2027-01-03"}],
         "gear": {"stops": ["e24ab209-e8c2-429d-b9df-4d44bdec601a", "fb31567b-f7c2-4f12-a7b1-6b89506bc6f4",
                            "8200fc29-f054-481f-bdae-5a1031a1d703", "cd94b8ce-8b9e-46e7-979b-50d2c241dcf0",
                            "fe08c4e1-4a37-42ba-852f-1c3eac921d92", "f42654fa-0bc4-49a1-b45d-612be84d6259",
                            "4d506ef3-2878-4725-80f3-2996766171c0", "093ce0ad-9252-4c1b-ac00-ed66a2ec5028"],
                  "from": {"date": "2026-12-30", "time": "14:30"}, "to": {"date": "2027-01-03", "time": "12:40"}}}'::jsonb
  from (select generate_series(date '2024-12-01', date '2025-01-25', interval '2 days') s
        union all select generate_series(date '2025-12-01', date '2026-01-25', interval '2 days')) x
on conflict do nothing;
