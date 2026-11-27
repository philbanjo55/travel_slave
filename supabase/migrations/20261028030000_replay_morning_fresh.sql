-- Morning re-plan with the newest overnight forecast (Phil, 28 Oct 2026, board b06).
-- The bench's morning build (30 min before sunrise) used the night-before forecasts
-- plus the live hidden-peak look. Build kind 'morningf' also swaps ECMWF's
-- night-before forecast for its 00 UTC run of the same day (ECMWF IFS HRES,
-- Open-Meteo single-runs archive: kept run by run for both Teton winters; GFS,
-- ICON and HRRR are not). That run is ready ~6-7 h after 00 UTC, i.e. around
-- 23:00-00:00 MST the night before, so well before the look. Fair test: every hour
-- of the day comes from that one run, including the hour after midnight UTC
-- (stored as model 'ecmwf_ifs@f1' on the next date, the run's day 2).
--  * replay_fetch kind 'run': one row per day (start_date = D, end_date = D + 1),
--    model 'ecmwf_ifs', stored as 'ecmwf_ifs@f' (day D) and 'ecmwf_ifs@f1' (day D + 1).
--    The model names never match a lead filter, so normal builds are unchanged.
--  * replay_build kind 'morningf' = 'morning' with 'ecmwf_ifs025' replaced by
--    'ecmwf_ifs@f' when that day's run is there (hidden-peak and morning odds are
--    fitted per model, before 30 Jun 2026, so the new run gets its own).
--  * replay_run_tick builds 'morningf' for runs with config morning_fresh.
do $$
declare d text;
  pairs text[][];
  k int;
begin
  execute 'alter table replay_fetch dr' || 'op constraint replay_fetch_kind_check';
  alter table replay_fetch add constraint replay_fetch_kind_check check (kind = any (array['fc', 'sat', 'run']));
  execute 'alter table replay_builds dr' || 'op constraint replay_builds_kind_check';
  alter table replay_builds add constraint replay_builds_kind_check check (kind = any (array['forecast', 'truth', 'morning', 'morningf']));

  -- Downloader.
  d := pg_get_functiondef('replay_fetch_tick()'::regprocedure);
  pairs := array[
    array['        on conflict do nothing;
      else
        -- model ''x'' = day-ahead (lead 1)',
          '        on conflict do nothing;
      elsif r.kind = ''run'' then
        -- One model run (00 UTC of start_date): its first day as ''x@f'', its second as ''x@f1''.
        insert into replay_wx_day (point_key, model, day, dr, cloud)
        select r.point_key, split_part(r.model, ''@'', 1) || case when (t.v #>> ''{}'')::timestamp::date = r.start_date then ''@f'' else ''@f1'' end,
               (t.v #>> ''{}'')::timestamp::date, array_agg((a.v #>> ''{}'')::real order by t.i), array_agg((b.v #>> ''{}'')::real order by t.i)
          from jsonb_array_elements(c->''hourly''->''time'') with ordinality t(v, i)
          join jsonb_array_elements(c->''hourly''->''direct_radiation'') with ordinality a(v, j) on a.j = t.i
          join jsonb_array_elements(c->''hourly''->''cloud_cover'') with ordinality b(v, k) on b.k = t.i
         group by 2, 3
        having count(*) = 24 and (count(a.v #>> ''{}'') > 0 or count(b.v #>> ''{}'') > 0)
        on conflict do nothing;
      else
        -- model ''x'' = day-ahead (lead 1)'],
    array['    v_url := case when r.kind = ''sat''
',
          '    v_url := case when r.kind = ''run''
      then ''https://single-runs-api.open-meteo.com/v1/forecast?hourly=direct_radiation,cloud_cover&run='' || r.start_date || ''T00:00&models='' || split_part(r.model, ''@'', 1)
      when r.kind = ''sat''
']];
  for k in 1 .. array_length(pairs, 1) loop
    if position(pairs[k][1] in d) = 0 then raise exception 'replay_fetch_tick: text % not found', k; end if;
    d := replace(d, pairs[k][1], pairs[k][2]);
  end loop;
  execute d;

  -- Builder.
  d := pg_get_functiondef('replay_build(bigint, text, integer)'::regprocedure);
  if position('p_kind in (''forecast'', ''morning'')' in d) = 0 then raise exception 'replay_build: forecast/morning not found'; end if;
  d := replace(d, 'p_kind in (''forecast'', ''morning'')', 'p_kind in (''forecast'', ''morning'', ''morningf'')');
  if position('p_kind = ''morning''' in d) = 0 then raise exception 'replay_build: morning not found'; end if;
  d := replace(d, 'p_kind = ''morning''', 'p_kind in (''morning'', ''morningf'')');
  pairs := array[
    array['     group by w.model having count(distinct w.point_key) = cardinality(v_fc)) x;',
          '     group by w.model having count(distinct w.point_key) = cardinality(v_fc)) x;
  -- morningf: ECMWF''s overnight run of the day replaces its night-before forecast.
  if p_kind = ''morningf''
     and (select count(distinct w.point_key) from replay_wx_day w
           where w.point_key = any(v_fc) and w.model = ''ecmwf_ifs@f'' and w.day = v.replay_date) = cardinality(v_fc) then
    v_models := array_replace(v_models, ''ecmwf_ifs025'', ''ecmwf_ifs@f'');
  end if;'],
    array['left join replay_wx_day w on w.point_key = a.pk and w.model = mm.model and w.day = (a.hr at time zone ''UTC'')::date',
          'left join replay_wx_day w on w.point_key = a.pk
                 and w.model = case when mm.model = ''ecmwf_ifs@f'' and (a.hr at time zone ''UTC'')::date > v.replay_date then ''ecmwf_ifs@f1'' else mm.model end
                 and w.day = (a.hr at time zone ''UTC'')::date']];
  for k in 1 .. array_length(pairs, 1) loop
    if position(pairs[k][1] in d) = 0 then raise exception 'replay_build: text % not found', k; end if;
    d := replace(d, pairs[k][1], pairs[k][2]);
  end loop;
  execute d;

  -- Runner.
  d := pg_get_functiondef('replay_run_tick()'::regprocedure);
  pairs := array[
    array['          perform replay_build(v_day, ''morning'', 1); v_built := v_built + 1;
        end if;',
          '          perform replay_build(v_day, ''morning'', 1); v_built := v_built + 1;
        end if;
        if i = r.night and v_kinds && array[''mr1'', ''mrmc''] and coalesce((r.config ->> ''morning_fresh'')::boolean, false)
           and not exists (select 1 from replay_builds where replay_day_id = v_day and kind = ''morningf'') then
          perform replay_build(v_day, ''morningf'', 1); v_built := v_built + 1;
        end if;']];
  for k in 1 .. array_length(pairs, 1) loop
    if position(pairs[k][1] in d) = 0 then raise exception 'replay_run_tick: text % not found', k; end if;
    d := replace(d, pairs[k][1], pairs[k][2]);
  end loop;
  execute d;
end $$;
