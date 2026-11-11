-- Tell T bench runs, round 2 (10 Nov 2026): after the fixes from round 1 (a busy block keeps its own length, a wanted
-- pair whose best moments clash still fits, a wanted place is planned even where the day has no score for it, places
-- that lose their last day are listed in stats.notes.lost). Same 8 Teton weeks on the local runner:
--   tellId2 = no notes (must equal BAloc8), tellA2 / tellB2 / tellC2 = round 1's notes,
--   tellD2  = mixed: Jenny Lake skipped for the whole trip; 31 Dec leave after 8:00 + busy 3-4 PM at the inn;
--             1 Jan no visit over 60 min but Taggart & Bradley wanted; 2 Jan back by 2 PM + Oxbow Bend wanted.
insert into public.replay_runs (trip_id, start_date, trip_dates, nights, config, status)
select r.trip_id, r.start_date, r.trip_dates, r.nights, r.config || jsonb_build_object('name', a.name) || a.extra, 'queued'
  from public.replay_runs r
  cross join (
    select (x.config ->> 'name') || '2' as name, jsonb_build_object('notes', coalesce(x.config -> 'notes', '[]'::jsonb)) as extra
      from (select distinct on (config ->> 'name') config from public.replay_runs where config ->> 'name' in ('tellId', 'tellA', 'tellB', 'tellC')) x
    union all
    select 'tellD2', '{"notes": [
        {"type": "skip", "stops": ["fb31567b-f7c2-4f12-a7b1-6b89506bc6f4"], "from_date": "2026-12-29", "to_date": null},
        {"type": "leave_after", "time": "08:00", "dates": ["2026-12-31"]},
        {"type": "busy", "from": "15:00", "to": "16:00", "label": "Massage (your note)", "dates": ["2026-12-31"]},
        {"type": "max_visit", "minutes": 60, "dates": ["2027-01-01"]},
        {"type": "must", "stops": ["f42654fa-0bc4-49a1-b45d-612be84d6259"], "dates": ["2027-01-01"]},
        {"type": "back_by", "time": "14:00", "dates": ["2027-01-02"]},
        {"type": "must", "stops": ["bae43395-a5ea-430f-a0cc-5bd2a4f989fa"], "dates": ["2027-01-02"]}]}'::jsonb
  ) a
 where r.config ->> 'name' = 'BAloc8'
   and not exists (select 1 from public.replay_runs x where x.config ->> 'name' = a.name);
