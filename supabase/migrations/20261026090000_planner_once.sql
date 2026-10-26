-- Every place once, ski outings only once (Phil, 26 Oct 2026: "the skis
-- can't be done more than once. Each stop is technically a must do"). The
-- planner scored a stop by its photo, so a 6.5 h ski with one starred shot lost
-- to four roadside views and was almost never planned. Now the bench's
-- old-planner-with-coverage plan (solver-replay fm1) plans every rated place at
-- least once, each on the day its forecast suits best, and
-- solver_stop_settings.once marks stops that cannot be repeated: the ski and
-- snowshoe outings (the rental-gear stops). Roadside views can be revisited.
-- training_sync v4 copies it like the other settings.

alter table public.solver_stop_settings add column if not exists once boolean not null default false;

update public.solver_stop_settings set once = true
 where stop_id in ('e24ab209-e8c2-429d-b9df-4d44bdec601a', 'fb31567b-f7c2-4f12-a7b1-6b89506bc6f4',
                   '8200fc29-f054-481f-bdae-5a1031a1d703', 'cd94b8ce-8b9e-46e7-979b-50d2c241dcf0',
                   'fe08c4e1-4a37-42ba-852f-1c3eac921d92', 'f42654fa-0bc4-49a1-b45d-612be84d6259',
                   '4d506ef3-2878-4725-80f3-2996766171c0', '093ce0ad-9252-4c1b-ac00-ed66a2ec5028');

create or replace function public.training_sync(p_trip uuid, p_dry boolean default false)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_main uuid; v_seeded int := 0; v_new int := 0; v_moved int := 0; v_stops int := 0; v_shots int := 0; v_settings int := 0;
  v_mid uuid[]; v_tid uuid[]; r record; v_day uuid; v_id uuid;
begin
  select training_of into v_main from trips where id = p_trip;
  if v_main is null then raise exception 'training_sync: % is not a training trip', p_trip; end if;

  -- Seed the links once (copies made before links existed).
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

  -- New stops on a main-trip day get a twin.
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
  -- Dry run before the links exist: preview with the old match.
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
        or (ts.tier, ts.light_wanted, ts.fog_wanted, ts.source, ts.together, ts.once)
           is distinct from (case when m.day_id is null then null else ms.tier end, ms.light_wanted, ms.fog_wanted, ms.source, ms.together, ms.once)
        or vantage_place(ti.star_vantage_id) is distinct from vantage_place(mi.star_vantage_id);
    return jsonb_build_object('trip', p_trip, 'dry_run', true, 'linked', coalesce(cardinality(v_mid), 0), 'new', v_new,
                              'moved', v_moved, 'stops', v_stops, 'shots', v_shots, 'settings', v_settings);
  end if;

  -- Day, position and name follow the main stop (a day the copy lacks: stays).
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

  insert into stop_sun_pairs (stop_id, vantage_id, position)
  select x.tid, p.vantage_id, 100 + p.position from unnest(v_mid, v_tid) x(mid, tid) join stop_sun_pairs p on p.stop_id = x.mid
   where not exists (select 1 from stop_sun_pairs q where q.stop_id = x.tid and vantage_place(q.vantage_id) = vantage_place(p.vantage_id))
  on conflict do nothing;
  get diagnostics v_shots = row_count;

  -- Settings; a set-aside stop's twin is set aside for the planner too (tier null).
  insert into solver_stop_settings (stop_id, tier, light_wanted, fog_wanted, star_vantage_id, source, time_locked, together, once)
  select x.tid, case when m.day_id is null then null else ms.tier end, ms.light_wanted, ms.fog_wanted,
         case when vantage_place(ti.star_vantage_id) = vantage_place(mi.star_vantage_id) then ti.star_vantage_id else mi.star_vantage_id end,
         ms.source, coalesce(ms.time_locked, false), ms.together, ms.once
    from unnest(v_mid, v_tid) x(mid, tid) join stops m on m.id = x.mid
    join solver_stop_settings ms on ms.stop_id = x.mid left join solver_stop_inputs mi on mi.stop_id = x.mid
    left join solver_stop_inputs ti on ti.stop_id = x.tid
  on conflict (stop_id) do update set tier = excluded.tier, light_wanted = excluded.light_wanted, fog_wanted = excluded.fog_wanted,
    star_vantage_id = excluded.star_vantage_id, source = excluded.source, together = excluded.together, once = excluded.once
   where (solver_stop_settings.tier, solver_stop_settings.light_wanted, solver_stop_settings.fog_wanted,
          solver_stop_settings.star_vantage_id, solver_stop_settings.source, solver_stop_settings.together, solver_stop_settings.once)
         is distinct from (excluded.tier, excluded.light_wanted, excluded.fog_wanted, excluded.star_vantage_id, excluded.source, excluded.together, excluded.once);
  get diagnostics v_settings = row_count;

  insert into app_logs (level, message, data)
  values ('info', 'training_sync', jsonb_build_object('trip', p_trip, 'main', v_main, 'seeded', v_seeded,
          'linked', coalesce(cardinality(v_mid), 0), 'new', v_new, 'moved', v_moved, 'stops', v_stops, 'shots', v_shots, 'settings', v_settings));
  return jsonb_build_object('trip', p_trip, 'seeded', v_seeded, 'linked', coalesce(cardinality(v_mid), 0), 'new', v_new,
                            'moved', v_moved, 'stops', v_stops, 'shots', v_shots, 'settings', v_settings);
end $$;


revoke execute on function public.training_sync(uuid, boolean) from public, anon, authenticated;

-- Phil, 26 Oct 2026: "Barns are repeatable": the two Moulton barns are not once-only.
update public.solver_stop_settings set once = false
 where stop_id in ('8200fc29-f054-481f-bdae-5a1031a1d703', 'cd94b8ce-8b9e-46e7-979b-50d2c241dcf0');
