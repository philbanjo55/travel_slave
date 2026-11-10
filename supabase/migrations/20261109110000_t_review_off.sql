-- Phil, 9 Nov 2026 ("why use the API vs you"): the plan check runs as a scheduled Claude session
-- (scheduled task "Teton plan check (Claude, evening)", 04:12 UTC daily, under Phil's plan, no API
-- cost) that writes the same t_reviews rows. The paid edge function t-review stays deployed as a
-- fallback but no trip queues it: review is off everywhere and the queue cron is removed.
update public.planner_t_trips set review = false where review;
do $$ begin
  if exists (select 1 from cron.job where jobname = 't-review') then perform cron.unschedule('t-review'); end if;
end $$;
