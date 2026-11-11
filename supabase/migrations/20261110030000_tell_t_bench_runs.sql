-- Tell T (worksheet g4, Phil 10 Nov 2026): bench runs for the note rules in solver-replay (run config notes).
-- Run on the local bench runner (local: true), 8 Teton weeks each, built from the BAloc8 rows (today's planner):
--   tellId = no notes (must equal BAloc8: no notes, no change)
--   tellA  = back by 3 PM (31 Dec), leave after 9 AM (1 Jan), no visit over 90 min (2 Jan)
--   tellB  = Oxbow Bend wanted 2-4 PM (31 Dec), Snake River Overlook skipped 1-2 Jan, busy 12:00-1:30 PM at the inn (1 Jan)
--   tellC  = no drive over 25 min (2 Jan), 150 min at Snake River Overlook (31 Dec), both Moulton barns wanted (3 Jan)
-- Every recorded night carries stats.notes = { rules, broken } from the planner's own check. Test only.
insert into public.replay_runs (trip_id, start_date, trip_dates, nights, config, status)
select r.trip_id, r.start_date, r.trip_dates, r.nights, r.config || jsonb_build_object('name', a.name) || a.extra, 'queued'
  from public.replay_runs r
  cross join (values
    ('tellId', '{}'::jsonb),
    ('tellA', '{"notes": [
        {"type": "back_by", "time": "15:00", "dates": ["2026-12-31"]},
        {"type": "leave_after", "time": "09:00", "dates": ["2027-01-01"]},
        {"type": "max_visit", "minutes": 90, "dates": ["2027-01-02"]}]}'::jsonb),
    ('tellB', '{"notes": [
        {"type": "must", "stops": ["bae43395-a5ea-430f-a0cc-5bd2a4f989fa"], "from": "14:00", "to": "16:00", "dates": ["2026-12-31"]},
        {"type": "skip", "stops": ["fc54451d-6274-4278-a33d-3fc30782e0cf"], "from_date": "2027-01-01", "to_date": "2027-01-02"},
        {"type": "busy", "from": "12:00", "to": "13:30", "label": "Lunch (your note)", "dates": ["2027-01-01"]}]}'::jsonb),
    ('tellC', '{"notes": [
        {"type": "max_leg", "minutes": 25, "dates": ["2027-01-02"]},
        {"type": "stay", "stops": ["fc54451d-6274-4278-a33d-3fc30782e0cf"], "minutes": 150, "dates": ["2026-12-31"]},
        {"type": "must", "stops": ["8200fc29-f054-481f-bdae-5a1031a1d703", "cd94b8ce-8b9e-46e7-979b-50d2c241dcf0"], "dates": ["2027-01-03"]}]}'::jsonb)
  ) a(name, extra)
 where r.config ->> 'name' = 'BAloc8'
   and not exists (select 1 from public.replay_runs x where x.config ->> 'name' = a.name);
