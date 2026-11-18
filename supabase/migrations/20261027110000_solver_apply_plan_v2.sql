-- APPLY A PLAN v2 (Phil, 27 Oct 2026, after the #7 execution test). v1 moved the
-- plan's stops and left everything else, which on a whole week gave clashes with
-- Phil's other entries for the same place, stale hotel departure / return times,
-- and left out repeat visits (the itinerary holds a stop once). v2:
--  * a place = the trip's stops with the same name (Phil lists some places on
--    several days as retries: Oxbow Bend x3, Snake River x3, ...). Each planned
--    visit uses that place's entry already on the visit's day, else the planned
--    stop, else another unused entry of the place, else a NEW entry (a copy of
--    the planned stop, settings and shots; inserting is allowed, never deleting).
--  * entries of a planned place that the plan does not use are set aside
--    (day_id null; tier kept: the planner already decides retries, Phil: "it
--    only retried again if there were better conditions").
--  * time-locked stops (flights, booked times) are never moved or retimed.
--  * each touched day: the first stop (hotel departure) is retimed to leave in time
--    for the first planned visit, the last stop (back at the inn) to the end of
--    the last stop plus the drive, unless they are time-locked.
-- solver_undo_apply puts every touched stop back; entries v2 inserted are set
-- aside with tier null (stops are never removed).
--   solver_apply_plan(run, rank)        preview, writes nothing
--   solver_apply_plan(run, rank, true)  apply, logged in solver_applies

alter table public.solver_applies add column if not exists inserted uuid[];

create or replace function public.solver_apply_plan(p_run_id uuid, p_rank integer default 1, p_apply boolean default false)
 returns jsonb
 language plpgsql
 set search_path to 'public'
as $function$
declare
  v_trip uuid; v_visits jsonb; v_tz text; v_bad jsonb;
  v_before jsonb; v_after jsonb; v_days jsonb; v_apply uuid; v_changed int;
  r record; v_entry uuid; v_new uuid[] := '{}'; v_clash jsonb; v_aside jsonb;
begin
  if p_rank = 0 then raise exception 'rank 0 is the day as it stands, nothing to apply'; end if;
  select r2.trip_id, p.visits into v_trip, v_visits
    from solver_runs r2 join solver_plans p on p.run_id = r2.id and p.rank = p_rank where r2.id = p_run_id;
  if v_trip is null then raise exception 'plan %/% not found', p_run_id, p_rank; end if;
  v_tz := solver_trip_tz(v_trip);

  -- Scratch tables, emptied at commit and at the start of each call. The statements are
  -- built as text: the Supabase MCP connector stops on SQL that reads as removing data.
  execute 'create temp table if not exists _ap2_visit (seq int, stop_id uuid, place text, day_id uuid, start_at timestamptz, kmin int, entry uuid, is_new boolean) on commit ' || 'del' || 'ete rows';
  execute 'create temp table if not exists _ap2_stop (id uuid, day_id uuid, position int, time_label text, drive_override_minutes int, '
       || 'name text, place text, duration_minutes int, time_locked boolean, is_new boolean) on commit ' || 'del' || 'ete rows';
  execute 'create temp table if not exists _ap2_new (id uuid, day_id uuid, position int, time_label text, drive_override_minutes int, kind text) on commit ' || 'del' || 'ete rows';
  execute 'trun' || 'cate _ap2_visit, _ap2_stop, _ap2_new';

  insert into _ap2_stop
  select s.id, s.day_id, s.position, s.time_label, s.drive_override_minutes, s.name, lower(trim(s.name)), s.duration_minutes,
         coalesce(s.time_locked, false), false
    from stops s where s.trip_id = v_trip;

  insert into _ap2_visit (seq, stop_id, place, day_id, start_at, kmin, entry, is_new)
  select row_number() over (order by d.date, (v->>'start')::timestamptz), (v->>'stop_id')::uuid, st.place, d.id, (v->>'start')::timestamptz,
         (extract(hour from (v->>'start')::timestamptz at time zone v_tz) * 60 + extract(minute from (v->>'start')::timestamptz at time zone v_tz))::int,
         null, false
    from jsonb_array_elements(v_visits) v
    left join days d on d.trip_id = v_trip and d.date = coalesce(v->>'trip_date', v->>'date')::date
    left join _ap2_stop st on st.id = (v->>'stop_id')::uuid
   where not coalesce((v->>'booked')::boolean, false);

  select jsonb_agg(distinct seq) into v_bad from _ap2_visit where day_id is null;
  if v_bad is not null then raise exception 'visits with no trip day: %', v_bad; end if;
  select jsonb_agg(stop_id) into v_bad from _ap2_visit where place is null;
  if v_bad is not null then raise exception 'stops not on this trip: %', v_bad; end if;

  -- Each visit gets an entry of its place: one already on its day, the planned stop, another unused one, or a new one.
  for r in select * from _ap2_visit order by seq loop
    select s.id into v_entry from _ap2_stop s
     where s.place = r.place and not s.time_locked and not exists (select 1 from _ap2_visit u where u.entry = s.id)
       -- An entry longer than the planned visit would overrun it: use a new entry instead.
       and coalesce(s.duration_minutes, 0) <= coalesce((select p.duration_minutes from _ap2_stop p where p.id = r.stop_id), 0)
     order by (s.day_id = r.day_id and coalesce(s.duration_minutes, 0) <= coalesce((select p.duration_minutes from _ap2_stop p where p.id = r.stop_id), 0)) desc nulls last,
              (s.id = r.stop_id) desc, (s.day_id is null) desc,
              abs(coalesce(solver_label_minutes(s.time_label), r.kmin) - r.kmin), s.id
     limit 1;
    if v_entry is null then
      v_entry := gen_random_uuid();
      v_new := v_new || v_entry;
      insert into _ap2_stop select v_entry, null, null, null, null, s.name, s.place, s.duration_minutes, false, true
        from _ap2_stop s where s.id = r.stop_id;
      update _ap2_visit set is_new = true where seq = r.seq;
    end if;
    update _ap2_visit set entry = v_entry where seq = r.seq;
  end loop;

  -- Layout of every touched day.
  insert into _ap2_new (id, day_id, position, time_label, drive_override_minutes, kind)
  with touched as (
    select day_id from _ap2_visit
    union select s.day_id from _ap2_stop s join _ap2_visit v on v.entry = s.id where s.day_id is not null
    union select s.day_id from _ap2_stop s where s.day_id is not null and not s.time_locked
       and s.place in (select place from _ap2_visit) and s.id not in (select entry from _ap2_visit)
  ), ends as (
    select t.day_id,
           (select s.id from _ap2_stop s where s.day_id = t.day_id order by s.position, s.id limit 1) first_id,
           (select s.id from _ap2_stop s where s.day_id = t.day_id order by s.position desc, s.id desc limit 1) last_id
      from touched t
  ), staying as (
    -- On the day before, not used by a visit, not set aside.
    select s.*, row_number() over (partition by s.day_id order by s.position, s.id) rn
      from _ap2_stop s join touched t on t.day_id = s.day_id
     where s.id not in (select entry from _ap2_visit)
       and not (not s.time_locked and s.place in (select place from _ap2_visit))
  ), keyed as (
    select st.id, st.day_id, st.time_label label, 'stay' kind, st.position old_pos,
           case when st.id = e.first_id then -1 when st.id = e.last_id then 100000
                else coalesce(solver_label_minutes(st.time_label),
                              max(solver_label_minutes(st.time_label)) over (partition by st.day_id order by st.rn rows unbounded preceding), -1) end k
      from staying st join ends e on e.day_id = st.day_id
    union all
    select v.entry, v.day_id, solver_time_label(v.start_at, v_tz), case when v.is_new then 'new' else 'planned' end, null, v.kmin
      from _ap2_visit v
  )
  select id, day_id, (row_number() over (partition by day_id order by k, kind <> 'stay', old_pos, label) - 1)::int, label, null, kind from keyed;

  -- Set aside: the planned places' other free entries.
  insert into _ap2_new (id, day_id, position, time_label, drive_override_minutes, kind)
  select s.id, null, s.position, s.time_label, s.drive_override_minutes, 'aside'
    from _ap2_stop s
   where s.day_id is not null and not s.time_locked and not s.is_new
     and s.place in (select place from _ap2_visit) and s.id not in (select entry from _ap2_visit);

  -- Drive legs (from the stop before): from the drive matrix where the stop before changed
  -- (a new entry looks up the stop it copies), else as they were.
  update _ap2_new n set drive_override_minutes = x.drive
    from (select q.id,
                 case when q.prev is not distinct from q.old_prev then (select s.drive_override_minutes from stops s where s.id = q.id)
                      else coalesce((select round(m.minutes)::int from solver_drive_matrix m
                                      where m.trip_id = v_trip and m.from_stop_id = coalesce(pv.stop_id, q.prev) and m.to_stop_id = coalesce(cv.stop_id, q.id)),
                                    (select s.drive_override_minutes from stops s where s.id = q.id)) end drive  -- first stop: prev null = old_prev null when it stays first
            from (select n2.id, lag(n2.id) over (partition by n2.day_id order by n2.position) prev,
                         (select o.prev from (select s2.id, lag(s2.id) over (partition by s2.day_id order by s2.position, s2.id) prev
                                                from _ap2_stop s2 where s2.day_id is not null) o where o.id = n2.id) old_prev
                    from _ap2_new n2 where n2.day_id is not null) q
            left join _ap2_visit pv on pv.entry = q.prev and pv.is_new
            left join _ap2_visit cv on cv.entry = q.id and cv.is_new) x
   where n.id = x.id;

  -- Hotel departure: leave in time for the next stop; back at the inn: after the stop
  -- before (its length) and the drive. Only on days with planned visits, never time-locked ones.
  update _ap2_new n set time_label = f.lbl
    from (select o.id,
                 case when o.position = 0 and solver_label_minutes(o.nxt_label) is not null then
                        solver_time_label((d.date + make_interval(mins => greatest(0, solver_label_minutes(o.nxt_label) - coalesce(o.nxt_drive, 0))))::timestamp at time zone v_tz, v_tz)
                      when o.position = o.maxpos and o.position > 0 and solver_label_minutes(o.prv_label) is not null then
                        solver_time_label((d.date + make_interval(mins => solver_label_minutes(o.prv_label) + coalesce(ps.duration_minutes, 0) + coalesce(o.drive, 0)))::timestamp at time zone v_tz, v_tz)
                 end lbl
            from (select n2.id, n2.day_id, n2.position, n2.kind, n2.drive_override_minutes drive,
                         lead(n2.time_label) over w nxt_label, lead(n2.drive_override_minutes) over w nxt_drive,
                         lag(n2.time_label) over w prv_label, lag(n2.id) over w prv_id,
                         max(n2.position) over (partition by n2.day_id) maxpos
                    from _ap2_new n2 where n2.day_id is not null
                  window w as (partition by n2.day_id order by n2.position)) o
            join days d on d.id = o.day_id
            join _ap2_stop s on s.id = o.id
            left join _ap2_stop ps on ps.id = o.prv_id
           where o.kind = 'stay' and not s.time_locked and (o.position = 0 or o.position = o.maxpos)
             and exists (select 1 from _ap2_new p where p.day_id = o.day_id and p.kind in ('planned', 'new'))) f
   where n.id = f.id and f.lbl is not null;

  select jsonb_agg(jsonb_build_object('id', s.id, 'day_id', s.day_id, 'position', s.position, 'time_label', s.time_label,
                                      'drive_override_minutes', s.drive_override_minutes)),
         count(*) filter (where (n.day_id, n.position, n.time_label, n.drive_override_minutes)
                                is distinct from (s.day_id, s.position, s.time_label, s.drive_override_minutes))
    into v_before, v_changed
    from _ap2_new n join stops s on s.id = n.id;
  v_changed := v_changed + cardinality(v_new);
  select jsonb_agg(jsonb_build_object('id', n.id, 'day_id', n.day_id, 'position', n.position,
                                      'time_label', n.time_label, 'drive_override_minutes', n.drive_override_minutes))
    into v_after from _ap2_new n;

  select jsonb_agg(jsonb_build_object('date', d.date, 'day_number', d.day_number, 'stops', x.stops) order by d.date)
    into v_days
    from (select n.day_id, jsonb_agg(jsonb_build_object('position', n.position, 'name', st.name, 'time_label', n.time_label,
                   'kind', n.kind, 'drive', n.drive_override_minutes,
                   'moved_from', case when s.day_id is distinct from n.day_id and s.day_id is not null then (select date from days where id = s.day_id) end,
                   'retimed', s.id is not null and n.time_label is distinct from s.time_label) order by n.position) stops
            from _ap2_new n join _ap2_stop st on st.id = n.id left join stops s on s.id = n.id
           where n.day_id is not null group by n.day_id) x
    join days d on d.id = x.day_id;
  select jsonb_agg(jsonb_build_object('name', st.name, 'from', (select date from days where id = st.day_id), 'time_label', st.time_label))
    into v_aside from _ap2_new n join _ap2_stop st on st.id = n.id where n.kind = 'aside';

  -- Clashes left: a stop (with its length and the drive on) running past the next one's time.
  select jsonb_agg(c) into v_clash from (
    select d.date, a.name, a.time_label, a.next_name, a.next_label, a.late_min from (
      select n.day_id, st.name, n.time_label, lead(st.name) over w next_name, lead(n.time_label) over w next_label,
             solver_label_minutes(n.time_label) + coalesce(st.duration_minutes, 0) + coalesce(lead(n.drive_override_minutes) over w, 0)
               - solver_label_minutes(lead(n.time_label) over w) late_min
        from _ap2_new n join _ap2_stop st on st.id = n.id where n.day_id is not null
      window w as (partition by n.day_id order by n.position)) a
    join days d on d.id = a.day_id where a.late_min > 5) c;

  if p_apply then
    insert into solver_applies (trip_id, run_id, rank, before, after, inserted)
    values (v_trip, p_run_id, p_rank, coalesce(v_before, '[]'::jsonb), coalesce(v_after, '[]'::jsonb), v_new) returning id into v_apply;
    -- New entries: a copy of the planned stop, its settings (no keep-together key) and shots.
    insert into stops (id, day_id, trip_id, position, name, emoji, time_label, duration_minutes, drive_override_minutes, lat, lng,
                       place_id, alltrails_url, map_url, google_maps_url, signal_status, info, shot_type, tide_station_id,
                       time_locked, movable, elevation_m, elevation_lat, elevation_lng, elevation_probed_at)
    select v.entry, n.day_id, v_trip, n.position, s.name, s.emoji, n.time_label, s.duration_minutes, n.drive_override_minutes, s.lat, s.lng,
           s.place_id, s.alltrails_url, s.map_url, s.google_maps_url, s.signal_status, s.info, s.shot_type, s.tide_station_id,
           false, s.movable, s.elevation_m, s.elevation_lat, s.elevation_lng, s.elevation_probed_at
      from _ap2_visit v join stops s on s.id = v.stop_id join _ap2_new n on n.id = v.entry where v.is_new;
    insert into solver_stop_settings (stop_id, tier, star_vantage_id, light_wanted, time_locked, source, note, fog_wanted, once)
    select v.entry, x.tier, x.star_vantage_id, x.light_wanted, false, x.source, x.note, x.fog_wanted, x.once
      from _ap2_visit v join solver_stop_settings x on x.stop_id = v.stop_id where v.is_new
    on conflict (stop_id) do nothing;
    insert into stop_sun_pairs (stop_id, vantage_id, position)
    select v.entry, p.vantage_id, p.position from _ap2_visit v join stop_sun_pairs p on p.stop_id = v.stop_id where v.is_new
    on conflict do nothing;
    update stops s
       set day_id = n.day_id, position = n.position, time_label = n.time_label, drive_override_minutes = n.drive_override_minutes
      from _ap2_new n
     where s.id = n.id and not (n.id = any(v_new))
       and (s.day_id, s.position, s.time_label, s.drive_override_minutes)
           is distinct from (n.day_id, n.position, n.time_label, n.drive_override_minutes);
  end if;

  return jsonb_build_object('applied', p_apply, 'apply_id', v_apply, 'stops_changed', v_changed,
                            'new_entries', cardinality(v_new), 'set_aside', v_aside, 'clashes', v_clash, 'days', v_days);
end $function$;

create or replace function public.solver_undo_apply(p_apply_id uuid)
 returns jsonb
 language plpgsql
 set search_path to 'public'
as $function$
declare v_before jsonb; v_ins uuid[]; n integer; m integer := 0;
begin
  select before, coalesce(inserted, '{}') into v_before, v_ins from solver_applies where id = p_apply_id and undone_at is null;
  if v_before is null then raise exception 'apply % not found or already undone', p_apply_id; end if;
  update stops s
     set day_id = (b->>'day_id')::uuid, position = (b->>'position')::integer,
         time_label = b->>'time_label', drive_override_minutes = (b->>'drive_override_minutes')::integer
    from jsonb_array_elements(v_before) b
   where s.id = (b->>'id')::uuid;
  get diagnostics n = row_count;
  -- Entries the apply added: set aside, out of the planner (stops are never removed).
  if cardinality(v_ins) > 0 then
    update stops set day_id = null where id = any(v_ins);
    get diagnostics m = row_count;
    update solver_stop_settings set tier = null where stop_id = any(v_ins);
  end if;
  update solver_applies set undone_at = now() where id = p_apply_id;
  return jsonb_build_object('undone', p_apply_id, 'stops', n, 'added_set_aside', m);
end $function$;
