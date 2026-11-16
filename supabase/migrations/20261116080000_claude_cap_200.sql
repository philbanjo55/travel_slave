-- Phil, 16 Nov 2026: one overall Claude limit of $200 a month (his plan's API credit); per-feature caps raised to 200 (secrets set the same day). The app's spend line said 'of $40' (stale).
CREATE OR REPLACE FUNCTION public.claude_spend_summary()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object(
    'month_usd', round(coalesce(sum(cost_usd), 0), 2),
    'cap_usd', 200,
    'calls', count(*),
    'today_usd', round(coalesce(sum(cost_usd) filter (where at >= date_trunc('day', now())), 0), 2),
    'last_at', max(at))
  from public.claude_usage
  where at >= date_trunc('month', now() at time zone 'UTC') at time zone 'UTC';
$function$

;
