-- Plan check: one check per evening, not one per note (Phil's first real use, 11 Nov 2026: three notes re-made the
-- 12 Nov evening plan and each version got its own paid check, $2.48). A queued check now waits until its plan has
-- stood for 12 minutes, and a check whose plan has a newer version (same trip, date and kind) is skipped as
-- 'superseded'. Nothing else changes: same plans qualify, same caps, same edge function.
create or replace function public.t_review_queue()
 returns integer
 language plpgsql
 set search_path to 'public', 'extensions'
as $function$
declare n int := 0; r record;
begin
  update t_reviews set status = 'error', error = 'no answer in 15 min', done_at = now()
   where status = 'running' and started_at < now() - interval '15 minutes';
  insert into t_reviews (trip_id, run_id, plan_date, note)
  select sr.trip_id, sr.id, sr.plan_date, p.note
    from solver_runs sr join solver_plans p on p.run_id = sr.id and p.rank = 1
    join planner_t_trips t on t.trip_id = sr.trip_id and t.review
   where sr.created_at > now() - interval '3 hours'
     and p.note in ('T: evening plan', 'T: morning re-plan', 'T: morning re-plan (cameras)')
     -- practice trips: the evening plan only (~$0.60 a review, 9 Nov 2026); real trips: every plan
     and (p.note = 'T: evening plan' or not exists (select 1 from trips tr where tr.id = sr.trip_id and tr.training_of is not null))
     and jsonb_array_length(coalesce(p.visits, '[]'::jsonb)) > 0
  on conflict (run_id) do nothing;
  -- a newer version of the same plan (same trip, date and kind) replaces a queued check
  update t_reviews q set status = 'skipped', error = 'superseded by a newer plan', done_at = now()
   where q.status = 'queued'
     and exists (select 1 from t_reviews q2 join solver_runs s2 on s2.id = q2.run_id
                   join solver_runs s1 on s1.id = q.run_id
                  where q2.trip_id = q.trip_id and q2.plan_date = q.plan_date and q2.note = q.note
                    and q2.id <> q.id and s2.created_at > s1.created_at);
  for r in select q.id from t_reviews q join solver_runs sr on sr.id = q.run_id
            where q.status = 'queued' and q.created_at > now() - interval '3 hours'
              and sr.created_at <= now() - interval '12 minutes'   -- let quick re-plans settle first
            order by q.id limit 3 loop
    update t_reviews set status = 'running', started_at = now() where id = r.id;
    perform net.http_post(
      url := 'https://ohshrzlvvxyovcjmdajc.supabase.co/functions/v1/t-review',
      body := jsonb_build_object('review_id', r.id),
      headers := '{"Content-Type":"application/json"}'::jsonb, timeout_milliseconds := 1000);
    n := n + 1;
  end loop;
  update t_reviews set status = 'skipped', error = 'too old', done_at = now() where status = 'queued' and created_at <= now() - interval '3 hours';
  return n;
end $function$;
