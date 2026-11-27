-- Minutes driven beyond an hour on single legs (the planner's long-leg cost).
alter table public.solver_plans add column long_leg_minutes integer;
