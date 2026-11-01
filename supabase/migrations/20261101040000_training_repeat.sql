-- Practice trips repeat (Phil, 1 Nov 2026: "when each trip ends, make it repeat so we can
-- learn from it"): Teton Live until the real trip (28 Dec), Faroes Live until the real Faroes
-- trip (12 May 2027).
--  * The repeat happens just after local midnight after the last day (hourly check), so the
--    last day is lived and day 1 of the new round is planned before its sunrise. Before, it
--    fired at 12:00 UTC ON the last day, which was then never lived (Teton Live's 30 Oct).
--  * Each repeat also moves T's dated settings for the trip (fixed days, gear window, booked
--    stops on dates) by the same number of days, starts a new live T run (evening plan +
--    morning re-plan, published to the app) for the new dates, and clears the trip's ticks
--    (a new round starts with nothing shot).

update trips set training_until = date '2026-12-28' where id = '7e57bed0-0000-4000-8000-000000000003';
update trips set training_until = date '2027-05-12' where id = '7e57bed0-0000-4000-8000-000000000002';

-- T's run config with every date moved by p_days.
create or replace function public.planner_t_shift_config(p_cfg jsonb, p_days int)
returns jsonb language sql immutable as $$
  select p_cfg
    || case when p_cfg ? 'fixed_days' then jsonb_build_object('fixed_days',
         (select coalesce(jsonb_agg(to_jsonb((d #>> '{}')::date + p_days)), '[]'::jsonb) from jsonb_array_elements(p_cfg -> 'fixed_days') d)) else '{}'::jsonb end
    || case when p_cfg ? 'anchors_on' then jsonb_build_object('anchors_on',
         (select coalesce(jsonb_agg(a || jsonb_build_object('date', (a ->> 'date')::date + p_days)), '[]'::jsonb) from jsonb_array_elements(p_cfg -> 'anchors_on') a)) else '{}'::jsonb end
    || case when p_cfg ? 'gear' then jsonb_build_object('gear', (p_cfg -> 'gear')
         || case when p_cfg -> 'gear' ? 'from' then jsonb_build_object('from', (p_cfg #> '{gear,from}') || jsonb_build_object('date', (p_cfg #>> '{gear,from,date}')::date + p_days)) else '{}'::jsonb end
         || case when p_cfg -> 'gear' ? 'to' then jsonb_build_object('to', (p_cfg #> '{gear,to}') || jsonb_build_object('date', (p_cfg #>> '{gear,to,date}')::date + p_days)) else '{}'::jsonb end)
       else '{}'::jsonb end
$$;

create or replace function public.training_trip_roll()
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare r record; v_out jsonb := '[]'::jsonb; n int; v_dates date[];
begin
  for r in select t.id, t.end_date, t.training_until, solver_trip_tz(t.id) as tz from trips t
            where t.id in (select training_trips_active()) loop
    if (now() at time zone r.tz)::date > r.end_date and r.end_date < r.training_until then
      select count(*) into n from days where trip_id = r.id;
      v_out := v_out || live_trip_shift(r.id, n);
      -- A new round starts with nothing shot.
      update solver_stop_settings ss set shot_status = null, shot_value = null, shot_at = null
        from stops s where s.id = ss.stop_id and s.trip_id = r.id and ss.shot_status is not null;
      -- T's dated settings move with the trip, and a new live T run plans the new round.
      update planner_t_trips set config = planner_t_shift_config(config, n), updated_at = now() where trip_id = r.id;
      if exists (select 1 from planner_t_trips where trip_id = r.id) then
        v_dates := array(select d.date from days d where d.trip_id = r.id order by d.date);
        insert into replay_runs (trip_id, start_date, trip_dates, nights, config)
        select r.id, v_dates[1], v_dates, cardinality(v_dates),
               p.config || '{"name": "app_T", "live": true, "publish": true, "plan_local": "20:45", "stagger_min": 6}'::jsonb
          from planner_t_trips p where p.trip_id = r.id;
        perform planner_t_week(r.id);
      end if;
    end if;
  end loop;
  return v_out;
end $$;
revoke all on function public.training_trip_roll() from public, anon, authenticated;

select cron.unschedule('training-roll');
select cron.schedule('training-roll', '5 * * * *', $$select public.training_trip_roll()$$);
