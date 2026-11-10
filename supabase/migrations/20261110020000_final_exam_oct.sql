-- Final exam for the live planner (worksheet h8, Phil's rule D3: a version is proven when it wins on the 56
-- winter weeks and does not lose on weeks it was never tuned on). BA (winner since 8 Nov) vs AX (the winner it
-- replaced), same current code, on the 10 October 2026 Teton test weeks (the T2_oct rows), judged by the
-- camera vote. Test only: nothing live changes.
insert into public.replay_runs (trip_id, start_date, trip_dates, nights, config, status)
select r.trip_id, r.start_date, r.trip_dates, r.nights,
       r.config || jsonb_build_object('name', a.name, 'sbfix', true, 'truth_vote', true) || a.extra, 'queued'
  from public.replay_runs r
  cross join (values ('exAX_oct', '{}'::jsonb), ('exBA_oct', '{"mustfix": true, "tickfix": true}'::jsonb)) a(name, extra)
 where r.config ->> 'name' = 'T2_oct'
   and not exists (select 1 from public.replay_runs x where x.config ->> 'name' = a.name);
