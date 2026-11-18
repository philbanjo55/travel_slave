-- Tell T bench runs, round 3 (11 Nov 2026): the "more things to say" rules. 8 Teton weeks each on the local runner,
-- built from the BAloc8 rows. (Rounds 1-2: 20261110030000 / 20261110040000; tellC3, tellE3 (day off), tellF (easy
-- day / max_stops) and tellId4 (no notes on the final step-1 code) were queued by hand the same way.)
--   tellG = icy roads x1.5 (31 Dec, with Cunningham Cabin before Oxbow Bend); no skis (1 Jan); start at Oxbow Bend and
--           end at Snake River Overlook (2 Jan); only the top spots (3 Jan); Taggart & Bradley only on a good chance
--           (whole trip); be at Jenny Lake by 8:00 (whole trip)
--   tellH = the skis go back a day early: Sat 2 Jan, 3:00 PM
--   tellId5 = no notes on this code (must equal BAloc8)
insert into public.replay_runs (trip_id, start_date, trip_dates, nights, config, status)
select r.trip_id, r.start_date, r.trip_dates, r.nights, r.config || jsonb_build_object('name', a.name) || a.extra, 'queued'
  from public.replay_runs r
  cross join (values
    ('tellId5', '{}'::jsonb),
    ('tellG', '{"notes": [
        {"type": "slow_roads", "factor": 1.5, "dates": ["2026-12-31"]},
        {"type": "before", "stops": ["4f448e32-2862-4915-8c5d-c40b5e06a5bd", "6f83a1e6-4acf-4565-b01b-3bdb2a0d846f"], "then": ["bae43395-a5ea-430f-a0cc-5bd2a4f989fa"], "dates": ["2026-12-31"]},
        {"type": "no_gear", "dates": ["2027-01-01"]},
        {"type": "first", "stops": ["bae43395-a5ea-430f-a0cc-5bd2a4f989fa"], "dates": ["2027-01-02"]},
        {"type": "last", "stops": ["fc54451d-6274-4278-a33d-3fc30782e0cf"], "dates": ["2027-01-02"]},
        {"type": "only_top", "tier": "S", "dates": ["2027-01-03"]},
        {"type": "optional", "stops": ["f42654fa-0bc4-49a1-b45d-612be84d6259"], "from_date": "2026-12-29", "to_date": null},
        {"type": "arrive_by", "stops": ["fb31567b-f7c2-4f12-a7b1-6b89506bc6f4"], "time": "08:00", "from_date": "2026-12-29", "to_date": null}]}'::jsonb),
    ('tellH', '{"notes": [{"type": "gear_to", "time": "15:00", "dates": ["2027-01-02"]}]}'::jsonb)
  ) a(name, extra)
 where r.config ->> 'name' = 'BAloc8'
   and not exists (select 1 from public.replay_runs x where x.config ->> 'name' = a.name);
