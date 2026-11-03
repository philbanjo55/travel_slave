-- T2: run config wx (rain, wind, waterfall bonus) builds its own forecast / morning builds
-- (lead + 20) and truth (lead 20, ERA5 rain and gusts); runs without it are unchanged.
do $mig$
declare d text; w text := 'case when coalesce((r.config ->> ''wx'')::boolean, false) then 20 else 0 end';
begin
  d := pg_get_functiondef('public.replay_run_tick()'::regprocedure);

  if position('and kind = ''truth'') then
          perform replay_build(v_day, ''truth''); v_built := v_built + 1;' in d) = 0 then raise exception 'tick: truth build not found'; end if;
  d := replace(d, 'and kind = ''truth'') then
          perform replay_build(v_day, ''truth''); v_built := v_built + 1;',
    'and kind = ''truth'' and lead = ' || w || ') then
          perform replay_build(v_day, ''truth'', greatest(1, ' || w || ')); v_built := v_built + 1;');

  if position('+ case when coalesce((r.config ->> ''calsun'')::boolean, false) then 10 else 0 end;' in d) = 0 then raise exception 'tick: lead not found'; end if;
  d := replace(d, '+ case when coalesce((r.config ->> ''calsun'')::boolean, false) then 10 else 0 end;',
    '+ case when coalesce((r.config ->> ''calsun'')::boolean, false) then 10 else 0 end + ' || w || ';');

  if position('and kind = ''morning'') then
          perform replay_build(v_day, ''morning'', 1);' in d) = 0 then raise exception 'tick: morning not found'; end if;
  d := replace(d, 'and kind = ''morning'') then
          perform replay_build(v_day, ''morning'', 1);',
    'and kind = ''morning'' and lead = 1 + ' || w || ') then
          perform replay_build(v_day, ''morning'', 1 + ' || w || ');');

  if position('and kind = ''morningf'') then
          perform replay_build(v_day, ''morningf'', 1);' in d) = 0 then raise exception 'tick: morningf not found'; end if;
  d := replace(d, 'and kind = ''morningf'') then
          perform replay_build(v_day, ''morningf'', 1);',
    'and kind = ''morningf'' and lead = 1 + ' || w || ') then
          perform replay_build(v_day, ''morningf'', 1 + ' || w || ');');

  execute d;
end $mig$;
