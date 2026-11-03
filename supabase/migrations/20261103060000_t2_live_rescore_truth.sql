-- T2 live (3 Nov 2026): a live run with wx scores its nights against the wx truth (lead 20),
-- which solver-replay v56 looks for; the rescore loop only ever built the plain truth (lead 0),
-- so wx nights would wait for a truth that never came.
do $mig$
declare d text; o text;
begin
  d := pg_get_functiondef('public.replay_run_tick()'::regprocedure);
  o := $o$  for r in select x.id, x.trip_id, x.state, d.night dn, d.kind dk, d.replay_date dd$o$;
  if position(o in d) = 0 then raise exception 'tick: rescore select not found'; end if;
  d := replace(d, o, $n$  for r in select x.id, x.trip_id, x.state, d.night dn, d.kind dk, d.replay_date dd,
                    case when coalesce((x.config ->> 'wx')::boolean, false) then 20 else 0 end tl$n$);
  o := $o$      if not exists (select 1 from replay_builds where replay_day_id = v_day and kind = 'truth') then
        perform replay_build(v_day, 'truth'); v_built := v_built + 1;$o$;
  if position(o in d) = 0 then raise exception 'tick: rescore build not found'; end if;
  d := replace(d, o, $n$      if not exists (select 1 from replay_builds where replay_day_id = v_day and kind = 'truth' and lead = r.tl) then
        perform replay_build(v_day, 'truth', greatest(1, r.tl)); v_built := v_built + 1;$n$);
  execute d;
end $mig$;
