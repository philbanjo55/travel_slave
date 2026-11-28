-- T's own forecast for one stop through the day (Phil, 28 Nov 2026: the stop chart was one flat bar: it drew the old
-- typical-light curve, where every daylight slot counts as good). Read only: the newest T build of that date for the
-- stop's trip (forecast / morning / camera look / re-plan now; never the truth), per 15 minutes the average shot value
-- (0-100) and how many of the build's weather versions are a good shot (value >= 0.6). No build for that day (past the
-- forecast) = null, and the app draws typical light dotted.
create or replace function t_stop_curve(p_stop uuid, p_date date) returns jsonb
language plpgsql stable security definer set search_path to 'public' as $f$
declare v_trip uuid; v_b record; r jsonb;
begin
  select trip_id into v_trip from stops where id = p_stop;
  if v_trip is null then return null; end if;
  select b.id, b.kind, b.created_at into v_b
    from replay_builds b join replay_days d on d.id = b.replay_day_id
   where d.trip_id = v_trip and d.replay_date = p_date
     and b.kind in ('forecast', 'morning', 'morningf', 'early', 'earlyf', 'now', 'nowf')
     and exists (select 1 from replay_scores_c c where c.build_id = b.id and c.stop_id = p_stop)
   order by b.created_at desc limit 1;
  if v_b.id is null then return null; end if;
  select jsonb_build_object('kind', v_b.kind, 'made', v_b.created_at, 'slots', coalesce(jsonb_agg(x order by x ->> 't'), '[]'::jsonb))
    into r
    from (select jsonb_build_object('t', c.t0 + c.offs[i] * interval '15 minutes',
                                    'pct', round(avg(c.v[i][m]) / 2.5),
                                    'good', sum((c.v[i][m] >= 150)::int), 'of', count(*)) x
            from replay_scores_c c, generate_subscripts(c.offs, 1) i, generate_series(1, array_length(c.v, 2)) m
           where c.build_id = v_b.id and c.stop_id = p_stop
           group by c.t0, c.offs[i]) s;
  return r;
end $f$;
grant execute on function t_stop_curve(uuid, date) to anon, authenticated;
