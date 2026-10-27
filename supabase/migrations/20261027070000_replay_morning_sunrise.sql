-- Morning-of replan, the look moved to 30 minutes before sunrise (Phil, 27 Oct
-- 2026: "do the check not at 8am but maybe 30 min before sunrise on that day"),
-- so the replan can still change the sunrise shot. At that hour in the two Teton
-- winters only the airport reports (TetonCam history is labelled from 08:00), and
-- that is nearly as good: leave-one-winter-out Brier for the later hours, forecast
-- only 0.171, airport ~07:00 0.137, airport + camera at 08:00 0.129.
-- The look = the latest hidden report (airport or camera) in the hour before the
-- look time; it changes the hidden chance for every slot from an hour after it.
-- Plan kinds: mr1 = v3 + replan, mrmc = v3 + Monte Carlo + replan.

create or replace function public.replay_look_at(p_trip uuid, p_date date)
 returns timestamptz
 language plpgsql stable
 set search_path to 'public', 'extensions'
as $function$
declare v_tz text; v_lat double precision; v_lng double precision; t timestamptz; i int;
begin
  select coalesce(tr.timezone, 'UTC'), s.lat, s.lng into v_tz, v_lat, v_lng
    from replay_places p join trips tr on tr.id = p.trip_id join metar_stations s on s.icao = p.station
   where p.trip_id = p_trip;
  t := (p_date + time '03:00') at time zone v_tz;
  for i in 0 .. 540 loop
    if (select sp.altitude from sun_position(t, v_lat, v_lng) sp) > -0.833 then return t - interval '30 minutes'; end if;
    t := t + interval '1 minute';
  end loop;
  return (p_date + time '08:00') at time zone v_tz;
end $function$;

create or replace function public.replay_fit_morning()
 returns integer
 language plpgsql
 set search_path to 'public', 'extensions'
as $function$
declare n int;
begin
  truncate replay_morning_counts;
  insert into replay_morning_counts (trip_id, season, model, m8, bin, n, hits)
  with hrs as (
    select distinct p.trip_id, t.timezone tz, o.hr, o.hidden, (o.hr at time zone t.timezone)::date ld
      from replay_places p
      join trips t on t.id = p.trip_id
      join replay_hidden_truth o on o.trip_id = p.trip_id
      join metar_stations s on s.icao = p.station
     where exists (select 1 from replay_wx_day w where w.point_key = p.fc_point and w.day = (o.hr at time zone 'UTC')::date)
       and (select sp.altitude from sun_position(o.hr, s.lat, s.lng) sp) > 0
  ), days as (
    select d.trip_id, d.ld, replay_look_at(d.trip_id, d.ld) look from (select distinct trip_id, ld from hrs) d
  ), looks as (
    select d.trip_id, d.ld, d.look,
           (select o.hidden from replay_hidden_truth o
             where o.trip_id = d.trip_id and o.hr between d.look - interval '1 hour' and d.look
             order by o.hr desc limit 1) m8
      from days d
  )
  select h.trip_id, replay_season((h.hr at time zone 'UTC')::date), w.model, l.m8,
         replay_cloud_bin(w.cloud[extract(hour from h.hr at time zone 'UTC')::int + 1]), count(*), sum(h.hidden)
    from hrs h
    join looks l on l.trip_id = h.trip_id and l.ld = h.ld and l.m8 is not null
    join replay_places p on p.trip_id = h.trip_id
    join replay_wx_day w on w.point_key = p.fc_point and w.day = (h.hr at time zone 'UTC')::date
   where h.hr >= l.look + interval '1 hour'
     and w.cloud[extract(hour from h.hr at time zone 'UTC')::int + 1] is not null
     and not exists (select 1 from replay_model_dups d where d.point_key = w.point_key and d.model = w.model and d.day = w.day)
   group by 1, 2, 3, 4, 5;
  get diagnostics n = row_count;
  return n;
end $function$;

do $$
declare d text := pg_get_functiondef('replay_build(bigint, text, integer)'::regprocedure);
  pairs text[][] := array[
    array['v_mfit jsonb; v_m8 int; v_tz text;', 'v_mfit jsonb; v_m8 int; v_tz text; v_look timestamptz;'],
    array['-- Morning: the latest hidden report from 07:00-08:00 local', '-- Morning (30 min before sunrise): the latest hidden report in the hour before'],
    array['    select coalesce(timezone, ''UTC'') into v_tz from trips where id = v.trip_id;',
          '    select coalesce(timezone, ''UTC'') into v_tz from trips where id = v.trip_id;
    v_look := replay_look_at(v.trip_id, v.replay_date);'],
    array['and o.hr between ((v.replay_date + time ''08:00'') at time zone v_tz) - interval ''1 hour'' and ((v.replay_date + time ''08:00'') at time zone v_tz)',
          'and o.hr between v_look - interval ''1 hour'' and v_look'],
    array['extract(hour from a.hr at time zone v_tz) >= 9', 'a.hr >= v_look + interval ''1 hour''']
  ];
  k int;
begin
  for k in 1 .. array_length(pairs, 1) loop
    if position(pairs[k][1] in d) = 0 then raise exception 'replay_build: text % not found', k; end if;
    d := replace(d, pairs[k][1], pairs[k][2]);
  end loop;
  execute d;
end $$;

do $$
declare d text := pg_get_functiondef('replay_run_tick()'::regprocedure);
  pairs text[][] := array[
    array['''fm1'', ''mc1'', ''mr1''] then', '''fm1'', ''mc1'', ''mr1'', ''mrmc''] then'],
    array['if i = r.night and ''mr1'' = any(v_kinds) and', 'if i = r.night and v_kinds && array[''mr1'', ''mrmc''] and'],
    array['if v_kinds && array[''blk'', ''imp'', ''mc1''] and', 'if v_kinds && array[''blk'', ''imp'', ''mc1'', ''mrmc''] and']
  ];
  k int;
begin
  for k in 1 .. array_length(pairs, 1) loop
    if position(pairs[k][1] in d) = 0 then raise exception 'replay_run_tick: text % not found', k; end if;
    d := replace(d, pairs[k][1], pairs[k][2]);
  end loop;
  execute d;
end $$;
