-- Missing photos on repeat visits (Phil, 13 Nov 2026: "Snake River Overlook on the test app is missing photos").
-- Repeat visits to one place share photos through stops.photo_group. Practice copies never got the group,
-- Accept's new entries never got one, and two repeats on the real Teton trip were never grouped.

update stops set photo_group = 'glacier-view'
 where trip_id = '5e247891-d800-4d07-b5e0-8ad748ae2754' and name = 'Glacier View Turnout' and photo_group is null;
update stops set photo_group = 'teton-point'
 where trip_id = '5e247891-d800-4d07-b5e0-8ad748ae2754' and name = 'Teton Point Turnout' and photo_group is null;

-- Practice copies take their main twin's group.
update stops t set photo_group = m.photo_group
  from training_copy_map c join stops m on m.id = c.old_id
 where c.kind = 'stop' and c.new_id = t.id and m.photo_group is not null and t.photo_group is distinct from m.photo_group;

-- Entries made by Accept: the group of the same place on that trip, else a new one shared with it.
with ins as (
  select distinct unnest(a.inserted) id from solver_applies a where a.undone_at is null
), pair as (
  select i.id ins_id, o.id other_id, o.photo_group og
    from ins i join stops s on s.id = i.id
    join stops o on o.trip_id = s.trip_id and o.name = s.name and o.id <> s.id and o.id not in (select id from ins)
), pick as (
  select ins_id, coalesce(max(og), 'same-' || left(min(other_id::text), 8)) grp from pair group by ins_id
)
update stops s set photo_group = p.grp from pick p where s.id = p.ins_id and s.photo_group is null;
with ins as (
  select distinct unnest(a.inserted) id from solver_applies a where a.undone_at is null
)
update stops o set photo_group = s.photo_group
  from ins i join stops s on s.id = i.id
 where o.trip_id = s.trip_id and o.name = s.name and o.id <> s.id and o.photo_group is null
   and s.photo_group like 'same-%';

