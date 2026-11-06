-- Worksheet G1 (Phil, 6 Nov 2026): Claude planning past test nights with the solver as a tool
-- (edge function claude-planner). One row per (run, night, model): Claude's plan and T's, both graded
-- against what happened, nothing shot before.
create table if not exists claude_pilot (
  id bigserial primary key, run_id bigint not null, night int not null, kind text not null default 'mrmc',
  model text not null, status text not null default 'running', claude_plan jsonb, claude_realized real,
  t_plan jsonb, t_realized real, solver_best_realized real, calls int, cost_usd real, note text, transcript jsonb,
  created_at timestamptz default now(), done_at timestamptz);
create index if not exists claude_pilot_run on claude_pilot (run_id, night);
alter table claude_pilot add column if not exists variant text not null default 'base';
alter table claude_pilot add column if not exists audit jsonb, add column if not exists solver_pol_realized real, add column if not exists required jsonb;
