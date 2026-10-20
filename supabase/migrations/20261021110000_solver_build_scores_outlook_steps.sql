-- Outlook days: beyond 144 h ECMWF is stored 6-hourly, so slots there join the
-- nearest 6-hour step (3-hour steps before), and the rained-in-the-last-day
-- sum weights each step by its real length instead of assuming 3 h.
do $do$
declare d text := pg_get_functiondef('public.solver_build_scores(uuid, uuid)'::regprocedure);
declare n text;
begin
  n := replace(d,
$a$    select *, 3 * sum(coalesce(p, 0)) over (partition by cell_key, k order by valid_at
                                            range between interval '21 hours' preceding and current row) / 10.0 as rain24
      from ecm$a$,
$b$    select *, sum(coalesce(p, 0) * hrs) over (partition by cell_key, k order by valid_at
                                              range between interval '21 hours' preceding and current row) / 10.0 as rain24
      from (select *, coalesce(extract(epoch from valid_at - lag(valid_at) over (partition by cell_key, k order by valid_at)) / 3600, 3) as hrs
              from ecm) e$b$);
  n := replace(n,
$a$           to_timestamp(round(extract(epoch from c.slot_at) / 10800) * 10800) as at3,$a$,
$b$           case when c.slot_at > (select pulled_at from weather_ensemble_pulls where id = v_pull) + interval '144 hours'
                then to_timestamp(round(extract(epoch from c.slot_at) / 21600) * 21600)
                else to_timestamp(round(extract(epoch from c.slot_at) / 10800) * 10800) end as at3,$b$);
  if n = d or n not like '%hrs%' or n not like '%21600%' then raise exception 'builder text not matched'; end if;
  execute n;
end $do$;
