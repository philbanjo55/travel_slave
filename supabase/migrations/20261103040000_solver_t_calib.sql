-- T2 (Phil, 3 Nov 2026: "can it be trusted"): calibrated chance of a good shot per visit.
-- p_good (share of 6-8 forecasts good) said 0% for visits that came good 7-23% of the time
-- and ~21% for ones that came good about half the time. The mean value is well calibrated, so
-- chance = 1 / (1 + exp(-(a + b * value))), one (a, b) per region, fitted on graded visits.
-- solver-replay reads this table (constant fallback if empty). solver_t_fit_calib refits it from
-- bench runs plus Phil's own grades in solver_t_feedback (the Missed it / Go back / Nailed it hook).

create table if not exists public.solver_t_calib (
  region text primary key,          -- 'teton' (lat <= 55) or 'faroes' (lat > 55)
  a real not null,
  b real not null,
  n int not null,
  n_live int not null default 0,
  brier real,
  fitted_at timestamptz not null default now(),
  note text
);
alter table public.solver_t_calib enable row level security;

-- Phil's grade of a planned stop after the day (the app's ticks): nailed = it came good,
-- missed or go_back = it did not. value is the plan's value for that visit (0..1).
create table if not exists public.solver_t_feedback (
  id bigserial primary key,
  trip_id uuid,
  stop_id uuid not null,
  visit_date date not null,
  value real not null,
  outcome text not null check (outcome in ('nailed', 'go_back', 'missed')),
  region text not null,
  created_at timestamptz not null default now(),
  unique (stop_id, visit_date)
);
alter table public.solver_t_feedback enable row level security;

insert into public.solver_t_calib (region, a, b, n, brier, note) values
  ('teton', -4.530, 8.157, 2380, 0.094, 'bench T (mrmc) winters + Oct 2026, 3 Nov 2026'),
  ('faroes', -3.695, 7.918, 1830, 0.158, 'bench T (mrmc) Faroes Mays 2024-26, 3 Nov 2026')
on conflict (region) do nothing;

-- Logistic fit by Newton steps. p_runs: bench replay_runs ids whose graded visits (truth) to use;
-- live grades for the region are added with weight p_live_w each.
create or replace function public.solver_t_fit_calib(p_region text, p_runs bigint[], p_kind text default 'mrmc', p_live_w real default 3)
returns jsonb language plpgsql set search_path to 'public' as $$
declare a double precision := -4; b double precision := 8; it int; g0 double precision; g1 double precision;
        h00 double precision; h01 double precision; h11 double precision; det double precision; n int; nl int; br double precision;
        xs float8[]; ys float8[]; ws float8[];
begin
  with c as (
    select (v->>'value')::float8 x, case when (v->>'truth')::float8 >= 0.6 then 1 else 0 end::float8 y, 1::float8 w
      from replay_run_days d, jsonb_array_elements(d.visits) v
     where d.run_id = any(p_runs) and d.kind = p_kind and v ? 'truth' and v ? 'value'
       and coalesce((v->>'booked')::boolean, false) = false
    union all
    select value, case when outcome = 'nailed' then 1 else 0 end, p_live_w from solver_t_feedback where region = p_region)
  select array_agg(x), array_agg(y), array_agg(w), count(*) filter (where w = 1), count(*) filter (where w <> 1)
    into xs, ys, ws, n, nl from c;
  if coalesce(n, 0) + coalesce(nl, 0) < 50 then raise exception 'too few graded visits (%)', coalesce(n, 0) + coalesce(nl, 0); end if;
  for it in 1..30 loop
    select sum(w * (y - p)), sum(w * (y - p) * x), sum(w * p * (1 - p)), sum(w * p * (1 - p) * x), sum(w * p * (1 - p) * x * x)
      into g0, g1, h00, h01, h11
      from (select x, y, w, 1 / (1 + exp(-(a + b * x))) p from unnest(xs, ys, ws) u(x, y, w)) s;
    det := h00 * h11 - h01 * h01;
    exit when det = 0;
    a := a + (h11 * g0 - h01 * g1) / det;
    b := b + (h00 * g1 - h01 * g0) / det;
    exit when abs(g0) + abs(g1) < 1e-6;
  end loop;
  select sum(w * power(1 / (1 + exp(-(a + b * x))) - y, 2)) / sum(w) into br from unnest(xs, ys, ws) u(x, y, w);
  insert into solver_t_calib (region, a, b, n, n_live, brier, fitted_at, note)
  values (p_region, a, b, n, nl, br, now(), 'refit from ' || cardinality(p_runs) || ' runs')
  on conflict (region) do update set a = excluded.a, b = excluded.b, n = excluded.n, n_live = excluded.n_live,
    brier = excluded.brier, fitted_at = excluded.fitted_at, note = excluded.note;
  return jsonb_build_object('region', p_region, 'a', round(a::numeric, 3), 'b', round(b::numeric, 3), 'n', n, 'n_live', nl, 'brier', round(br::numeric, 4));
end $$;
