-- Phil, 9 Nov 2026 ("Keep api for now"): the plan check goes back to the paid edge function t-review
-- (fires within 10 min of each new plan). Teton Live: evening plans only; the real Grand Teton trip:
-- every evening / morning / camera plan (t_review_queue() picks them; nothing to do before 28 Dec).
-- The scheduled Claude session "Teton plan check (Claude, evening)" is switched off.
update public.planner_t_trips set review = true
 where trip_id in ('7e57bed0-0000-4000-8000-000000000003', '5e247891-d800-4d07-b5e0-8ad748ae2754');
do $$ begin
  if not exists (select 1 from cron.job where jobname = 't-review') then
    perform cron.schedule('t-review', '*/10 * * * *', 'select public.t_review_queue()');
  end if;
end $$;
