-- Live morning re-plan on time (Phil, 30 Oct 2026: get T running well for the trip).
-- Before: the morning step waited until 75 min after the look (30 min before sunrise),
-- so on a real trip it arrived ~45 min after sunrise, and the airport report it read
-- was refreshed only every 3 h (station_obs_hourly, model-skill-refresh section G).
-- Now:
--  * replay_live_queue asks aviationweather.gov for the last 3 h of the trip station's
--    METARs every 10 min from 35 min before the look to 10 min after it (skill_probe
--    kind 'obs', harvested by model-skill-refresh every 10 min, ceiling / fog by
--    harvest_obs_extras);
--  * the morning step runs 5 min after the look once a report from the hour before the
--    look has arrived, and at the latest 30 min after the look without one;
--  * run config stagger_min delays a live run's morning step (so two runs do not share
--    a worker's CPU); the night plan is staggered with plan_local.

create or replace function public.replay_live_morning_ready(p_trip uuid, p_date date, p_stagger int default 0)
returns boolean language plpgsql set search_path to 'public' as $$
declare v_look timestamptz := replay_look_at(p_trip, p_date) + make_interval(mins => coalesce(p_stagger, 0));
begin
  if now() < v_look + interval '5 minutes' then return false; end if;
  if now() >= v_look + interval '30 minutes' then return true; end if;
  if exists (select 1 from station_obs_hourly o join replay_places p on p.station = o.station
              where p.trip_id = p_trip and o.hr >= v_look - interval '60 minutes'
                and o.fetched_at >= v_look - interval '45 minutes') then
    perform harvest_obs_extras();
    return true;
  end if;
  return false;
end $$;
revoke all on function public.replay_live_morning_ready(uuid, date, int) from public, anon, authenticated;

do $$
declare d text; o text; n text; k int;
begin
  -- Tick: the three 75-minute waits become replay_live_morning_ready.
  d := pg_get_functiondef('public.replay_run_tick()'::regprocedure);
  o := $o$continue when now() < replay_look_at(r.trip_id, v_d) + interval '75 minutes';$o$;
  n := $n$continue when not replay_live_morning_ready(r.trip_id, v_d, (r.config ->> 'stagger_min')::int);$n$;
  if position(o in d) = 0 then raise exception 'tick gate not found'; end if;
  d := replace(d, o, n);
  o := $o$(not v_live or now() >= replay_look_at(r.trip_id, r.start_date + i) + interval '75 minutes')$o$;
  n := $n$(not v_live or replay_live_morning_ready(r.trip_id, r.start_date + i, (r.config ->> 'stagger_min')::int))$n$;
  k := (length(d) - length(replace(d, o, ''))) / length(o);
  if k <> 2 then raise exception 'tick build gates: found %', k; end if;
  execute replace(d, o, n);

  -- Live queue: fresh METARs around the look.
  d := pg_get_functiondef('public.replay_live_queue()'::regprocedure);
  o := $o$    for k in 0 .. r.nights - 1 loop$o$;
  n := $n$    -- Fresh airport reports for the morning look (every 10 min, look - 35 to look + 10).
    if now() between replay_look_at(r.trip_id, r.start_date + r.night) - interval '35 minutes'
                 and replay_look_at(r.trip_id, r.start_date + r.night) + interval '10 minutes' then
      insert into skill_probe (req_id, station, kind)
      select net.http_get(url := format('https://aviationweather.gov/api/data/metar?ids=%s&format=json&hours=3', p.station),
                          timeout_milliseconds := 20000), p.station, 'obs'
        from replay_places p
       where p.trip_id = r.trip_id
         and not exists (select 1 from skill_probe s where s.station = p.station and s.kind = 'obs' and s.created_at > now() - interval '9 minutes');
      get diagnostics c = row_count; n := n + c;
    end if;
    for k in 0 .. r.nights - 1 loop$n$;
  if position(o in d) = 0 then raise exception 'live queue pattern not found'; end if;
  execute replace(d, o, n);
end $$;

-- Stagger the live runs: night plans 5 min apart, T's morning step 3 min after L's.
update replay_runs set config = config || '{"plan_local": "20:30"}' where config ->> 'name' = 'live_old' and coalesce((config ->> 'live')::boolean, false);
update replay_runs set config = config || '{"plan_local": "20:35"}' where config ->> 'name' = 'live_L' and coalesce((config ->> 'live')::boolean, false);
update replay_runs set config = config || '{"plan_local": "20:40", "stagger_min": 3}' where config ->> 'name' = 'live_T' and coalesce((config ->> 'live')::boolean, false);
