-- Phil, 23 Oct 2026: "Remove the stop" (National Elk Refuge — Miller Butte,
-- Teton day 2). Stops are never deleted (cascades), so a removed stop is set
-- aside: no day (day_id null), no tier (the planner skips it), notes kept.
-- Same on the Teton Live copy.
update stops set day_id = null, position = 0
 where id in ('b3673af4-0cff-4eb5-9613-b813bb019211', 'fab8a4b5-15bf-4cd5-ba65-72782faf163a');
update solver_stop_settings set tier = null, source = 'phil', note = 'Removed from the trip by Phil, 23 Oct 2026 (unscheduled, kept for its notes)'
 where stop_id in ('b3673af4-0cff-4eb5-9613-b813bb019211', 'fab8a4b5-15bf-4cd5-ba65-72782faf163a');
update stops set position = 6, drive_override_minutes = 4, time_label = '2:30 PM',
       info = coalesce(info || E'\n', '') || 'Afternoon open (Elk Refuge stop taken out, 23 Oct): rest, or Glacier View for last light.'
 where id in ('022fe2fb-8e41-47b3-a07b-a117c0cbe38e', '5eb02171-3114-4747-902e-1e98e1398c6e');
update days set subtitle = 'SRO sunrise · Chapel · Menor''s Ferry · Gros Ventre · gear pickup'
 where id in ('843a0e31-fa1e-4076-9603-1eb54b288f81', '7fdec3ac-ffff-4fb8-8d63-5d9981dc366a');

-- trip_readiness: stops with no day are "set aside" (a note, not a to-do)
-- and leave the shot / settings counts.
do $$
declare d text;
begin
  d := pg_get_functiondef('public.trip_readiness(uuid)'::regprocedure);
  d := replace(d, 'or m > 0 or k > 0 then ''todo''', 'or m > 0 then ''todo''');
  d := replace(d, '|| case when k > 0 then '', '' || k || '' without a day'' else '''' end', '|| case when k > 0 then '', '' || k || '' set aside (no day)'' else '''' end');
  d := replace(d, 'into n, m from stops s where s.trip_id = p_trip and s.lat is not null and s.shot_type is distinct from ''logistics'';',
                  'into n, m from stops s where s.trip_id = p_trip and s.lat is not null and s.shot_type is distinct from ''logistics'' and s.day_id is not null;');
  d := replace(d, '   where s.trip_id = p_trip and s.lat is not null and s.shot_type is distinct from ''logistics'';',
                  '   where s.trip_id = p_trip and s.lat is not null and s.shot_type is distinct from ''logistics'' and s.day_id is not null;');
  execute d;
end $$;
