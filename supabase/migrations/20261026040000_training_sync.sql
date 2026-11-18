-- Training copies follow their main trip every night (Phil, 26 Oct 2026:
-- "make it sync automatically every night"). training_sync(copy) copies
-- Phil's edits from the main trip onto its training copy, so the live test
-- plans the trip he will actually take:
--   stops: time, length, pin, drive minutes, notes, AllTrails link, shot
--          type, time_locked
--   shots: the main stop's shots are added (none removed)
--   planner settings: tier, light, fog, starred shot, source
-- Shots compare by place (vantage_place), so a copy's own copies of the
-- main trip's shots count as the same shot. Stops are matched through training_copy_map (copies made by
-- make_training_trip), else by day number, position and name (the live trips
-- made by hand). Only rows that differ are written. Stops Phil adds, moves to
-- another day or sets aside on the main trip are not mirrored (no match);
-- names, days and positions are never changed here, and nothing is removed.
-- pg_cron training-sync at 10:30 and 19:30 UTC, before the score builds (:41).

-- Where a shot is: stand spot and subject, rounded to ~10 m. A training copy
-- may carry its own copies of the main trip's shots: same place = same shot.
create or replace function public.vantage_place(p_vantage uuid)
returns text language sql stable set search_path = public as $$
  select concat_ws(',', round(v.lat::numeric, 4), round(v.lng::numeric, 4), round(su.lat::numeric, 4), round(su.lng::numeric, 4))
    from scout_vantages v left join scout_subjects su on su.id = v.subject_id where v.id = p_vantage
$$;

create or replace function public.training_sync(p_trip uuid, p_dry boolean default false)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_main uuid; v_mid uuid[]; v_tid uuid[]; v_pairs int; v_stops int := 0; v_shots int := 0; v_settings int := 0;
begin
  select training_of into v_main from trips where id = p_trip;
  if v_main is null then raise exception 'training_sync: % is not a training trip', p_trip; end if;

  select array_agg(old_id), array_agg(new_id) into v_mid, v_tid from training_copy_map
   where trip_id = p_trip and old_id in (select id from stops where trip_id = v_main)
     and new_id in (select id from stops where trip_id = p_trip);
  if v_mid is null then
    select array_agg(m.id), array_agg(t.id) into v_mid, v_tid
      from (select s.id, s.name, d.day_number dn, s.position from stops s join days d on d.id = s.day_id where s.trip_id = v_main) m
      join (select s.id, s.name, d.day_number dn, s.position from stops s join days d on d.id = s.day_id where s.trip_id = p_trip) t
        on t.name = m.name and t.dn = m.dn and t.position = m.position;
  end if;
  v_pairs := coalesce(cardinality(v_mid), 0);

  if p_dry then
    select count(*) into v_stops from unnest(v_mid, v_tid) x(mid, tid) join stops m on m.id = x.mid join stops t on t.id = x.tid
     where (t.time_label, t.duration_minutes, t.lat, t.lng, t.drive_override_minutes, t.info, t.alltrails_url, t.shot_type, t.time_locked)
           is distinct from (m.time_label, m.duration_minutes, m.lat, m.lng, m.drive_override_minutes, m.info, m.alltrails_url, m.shot_type, m.time_locked);
    select count(*) into v_shots from unnest(v_mid, v_tid) x(mid, tid) join stop_sun_pairs p on p.stop_id = x.mid
     where not exists (select 1 from stop_sun_pairs q where q.stop_id = x.tid
                         and (q.vantage_id = p.vantage_id or vantage_place(q.vantage_id) = vantage_place(p.vantage_id)));
    select count(*) into v_settings from unnest(v_mid, v_tid) x(mid, tid) join solver_stop_settings ms on ms.stop_id = x.mid
      left join solver_stop_inputs mi on mi.stop_id = x.mid left join solver_stop_settings ts on ts.stop_id = x.tid
      left join solver_stop_inputs ti on ti.stop_id = x.tid
     where ts.stop_id is null or (ts.tier, ts.light_wanted, ts.fog_wanted, ts.source)
           is distinct from (ms.tier, ms.light_wanted, ms.fog_wanted, ms.source)
        or vantage_place(ti.star_vantage_id) is distinct from vantage_place(mi.star_vantage_id);
    return jsonb_build_object('trip', p_trip, 'dry_run', true, 'matched', v_pairs, 'stops', v_stops, 'shots', v_shots, 'settings', v_settings);
  end if;

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

  insert into solver_stop_settings (stop_id, tier, light_wanted, fog_wanted, star_vantage_id, source, time_locked)
  select x.tid, ms.tier, ms.light_wanted, ms.fog_wanted,
         case when vantage_place(ti.star_vantage_id) = vantage_place(mi.star_vantage_id) then ti.star_vantage_id else mi.star_vantage_id end,
         ms.source, coalesce(ms.time_locked, false)
    from unnest(v_mid, v_tid) x(mid, tid) join solver_stop_settings ms on ms.stop_id = x.mid left join solver_stop_inputs mi on mi.stop_id = x.mid
    left join solver_stop_inputs ti on ti.stop_id = x.tid
  on conflict (stop_id) do update set tier = excluded.tier, light_wanted = excluded.light_wanted, fog_wanted = excluded.fog_wanted,
    star_vantage_id = excluded.star_vantage_id, source = excluded.source
   where (solver_stop_settings.tier, solver_stop_settings.light_wanted, solver_stop_settings.fog_wanted,
          solver_stop_settings.star_vantage_id, solver_stop_settings.source)
         is distinct from (excluded.tier, excluded.light_wanted, excluded.fog_wanted, excluded.star_vantage_id, excluded.source);
  get diagnostics v_settings = row_count;

  insert into app_logs (level, message, data)
  values ('info', 'training_sync', jsonb_build_object('trip', p_trip, 'main', v_main, 'matched', v_pairs,
          'stops', v_stops, 'shots', v_shots, 'settings', v_settings));
  return jsonb_build_object('trip', p_trip, 'matched', v_pairs, 'stops', v_stops, 'shots', v_shots, 'settings', v_settings);
end $$;

revoke execute on function public.training_sync(uuid, boolean) from public, anon, authenticated;
revoke execute on function public.vantage_place(uuid) from public, anon, authenticated;

-- Every running training copy, twice a day before the score builds
-- (scheduled 26 Oct 2026; dry runs then: Teton Live 44 stops, Faroes Live 83,
-- nothing to change on either).
-- select cron.schedule('training-sync', '30 10,19 * * *', $c$
--   select public.training_sync(t) from public.training_trips_active() t
--    where t in (select id from public.trips where training_of is not null);
-- $c$);
