-- Day plans from the solver-plan edge function. Proposals only: nothing here
-- is applied to stops without an explicit apply step. Backend only (RLS on,
-- no policy) until the web viewer reads them.
create table public.solver_runs (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  build_id uuid references public.solver_score_builds(id) on delete set null,
  plan_date date not null,
  hotel_stop_id uuid references public.stops(id) on delete set null,
  params jsonb,
  stats jsonb,
  created_at timestamptz not null default now()
);
create index on public.solver_runs (trip_id, plan_date, created_at desc);

create table public.solver_plans (
  run_id uuid not null references public.solver_runs(id) on delete cascade,
  rank integer not null,
  objective real,          -- mean + 0.5 x CVaR, in tier points
  mean real,
  cvar11 real,             -- mean of the worst 11 of 51 members
  drive_minutes integer,
  visits jsonb not null,   -- [{stop_id, name, arrive, start, end, wait_min, drive_min, value_mean, p_good}]
  note text,
  primary key (run_id, rank)
);
