-- training_sync: a stop gone from the real trip sets its practice twin (and the copy's Accept entries of that place) aside,
-- so T stops planning it (Phil, 18 Nov 2026: the real trip is the ground truth; "make sure there's a case now for when
-- a stop is deleted etc. I don't want it to affect T"). Tested in a rolled-back transaction on Teton Live (a twin whose
-- real stop is gone: day null, tier null, set_aside 1). Live definition of 18 Nov 2026 plus the new block.
CREATE OR REPLACE FUNCTION public.training_sync(p_trip uuid, p_dry boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_main uuid; v_seeded int := 0; v_new int := 0; v_moved int := 0; v_stops int := 0; v_shots int := 0; v_settings int := 0;
  v_mid uuid[]; v_tid uuid[]; v_xmid uuid[]; v_xtid uuid[]; v_gone int := 0; r record; v_day uuid; v_id uuid;
  v_off int; v_aside int := 0;
begin
  select training_of into v_main from trips where id = p_trip;
  if v_main is null then raise exception 'training_sync: % is not a training trip', p_trip; end if;
  -- Place day windows (16 Nov 2026) move with the copy's dates: the copy's day N is the main trip's day N.
  select coalesce((select t.date - m.date from days t join days m on m.trip_id = v_main and m.day_number = t.day_number
                    where t.trip_id = p_trip and t.date is not null and m.date is not null order by t.day_number limit 1),
                  (select c.start_date - mt.start_date from trips c, trips mt where c.id = p_trip and mt.id = v_main), 0)
    into v_off;

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
     where not exists (select 1 from stop_sun_pairs q where q.stop_id = x.tid and q.vantage_id = p.vantage_id);
    select count(*) into v_gone from unnest(v_mid, v_tid) x(mid, tid) join stop_sun_pairs q on q.stop_id = x.tid
     where not exists (select 1 from stop_sun_pairs p where p.stop_id = x.mid and p.vantage_id = q.vantage_id);
    select count(*) into v_settings from unnest(v_mid, v_tid) x(mid, tid) join stops m on m.id = x.mid
      join solver_stop_settings ms on ms.stop_id = x.mid left join solver_stop_inputs mi on mi.stop_id = x.mid
      left join solver_stop_settings ts on ts.stop_id = x.tid left join solver_stop_inputs ti on ti.stop_id = x.tid
     where ts.stop_id is null
        or (ts.tier, ts.light_wanted, ts.fog_wanted, ts.source, ts.together, ts.once, ts.needs_peaks, ts.window_from, ts.window_to)
           is distinct from (case when m.day_id is null then null else ms.tier end, ms.light_wanted, ms.fog_wanted, ms.source, ms.together, ms.once, ms.needs_peaks,
                             ms.window_from + v_off, ms.window_to + v_off)
        or vantage_place(ti.star_vantage_id) is distinct from vantage_place(mi.star_vantage_id);
    return jsonb_build_object('trip', p_trip, 'dry_run', true, 'linked', coalesce(cardinality(v_mid), 0), 'new', v_new,
                              'moved', v_moved, 'stops', v_stops, 'shots', v_shots, 'shots_removed', v_gone, 'settings', v_settings, 'set_aside', v_aside);
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

  -- Shots (13 Nov 2026, Phil: "multiple and repeated shots"): a copy stop uses exactly its main twin's shots, the same
  -- rows, so pins, photos and moves stay in step. Before, the copy kept its own copies of the first guessed shots
  -- and gained copies of each newer one, so one place showed 3-4 shot chips.
  -- Entries made by Accept on the copy (not linked) follow the linked copy stop of the same place (name).
  select array_agg(m.mid), array_agg(e.id) into v_xmid, v_xtid
    from stops e
    join lateral (select x.mid from unnest(v_mid, v_tid) x(mid, tid) join stops l on l.id = x.tid
                   where l.name = e.name order by (l.day_id is null), l.id limit 1) m on true
   where e.trip_id = p_trip and not (e.id = any(coalesce(v_tid, '{}')))
     and exists (select 1 from solver_applies a where a.trip_id = p_trip and a.undone_at is null and e.id = any(a.inserted));
  v_xmid := coalesce(v_mid, '{}') || coalesce(v_xmid, '{}');
  v_xtid := coalesce(v_tid, '{}') || coalesce(v_xtid, '{}');
  insert into stop_sun_pairs (stop_id, vantage_id, position)
  select x.tid, p.vantage_id, p.position from unnest(v_xmid, v_xtid) x(mid, tid) join stop_sun_pairs p on p.stop_id = x.mid
  on conflict do nothing;
  get diagnostics v_shots = row_count;

  insert into solver_stop_settings (stop_id, tier, light_wanted, fog_wanted, star_vantage_id, source, time_locked, together, once, needs_peaks,
                                    window_from, window_to)
  select x.tid, case when m.day_id is null then null else ms.tier end, ms.light_wanted, ms.fog_wanted,
         case when exists (select 1 from stop_sun_pairs q where q.stop_id = x.tid and q.vantage_id = mi.star_vantage_id)
              then mi.star_vantage_id end,
         ms.source, coalesce(ms.time_locked, false), ms.together, ms.once, ms.needs_peaks,
         ms.window_from + v_off, ms.window_to + v_off
    from unnest(v_mid, v_tid) x(mid, tid) join stops m on m.id = x.mid
    join solver_stop_settings ms on ms.stop_id = x.mid left join solver_stop_inputs mi on mi.stop_id = x.mid
  on conflict (stop_id) do update set tier = excluded.tier, light_wanted = excluded.light_wanted, fog_wanted = excluded.fog_wanted,
    star_vantage_id = excluded.star_vantage_id, source = excluded.source, together = excluded.together, once = excluded.once,
    needs_peaks = excluded.needs_peaks, window_from = excluded.window_from, window_to = excluded.window_to
   where (solver_stop_settings.tier, solver_stop_settings.light_wanted, solver_stop_settings.fog_wanted,
          solver_stop_settings.star_vantage_id, solver_stop_settings.source, solver_stop_settings.together, solver_stop_settings.once,
          solver_stop_settings.needs_peaks, solver_stop_settings.window_from, solver_stop_settings.window_to)
         is distinct from (excluded.tier, excluded.light_wanted, excluded.fog_wanted, excluded.star_vantage_id, excluded.source, excluded.together, excluded.once, excluded.needs_peaks,
                           excluded.window_from, excluded.window_to);
  get diagnostics v_settings = row_count;

  -- Accept entries take the same starred shot, then every copy shot that is not the main twin's goes (star first,
  -- so no stop is left pointing at a removed shot).
  update solver_stop_settings ts set star_vantage_id = mi.star_vantage_id
    from unnest(v_xmid, v_xtid) x(mid, tid) join solver_stop_inputs mi on mi.stop_id = x.mid
   where ts.stop_id = x.tid and not (x.tid = any(coalesce(v_tid, '{}')))
     and ts.star_vantage_id is distinct from mi.star_vantage_id
     and exists (select 1 from stop_sun_pairs q where q.stop_id = x.tid and q.vantage_id = mi.star_vantage_id);
  delete from stop_sun_pairs q using unnest(v_xmid, v_xtid) x(mid, tid)
   where q.stop_id = x.tid and exists (select 1 from stop_sun_pairs p where p.stop_id = x.mid)
     and not exists (select 1 from stop_sun_pairs p where p.stop_id = x.mid and p.vantage_id = q.vantage_id)
     and not exists (select 1 from solver_stop_settings ts where ts.stop_id = x.tid and ts.star_vantage_id = q.vantage_id);
  get diagnostics v_gone = row_count;

  -- A stop gone from the real trip (Phil, 18 Nov 2026: the real trip is the ground truth; "make sure there's a case now
  -- for when a stop is deleted"): its practice twin, and the copy's Accept entries of that place, are set aside (no
  -- day, no tier), so T stops planning them; nothing on the copy is deleted.
  update stops t set day_id = null, updated_at = now()
   where t.trip_id = p_trip and t.day_id is not null
     and (t.id in (select c.new_id from training_copy_map c where c.trip_id = p_trip and c.kind = 'stop'
                    and not exists (select 1 from stops m where m.id = c.old_id and m.trip_id = v_main))
          or (not (t.id = any(coalesce(v_tid, '{}')))
              and exists (select 1 from solver_applies a where a.trip_id = p_trip and a.undone_at is null and t.id = any(a.inserted))
              and not exists (select 1 from unnest(v_mid, v_tid) x(mid, tid) join stops l on l.id = x.tid join stops m on m.id = x.mid
                               where l.name = t.name and m.day_id is not null)));
  get diagnostics v_aside = row_count;
  update solver_stop_settings ss set tier = null
    from stops t where t.id = ss.stop_id and t.trip_id = p_trip and t.day_id is null and ss.tier is not null;

  insert into app_logs (level, message, data)
  values ('info', 'training_sync', jsonb_build_object('trip', p_trip, 'main', v_main, 'seeded', v_seeded,
          'linked', coalesce(cardinality(v_mid), 0), 'new', v_new, 'moved', v_moved, 'stops', v_stops, 'shots', v_shots, 'shots_removed', v_gone, 'settings', v_settings, 'set_aside', v_aside));
  return jsonb_build_object('trip', p_trip, 'seeded', v_seeded, 'linked', coalesce(cardinality(v_mid), 0), 'new', v_new,
                            'moved', v_moved, 'stops', v_stops, 'shots', v_shots, 'shots_removed', v_gone, 'settings', v_settings, 'set_aside', v_aside);
end $function$
;