CREATE OR REPLACE FUNCTION public.training_sync(p_trip uuid, p_dry boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_main uuid; v_seeded int := 0; v_new int := 0; v_moved int := 0; v_stops int := 0; v_shots int := 0; v_settings int := 0;
  v_mid uuid[]; v_tid uuid[]; r record; v_day uuid; v_id uuid;
begin
  select training_of into v_main from trips where id = p_trip;
  if v_main is null then raise exception 'training_sync: % is not a training trip', p_trip; end if;

  if not exists (select 1 from training_copy_map where trip_id = p_trip and kind = 'stop') and not p_dry then
    insert into training_copy_map (trip_id, kind, old_id, new_id)
    select p_trip, 'stop', m.id, t.id
      from (select s.id, s.name, d.day_number dn, s.position from stops s join days d on d.id = s.day_id where s.trip_id = v_main) m
      join (select s.id, s.name, d.day_number dn, s.position from stops s join days d on d.id = s.day_id where s.trip_id = p_trip) t
        on t.name = m.name and t.dn = m.dn and t.position = m.position;
    get diagnostics v_seeded = row_count;
    insert into training_copy_map (trip_id, kind, old_id, new_id)
    select p_trip, 'stop', m.id, t.id
      from (select name, min(id::text)::uuid id from stops where trip_id = v_main and day_id is null group by name having count(*) = 1) m
      join (select name, min(id::text)::uuid id from stops where trip_id = p_trip and day_id is null group by name having count(*) = 1) t
        on t.name = m.name;
    select count(*) into v_seeded from training_copy_map where trip_id = p_trip and kind = 'stop';
  end if;

  for r in select m.* from stops m
            where m.trip_id = v_main and m.day_id is not null
              and not exists (select 1 from training_copy_map c where c.trip_id = p_trip and c.kind = 'stop' and c.old_id = m.id)
              and exists (select 1 from training_copy_map c where c.trip_id = p_trip and c.kind = 'stop') loop
    v_day := training_copy_day(p_trip, r.day_id);
    continue when v_day is null;
    v_new := v_new + 1;
    continue when p_dry;
    insert into stops (trip_id, day_id, position, name, emoji, time_label, duration_minutes, drive_override_minutes, lat, lng,
                       place_id, alltrails_url, map_url, signal_status, info, google_maps_url, shot_type, tide_station_id,
                       time_locked, movable, elevation_m, elevation_lat, elevation_lng, elevation_probed_at)
    values (p_trip, v_day, r.position, r.name, r.emoji, r.time_label, r.duration_minutes, r.drive_override_minutes, r.lat, r.lng,
            r.place_id, r.alltrails_url, r.map_url, r.signal_status, r.info, r.google_maps_url, r.shot_type, r.tide_station_id,
            r.time_locked, r.movable, r.elevation_m, r.elevation_lat, r.elevation_lng, r.elevation_probed_at)
    returning id into v_id;
    insert into training_copy_map (trip_id, kind, old_id, new_id) values (p_trip, 'stop', r.id, v_id);
  end loop;

  select array_agg(c.old_id), array_agg(c.new_id) into v_mid, v_tid
    from training_copy_map c
   where c.trip_id = p_trip and c.kind = 'stop'
     and c.old_id in (select id from stops where trip_id = v_main) and c.new_id in (select id from stops where trip_id = p_trip);
  if v_mid is null and p_dry then
    select array_agg(m.id), array_agg(t.id) into v_mid, v_tid
      from (select s.id, s.name, d.day_number dn, s.position from stops s join days d on d.id = s.day_id where s.trip_id = v_main) m
      join (select s.id, s.name, d.day_number dn, s.position from stops s join days d on d.id = s.day_id where s.trip_id = p_trip) t
        on t.name = m.name and t.dn = m.dn and t.position = m.position;
  end if;

  if p_dry then
    select count(*) into v_moved from unnest(v_mid, v_tid) x(mid, tid) join stops m on m.id = x.mid join stops t on t.id = x.tid
     where (t.name, t.position) is distinct from (m.name, m.position)
        or t.day_id is distinct from case when m.day_id is null then null else coalesce(training_copy_day(p_trip, m.day_id), t.day_id) end;
    select count(*) into v_stops from unnest(v_mid, v_tid) x(mid, tid) join stops m on m.id = x.mid join stops t on t.id = x.tid
     where (t.time_label, t.duration_minutes, t.lat, t.lng, t.drive_override_minutes, t.info, t.alltrails_url, t.shot_type, t.time_locked)
           is distinct from (m.time_label, m.duration_minutes, m.lat, m.lng, m.drive_override_minutes, m.info, m.alltrails_url, m.shot_type, m.time_locked);
    select count(*) into v_shots from unnest(v_mid, v_tid) x(mid, tid) join stop_sun_pairs p on p.stop_id = x.mid
     where not exists (select 1 from stop_sun_pairs q where q.stop_id = x.tid
                         and (q.vantage_id = p.vantage_id or vantage_place(q.vantage_id) = vantage_place(p.vantage_id)));
    select count(*) into v_settings from unnest(v_mid, v_tid) x(mid, tid) join stops m on m.id = x.mid
      join solver_stop_settings ms on ms.stop_id = x.mid left join solver_stop_inputs mi on mi.stop_id = x.mid
      left join solver_stop_settings ts on ts.stop_id = x.tid left join solver_stop_inputs ti on ti.stop_id = x.tid
     where ts.stop_id is null
        or (ts.tier, ts.light_wanted, ts.fog_wanted, ts.source, ts.together, ts.once, ts.needs_peaks)
           is distinct from (case when m.day_id is null then null else ms.tier end, ms.light_wanted, ms.fog_wanted, ms.source, ms.together, ms.once, ms.needs_peaks)
        or vantage_place(ti.star_vantage_id) is distinct from vantage_place(mi.star_vantage_id);
    return jsonb_build_object('trip', p_trip, 'dry_run', true, 'linked', coalesce(cardinality(v_mid), 0), 'new', v_new,
                              'moved', v_moved, 'stops', v_stops, 'shots', v_shots, 'settings', v_settings);
  end if;

  update stops t set name = m.name, position = m.position,
         day_id = case when m.day_id is null then null else coalesce(training_copy_day(p_trip, m.day_id), t.day_id) end,
         updated_at = now()
    from unnest(v_mid, v_tid) x(mid, tid) join stops m on m.id = x.mid
   where t.id = x.tid
     and ((t.name, t.position) is distinct from (m.name, m.position)
          or t.day_id is distinct from case when m.day_id is null then null else coalesce(training_copy_day(p_trip, m.day_id), t.day_id) end);
  get diagnostics v_moved = row_count;

  update stops t set time_label = m.time_label, duration_minutes = m.duration_minutes, lat = m.lat, lng = m.lng,
         drive_override_minutes = m.drive_override_minutes, info = m.info, alltrails_url = m.alltrails_url,
         shot_type = m.shot_type, time_locked = m.time_locked, updated_at = now()
    from unnest(v_mid, v_tid) x(mid, tid) join stops m on m.id = x.mid
   where t.id = x.tid
     and (t.time_label, t.duration_minutes, t.lat, t.lng, t.drive_override_minutes, t.info, t.alltrails_url, t.shot_type, t.time_locked)
         is distinct from (m.time_label, m.duration_minutes, m.lat, m.lng, m.drive_override_minutes, m.info, m.alltrails_url, m.shot_type, m.time_locked);
  get diagnostics v_stops = row_count;

  -- Repeat visits share photos through stops.photo_group: copy the main stop's group (a copy's own group,
  -- e.g. from an Accept, stays when the main stop has none). 13 Nov 2026.
  update stops t set photo_group = m.photo_group
    from unnest(v_mid, v_tid) x(mid, tid) join stops m on m.id = x.mid
   where t.id = x.tid and m.photo_group is not null and t.photo_group is distinct from m.photo_group;

  insert into stop_sun_pairs (stop_id, vantage_id, position)
  select x.tid, p.vantage_id, 100 + p.position from unnest(v_mid, v_tid) x(mid, tid) join stop_sun_pairs p on p.stop_id = x.mid
   where not exists (select 1 from stop_sun_pairs q where q.stop_id = x.tid and vantage_place(q.vantage_id) = vantage_place(p.vantage_id))
  on conflict do nothing;
  get diagnostics v_shots = row_count;

  insert into solver_stop_settings (stop_id, tier, light_wanted, fog_wanted, star_vantage_id, source, time_locked, together, once, needs_peaks)
  select x.tid, case when m.day_id is null then null else ms.tier end, ms.light_wanted, ms.fog_wanted,
         case when vantage_place(ti.star_vantage_id) = vantage_place(mi.star_vantage_id) then ti.star_vantage_id
              else coalesce((select q.vantage_id from stop_sun_pairs q
                              where q.stop_id = x.tid and vantage_place(q.vantage_id) = vantage_place(mi.star_vantage_id)
                              order by (q.vantage_id = mi.star_vantage_id) desc, q.position limit 1),
                            mi.star_vantage_id) end,
         ms.source, coalesce(ms.time_locked, false), ms.together, ms.once, ms.needs_peaks
    from unnest(v_mid, v_tid) x(mid, tid) join stops m on m.id = x.mid
    join solver_stop_settings ms on ms.stop_id = x.mid left join solver_stop_inputs mi on mi.stop_id = x.mid
    left join solver_stop_inputs ti on ti.stop_id = x.tid
  on conflict (stop_id) do update set tier = excluded.tier, light_wanted = excluded.light_wanted, fog_wanted = excluded.fog_wanted,
    star_vantage_id = excluded.star_vantage_id, source = excluded.source, together = excluded.together, once = excluded.once,
    needs_peaks = excluded.needs_peaks
   where (solver_stop_settings.tier, solver_stop_settings.light_wanted, solver_stop_settings.fog_wanted,
          solver_stop_settings.star_vantage_id, solver_stop_settings.source, solver_stop_settings.together, solver_stop_settings.once,
          solver_stop_settings.needs_peaks)
         is distinct from (excluded.tier, excluded.light_wanted, excluded.fog_wanted, excluded.star_vantage_id, excluded.source, excluded.together, excluded.once, excluded.needs_peaks);
  get diagnostics v_settings = row_count;

  insert into app_logs (level, message, data)
  values ('info', 'training_sync', jsonb_build_object('trip', p_trip, 'main', v_main, 'seeded', v_seeded,
          'linked', coalesce(cardinality(v_mid), 0), 'new', v_new, 'moved', v_moved, 'stops', v_stops, 'shots', v_shots, 'settings', v_settings));
  return jsonb_build_object('trip', p_trip, 'seeded', v_seeded, 'linked', coalesce(cardinality(v_mid), 0), 'new', v_new,
                            'moved', v_moved, 'stops', v_stops, 'shots', v_shots, 'settings', v_settings);
