-- Claude spend guard. Every Claude API call logs its tokens and cost here;
-- callers check claude_spend_month() first and stop at their monthly cap
-- (webcam-archive: CLAUDE_MONTHLY_CAP_USD, default 40). Phil's budget is
-- under $50/month for all Claude use.
create table if not exists public.claude_usage (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  fn text not null,                 -- calling edge function
  purpose text,                     -- e.g. webcam_label
  model text,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cost_usd numeric(10,5) not null default 0
);
create index if not exists claude_usage_at on public.claude_usage (at);

-- Spend since the start of this UTC month.
create or replace function public.claude_spend_month()
returns numeric language sql stable as $$
  select coalesce(sum(cost_usd), 0) from public.claude_usage
   where at >= date_trunc('month', now() at time zone 'UTC') at time zone 'UTC';
$$;

-- What was spent before logging existed (20 Oct 2026: first label, 23-frame
-- backfill, F-23 relabel), from the function responses.
insert into public.claude_usage (at, fn, purpose, model, input_tokens, output_tokens, cost_usd)
values ('2026-10-20 20:45+00', 'webcam-archive', 'webcam_label (before logging)', 'claude-opus-5-5', 36600, 3560, 0.2176);
