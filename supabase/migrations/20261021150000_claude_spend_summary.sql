-- This month's Claude spend for the TEST app (Planner and the Weather Updated
-- alert). Security definer so the app can read the total without a policy on
-- claude_usage; it returns only totals. cap_usd mirrors the edge functions'
-- CLAUDE_MONTHLY_CAP_USD default.
create or replace function public.claude_spend_summary()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'month_usd', round(coalesce(sum(cost_usd), 0), 2),
    'cap_usd', 40,
    'calls', count(*),
    'today_usd', round(coalesce(sum(cost_usd) filter (where at >= date_trunc('day', now())), 0), 2),
    'last_at', max(at))
  from public.claude_usage
  where at >= date_trunc('month', now() at time zone 'UTC') at time zone 'UTC';
$$;
revoke all on function public.claude_spend_summary() from public;
grant execute on function public.claude_spend_summary() to anon, authenticated;