end $function$;

CREATE OR REPLACE FUNCTION public.solver_apply_plan(p_run_id uuid, p_rank integer DEFAULT 1, p_apply boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_trip uuid; v_visits jsonb; v_tz text; v_bad jsonb;
  v_before jsonb; v_after jsonb; v_days jsonb; v_apply uuid; v_changed int;
  r record; v_entry uuid; v_frozen timestamptz; v_aside_unplanned boolean := coalesce(current_setting('solver.aside_unplanned', true), '') = 'on'; v_new uuid[] := '{}'; v_clash jsonb; v_aside jsonb;
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

  -- solver_apply_week: days before now, and today's stops whose time has passed, are frozen
  -- (treated as time-locked: never moved, used for a visit or set aside).
  v_frozen := nullif(current_setting('solver.frozen_after', true), '')::timestamptz;
  insert into _ap2_stop
  select s.id, s.day_id, s.position, s.time_label, s.drive_override_minutes, s.name, lower(trim(s.name)), s.duration_minutes,
         coalesce(s.time_locked, false)
           or (v_frozen is not null and dd.date is not null
               and ((dd.date + make_interval(mins => coalesce(solver_label_minutes(s.time_label), 0)))::timestamp at time zone v_tz) < v_frozen),
         false
    from stops s left join days dd on dd.id = s.day_id where s.trip_id = v_trip;

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
       and not (v_aside_unplanned and not s.time_locked and not s.is_new and s.day_id in (select day_id from _ap2_visit)
            and s.id not in (select entry from _ap2_visit)
            and exists (select 1 from solver_stop_settings x where x.stop_id = s.id and x.tier is not null and x.tier <> 'F'))
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
   where (s.day_id is not null and not s.time_locked and not s.is_new
     and s.place in (select place from _ap2_visit) and s.id not in (select entry from _ap2_visit))
      or (v_aside_unplanned and not s.time_locked and not s.is_new and s.day_id in (select day_id from _ap2_visit)
            and s.id not in (select entry from _ap2_visit)
            and exists (select 1 from solver_stop_settings x where x.stop_id = s.id and x.tier is not null and x.tier <> 'F'));

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
    -- Same place, one photo pool (stops.photo_group): a new entry shows its place's photos (13 Nov 2026).
    update stops s set photo_group = coalesce(src.photo_group, 'same-' || left(src.id::text, 8))
      from _ap2_visit v join stops src on src.id = v.stop_id
     where v.is_new and s.id in (v.entry, v.stop_id) and s.photo_group is null;
    -- Shots first: the settings row names the starred shot, and solver_stop_settings_check refuses a star
    -- that is not yet among the stop's shots (12 Nov 2026: Accept failed on a place planned twice).
    insert into stop_sun_pairs (stop_id, vantage_id, position)
    select v.entry, p.vantage_id, p.position from _ap2_visit v join stop_sun_pairs p on p.stop_id = v.stop_id where v.is_new
    on conflict do nothing;
    insert into solver_stop_settings (stop_id, tier, star_vantage_id, light_wanted, time_locked, source, note, fog_wanted, once)
    select v.entry, x.tier, x.star_vantage_id, x.light_wanted, false, x.source, x.note, x.fog_wanted, x.once
      from _ap2_visit v join solver_stop_settings x on x.stop_id = v.stop_id where v.is_new
    on conflict (stop_id) do nothing;
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
