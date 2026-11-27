-- g3 (Phil, 9 Nov 2026: "yes"): Claude checks T's plans for what the planner can't see (closures,
-- avalanche danger, wind and weather warnings), with live web search. Teton Live first, through
-- December. Edge function t-review fills t_reviews; flags only, it never changes a plan.
create table if not exists public.t_reviews (
  id bigserial primary key,
  trip_id uuid not null,
  run_id uuid not null unique,          -- the solver_runs row whose rank-1 plan was checked
  plan_date date,
  note text,                            -- 'T: evening plan' / 'T: morning re-plan' / ... 
  status text not null default 'queued',  -- queued | running | done | error | skipped
  verdict text,                         -- ok | check | problem
  summary text,
  flags jsonb,
  checks jsonb,
  cost_usd numeric,
  error text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  done_at timestamptz
);
alter table public.t_reviews enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 't_reviews' and policyname = 'app_read') then
    create policy app_read on public.t_reviews for select using (true);
  end if;
end $$;

alter table public.planner_t_trips add column if not exists review boolean not null default false;
update public.planner_t_trips set review = true where trip_id = '7e57bed0-0000-4000-8000-000000000003';

-- Every 10 min: queue the newest evening / morning plans of trips with review on (made in the last
-- 3 h, one review per plan), send each queued review to t-review, and close reviews stuck for 15 min.
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
  for r in select id from t_reviews where status = 'queued' and created_at > now() - interval '3 hours' order by id limit 3 loop
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
revoke all on function public.t_review_queue() from public, anon, authenticated;

do $$ begin
  if exists (select 1 from cron.job where jobname = 't-review') then perform cron.unschedule('t-review'); end if;
  perform cron.schedule('t-review', '*/10 * * * *', 'select public.t_review_queue()');
end $$;
