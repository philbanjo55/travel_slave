-- Planner test bench, upgrade #6 (Phil, 27 Oct 2026): morning-of replan.
-- At 08:00 local the planner looks at whether the peaks are hidden right now
-- (the airport or the place's camera, the latest report from 07:00-08:00, no
-- peeking ahead) and re-plans the rest of the day. Over the two Teton winters
-- the peaks stay put: clear at 08:00 -> hidden 10-26% of the later hours,
-- hidden at 08:00 -> 76-92% (all days: ~63%). Leave-one-winter-out Brier for
-- 09:00-16:00: forecast only 0.172, the 08:00 look only 0.151, both 0.134
-- (both winters better).
--
-- replay_morning_counts / replay_morning_fit: hidden later that day per model x
-- the 08:00 look x the model's cloud bin (fitted on the other winters, like
-- replay_hidden_fit). replay_build(day, 'morning', 1): the lead-1 forecast build
-- with that chance for every slot from 08:00 (earlier slots unchanged).
-- replay_run_tick builds it for plan kind 'mr1' (fm1 v3 + the morning replan,
-- solver-replay v19).

create table if not exists public.replay_morning_counts (
  trip_id uuid not null, season int not null, model text not null, m8 int not null, bin int not null,
  n int not null, hits int not null
);

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
    select distinct p.trip_id, t.timezone tz, o.hr, o.hidden,
           (o.hr at time zone t.timezone)::date ld, extract(hour from o.hr at time zone t.timezone)::int lh
      from replay_places p
      join trips t on t.id = p.trip_id
      join replay_hidden_truth o on o.trip_id = p.trip_id
      join metar_stations s on s.icao = p.station
     where exists (select 1 from replay_wx_day w where w.point_key = p.fc_point and w.day = (o.hr at time zone 'UTC')::date)
       and (select sp.altitude from sun_position(o.hr, s.lat, s.lng) sp) > 0
  ), looks as (
    select d.trip_id, d.ld,
           (select o.hidden from replay_hidden_truth o
             where o.trip_id = d.trip_id
               and o.hr between ((d.ld + time '08:00') at time zone d.tz) - interval '1 hour' and ((d.ld + time '08:00') at time zone d.tz)
             order by o.hr desc limit 1) m8
      from (select distinct trip_id, tz, ld from hrs) d
  )
  select h.trip_id, replay_season((h.hr at time zone 'UTC')::date), w.model, l.m8,
         replay_cloud_bin(w.cloud[extract(hour from h.hr at time zone 'UTC')::int + 1]), count(*), sum(h.hidden)
    from hrs h
    join looks l on l.trip_id = h.trip_id and l.ld = h.ld and l.m8 is not null
    join replay_places p on p.trip_id = h.trip_id
    join replay_wx_day w on w.point_key = p.fc_point and w.day = (h.hr at time zone 'UTC')::date
   where h.lh >= 9
     and w.cloud[extract(hour from h.hr at time zone 'UTC')::int + 1] is not null
     and not exists (select 1 from replay_model_dups d where d.point_key = w.point_key and d.model = w.model and d.day = w.day)
   group by 1, 2, 3, 4, 5;
  get diagnostics n = row_count;
  return n;
end $function$;

create or replace view public.replay_morning_fit as
with s as (select distinct trip_id, season from replay_morning_counts),
agg as (
  select s.trip_id, s.season, c.model, c.m8, c.bin, sum(c.n) n, sum(c.hits) hits
    from s join replay_morning_counts c on c.trip_id = s.trip_id and c.season <> s.season
   group by 1, 2, 3, 4, 5),
base as (
  select trip_id, season, model, m8, sum(hits)::real / nullif(sum(n), 0) p0 from agg group by 1, 2, 3, 4)
select a.trip_id, a.season, a.model, a.m8, a.bin, a.n,
       ((a.hits + 2 * b.p0) / (a.n + 2))::real p
  from agg a join base b using (trip_id, season, model, m8);

