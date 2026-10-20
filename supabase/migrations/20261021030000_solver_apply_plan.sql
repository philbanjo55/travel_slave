-- APPLY A PLAN (Phil, 20 Oct 2026): the plan's stops move to the trip day
-- the plan puts them on (multi-day plans: each stop to its own day); stops the
-- plan does not use stay where they are. Only UPDATE stops (day_id,
-- position, time_label, drive_override_minutes), never insert or delete.
--
--   solver_apply_plan(run, rank)              preview, writes nothing
--   solver_apply_plan(run, rank, true)        apply, logged in solver_applies
--   solver_undo_apply(apply_id)               put every touched stop back
--
-- Order on each touched day: the day's first and last stops that stay (hotel
-- departure, sleep) keep their ends; everything else by time, planned stops
-- at the plan's start time (time_label rewritten), staying stops at their own
-- time_label (untimed ones right after the stop before them). Drive legs
-- (drive_override_minutes = leg from the previous stop) are refreshed from
-- solver_drive_matrix where the previous stop changed. The other stops'
-- time_labels are left alone: the app's Recalculate Schedule redoes them.

create table public.solver_applies (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  run_id uuid references public.solver_runs(id) on delete set null,
  rank integer not null,
  applied_at timestamptz not null default now(),
  undone_at timestamptz,
  before jsonb not null,  -- [{id, day_id, position, time_label, drive_override_minutes}]
  after jsonb not null
);

-- "5:50 AM", "~5:50 AM" -> 350
create or replace function public.solver_label_minutes(p_label text)
returns integer language sql immutable set search_path to 'public' as $$
  select case when m is null then null
              else ((m[1]::int % 12) + case when upper(m[3]) = 'PM' then 12 else 0 end) * 60 + m[2]::int end
    from (select regexp_match(trim(coalesce(p_label, '')), '^~?\s*(\d{1,2}):(\d{2})\s*(AM|PM)$', 'i') m) x
$$;

