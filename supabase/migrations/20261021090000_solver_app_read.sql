-- The TEST app's Planner reads plans and stop settings directly (read only).
-- Same exposure as stops/days, which the app already reads with the
-- publishable key. Writes (ticks, labels, apply, re-plan) go through the
-- solver-actions edge function; webcam frames come from it as signed URLs.
create policy app_read on public.solver_runs for select to anon, authenticated using (true);
create policy app_read on public.solver_plans for select to anon, authenticated using (true);
create policy app_read on public.solver_stop_settings for select to anon, authenticated using (true);