-- replay_build: kind 'morning' = the forecast build with the 08:00 look.
do $$
declare d text := pg_get_functiondef('replay_build(bigint, text, integer)'::regprocedure);
  pairs text[][] := array[
    array['v_sfit jsonb;', 'v_sfit jsonb; v_mfit jsonb; v_m8 int; v_tz text;'],
    array['if p_kind = ''forecast'' and coalesce(cardinality(v_models), 0) = 0 then', 'if p_kind in (''forecast'', ''morning'') and coalesce(cardinality(v_models), 0) = 0 then'],
    array['  -- {model: {bin: p}} sun calibration',
          '  -- Morning: the latest hidden report from 07:00-08:00 local and {model: {look: {bin: p}}}.
  if p_kind = ''morning'' then
    select coalesce(timezone, ''UTC'') into v_tz from trips where id = v.trip_id;
    select o.hidden into v_m8 from replay_hidden_truth o
     where o.trip_id = v.trip_id
       and o.hr between ((v.replay_date + time ''08:00'') at time zone v_tz) - interval ''1 hour'' and ((v.replay_date + time ''08:00'') at time zone v_tz)
     order by o.hr desc limit 1;
    select jsonb_object_agg(model, ps) into v_mfit from (
      select model, jsonb_object_agg(m8::text, bs) ps from (
        select model, m8, jsonb_object_agg(bin::text, p) bs from replay_morning_fit
         where trip_id = v.trip_id and season = v_season group by model, m8) a group by model) f;
  end if;
  -- {model: {bin: p}} sun calibration'],
    array['case when p_kind = ''forecast'' then p_lead else 0 end, case when p_kind = ''forecast'' then cardinality(v_models) else 1 end',
          'case when p_kind in (''forecast'', ''morning'') then p_lead else 0 end, case when p_kind in (''forecast'', ''morning'') then cardinality(v_models) else 1 end'],
    array['select distinct case when p_kind = ''forecast'' then fc_key else sat_key end pk', 'select distinct case when p_kind in (''forecast'', ''morning'') then fc_key else sat_key end pk'],
    array['coalesce((v_fit -> mm.model ->> (replay_cloud_bin(x.cloud) - 1))::real,',
          'coalesce(case when p_kind = ''morning'' and v_m8 is not null and extract(hour from a.hr at time zone v_tz) >= 9
                         then (v_mfit -> mm.model -> v_m8::text ->> replay_cloud_bin(x.cloud)::text)::real end,
                    (v_fit -> mm.model ->> (replay_cloud_bin(x.cloud) - 1))::real,'],
    array['     where p_kind = ''forecast''
  ), fc as', '     where p_kind in (''forecast'', ''morning'')
  ), fc as'],
    array['join sun on sun.pk = (case when p_kind = ''forecast'' then s.fc_key else s.sat_key end)', 'join sun on sun.pk = (case when p_kind in (''forecast'', ''morning'') then s.fc_key else s.sat_key end)']
  ];
  k int;
begin
  for k in 1 .. array_length(pairs, 1) loop
    if position(pairs[k][1] in d) = 0 then raise exception 'replay_build: text % not found', k; end if;
    d := replace(d, pairs[k][1], pairs[k][2]);
  end loop;
  execute d;
end $$;

-- replay_run_tick: mr1 sees the forecast days like fm1, gets the morning build of
-- its next day, and the morning fit is refreshed with the others.
do $$
declare d text := pg_get_functiondef('replay_run_tick()'::regprocedure);
  pairs text[][] := array[
    array['array[''fc3'', ''lt3'', ''hs3'', ''blk'', ''imp'', ''fm1'', ''mc1''] then', 'array[''fc3'', ''lt3'', ''hs3'', ''blk'', ''imp'', ''fm1'', ''mc1'', ''mr1''] then'],
    array['perform replay_build(v_day, ''forecast'', v_l); v_built := v_built + 1;
        end if;', 'perform replay_build(v_day, ''forecast'', v_l); v_built := v_built + 1;
        end if;
        if i = r.night and ''mr1'' = any(v_kinds) and not exists (select 1 from replay_builds where replay_day_id = v_day and kind = ''morning'') then
          perform replay_build(v_day, ''morning'', 1); v_built := v_built + 1;
        end if;'],
    array['perform replay_fit_hidden();', 'perform replay_fit_hidden();
    perform replay_fit_morning();']
  ];
  k int;
begin
  for k in 1 .. array_length(pairs, 1) loop
    if position(pairs[k][1] in d) = 0 then raise exception 'replay_run_tick: text % not found', k; end if;
    d := replace(d, pairs[k][1], pairs[k][2]);
  end loop;
  execute d;
end $$;