-- 2027-05-20 05:45+01 -> "5:45 AM" (the app's time_label format)
create or replace function public.solver_time_label(p_at timestamptz, p_tz text)
returns text language sql stable set search_path to 'public' as $$
  select to_char(p_at at time zone p_tz, 'FMHH12:MI AM')
$$;

create or replace function public.solver_apply_plan(p_run_id uuid, p_rank integer default 1, p_apply boolean default false)
returns jsonb language plpgsql set search_path to 'public' as $$
declare
  v_trip uuid;
  v_visits jsonb;
  v_tz text;
  v_bad jsonb;
  v_before jsonb;
  v_after jsonb;
  v_days jsonb;
  v_apply uuid;
  v_changed integer;
  v_repeats jsonb;
begin
  if p_rank = 0 then raise exception 'rank 0 is the day as it stands, nothing to apply'; end if;
  select r.trip_id, p.visits into v_trip, v_visits
    from solver_runs r join solver_plans p on p.run_id = r.id and p.rank = p_rank
   where r.id = p_run_id;
  if v_trip is null then raise exception 'plan %/% not found', p_run_id, p_rank; end if;
  v_tz := solver_trip_tz(v_trip);

  -- Scratch tables live until the end of the transaction: one call each.
  -- The plan's free visits and the trip day each one goes to. A stop a
  -- multi-day plan visits twice can sit on one day only: the first visit
  -- wins, the repeat is reported.
  create temp table _sap_plan on commit drop as
  select distinct on (stop_id) * from (
    select (v->>'stop_id')::uuid as stop_id,
           coalesce(v->>'trip_date', v->>'date')::date as trip_date,
           (v->>'start')::timestamptz as start_at,
           d.id as day_id
      from jsonb_array_elements(v_visits) v
      left join days d on d.trip_id = v_trip and d.date = coalesce(v->>'trip_date', v->>'date')::date
     where not coalesce((v->>'booked')::boolean, false)) x
   order by stop_id, start_at;
  select jsonb_agg(jsonb_build_object('stop_id', v->>'stop_id', 'name', v->>'name', 'date', coalesce(v->>'trip_date', v->>'date')))
    into v_repeats
    from jsonb_array_elements(v_visits) v
   where not coalesce((v->>'booked')::boolean, false)
     and (v->>'start')::timestamptz > (select p.start_at from _sap_plan p where p.stop_id = (v->>'stop_id')::uuid);

  select jsonb_agg(distinct p.trip_date) into v_bad from _sap_plan p where p.day_id is null;
  if v_bad is not null then raise exception 'no trip day on %', v_bad; end if;
  select jsonb_agg(p.stop_id) into v_bad from _sap_plan p
   where not exists (select 1 from stops s where s.id = p.stop_id and s.trip_id = v_trip);
  if v_bad is not null then raise exception 'stops not on this trip: %', v_bad; end if;

  -- Every stop on the days the plan touches: its target days and the days its
  -- stops leave.
  create temp table _sap_cur on commit drop as
  select s.id, s.day_id, s.position, s.time_label, s.drive_override_minutes, s.name
    from stops s
   where s.day_id in (select day_id from _sap_plan
                      union select s2.day_id from stops s2 join _sap_plan p on p.stop_id = s2.id);

  create temp table _sap_new on commit drop as
  with stay as (
    select c.*,
           row_number() over (partition by c.day_id order by c.position, c.id) as rn,
           count(*) over (partition by c.day_id) as cnt,
           solver_label_minutes(c.time_label) as t
      from _sap_cur c
     where c.id not in (select stop_id from _sap_plan)
  ), stay_keyed as (
    select s.id, s.day_id, s.position, s.time_label as label, false as planned,
           case when s.rn = 1 then -1                        -- departure stays first
                when s.rn = s.cnt then 100000                -- sleep stays last
                else coalesce(s.t, max(s.t) over (partition by s.day_id order by s.rn rows unbounded preceding), -1)
           end as k
      from stay s
  ), planned as (
    select p.stop_id as id, p.day_id, null::integer as position, solver_time_label(p.start_at, v_tz) as label, true as planned,
           (extract(hour from p.start_at at time zone v_tz) * 60 + extract(minute from p.start_at at time zone v_tz))::integer as k
      from _sap_plan p
  ), ordered as (
    select x.*, row_number() over (partition by x.day_id order by x.k, x.planned, x.position, x.label) - 1 as new_pos
      from (select * from stay_keyed union all select * from planned) x
  ), legs as (
    select o.*, lag(o.id) over (partition by o.day_id order by o.new_pos) as new_prev
      from ordered o
  ), old_legs as (
    select c.id, lag(c.id) over (partition by c.day_id order by c.position, c.id) as old_prev from _sap_cur c
  )
  select l.id, l.day_id, l.new_pos::integer as position, l.label as time_label, l.planned,
         case when l.new_prev is not null and l.new_prev is distinct from ol.old_prev
              then coalesce((select round(m.minutes)::integer from solver_drive_matrix m
                              where m.trip_id = v_trip and m.from_stop_id = l.new_prev and m.to_stop_id = l.id),
                            c.drive_override_minutes)
              else c.drive_override_minutes end as drive_override_minutes
    from legs l
    left join old_legs ol on ol.id = l.id
    left join stops c on c.id = l.id;

  select jsonb_agg(jsonb_build_object('id', c.id, 'day_id', c.day_id, 'position', c.position,
                                      'time_label', c.time_label, 'drive_override_minutes', c.drive_override_minutes)),
         count(*) filter (where (n.day_id, n.position, n.time_label, n.drive_override_minutes)
                                is distinct from (c.day_id, c.position, c.time_label, c.drive_override_minutes))
    into v_before, v_changed
    from _sap_new n join stops c on c.id = n.id;
  select jsonb_agg(jsonb_build_object('id', n.id, 'day_id', n.day_id, 'position', n.position,
                                      'time_label', n.time_label, 'drive_override_minutes', n.drive_override_minutes))
    into v_after from _sap_new n;

  -- What each touched day looks like afterwards.
  select jsonb_agg(jsonb_build_object('date', d.date, 'day_number', d.day_number, 'stops', x.stops) order by d.date)
    into v_days
    from (select n.day_id, jsonb_agg(jsonb_build_object(
                   'position', n.position, 'name', s.name, 'time_label', n.time_label,
                   'planned', n.planned,
                   'moved_from', case when s.day_id <> n.day_id then (select date from days where id = s.day_id) end,
                   'retimed', n.time_label is distinct from s.time_label,
                   'drive', n.drive_override_minutes) order by n.position) as stops
            from _sap_new n join stops s on s.id = n.id group by n.day_id) x
    join days d on d.id = x.day_id;

  if p_apply then
    insert into solver_applies (trip_id, run_id, rank, before, after)
    values (v_trip, p_run_id, p_rank, v_before, v_after) returning id into v_apply;
    update stops s
       set day_id = n.day_id, position = n.position, time_label = n.time_label,
           drive_override_minutes = n.drive_override_minutes
      from _sap_new n
     where s.id = n.id
       and (s.day_id, s.position, s.time_label, s.drive_override_minutes)
           is distinct from (n.day_id, n.position, n.time_label, n.drive_override_minutes);
  end if;

  return jsonb_build_object('applied', p_apply, 'apply_id', v_apply, 'stops_changed', v_changed,
                            'repeats_not_placed', v_repeats, 'days', v_days);
end $$;
revoke execute on function public.solver_apply_plan(uuid, integer, boolean) from public, anon, authenticated;

-- Put every stop an apply touched back where it was (also UPDATE only).
create or replace function public.solver_undo_apply(p_apply_id uuid)
returns jsonb language plpgsql set search_path to 'public' as $$
declare v_before jsonb; n integer;
begin
  select before into v_before from solver_applies where id = p_apply_id and undone_at is null;
  if v_before is null then raise exception 'apply % not found or already undone', p_apply_id; end if;
  update stops s
     set day_id = (b->>'day_id')::uuid, position = (b->>'position')::integer,
         time_label = b->>'time_label', drive_override_minutes = (b->>'drive_override_minutes')::integer
    from jsonb_array_elements(v_before) b
   where s.id = (b->>'id')::uuid;
  get diagnostics n = row_count;
  update solver_applies set undone_at = now() where id = p_apply_id;
  return jsonb_build_object('undone', p_apply_id, 'stops', n);
end $$;
revoke execute on function public.solver_undo_apply(uuid) from public, anon, authenticated;
