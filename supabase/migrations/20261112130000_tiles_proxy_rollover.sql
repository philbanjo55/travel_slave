-- HD 3D sun view: our own daily limit with rollover, and the limits kept in the database (Phil, 12 Nov 2026:
-- "the daily cap is also managed on our end ... the days that we don't use it adds to the rest of the allowance
-- ... make sure that it actually resets on the 1st of the month").
-- Today's allowance = what is left of the month's cap (default 900; Google's free allowance is 1,000) shared over
-- the days left in the month, never above day_ceiling (default 32 = the quota set on the Google key).
-- Days and months are US Pacific time; a new month starts from zero because only this month's days are summed.
-- Applied live as tiles_proxy_rollover (functions: see the database; this file records the change).
alter table public.tiles_proxy_switch add column if not exists day_ceiling integer not null default 32;
alter table public.tiles_proxy_switch add column if not exists month_cap integer not null default 900;
-- tiles_proxy_settings() -> {enabled, day_ceiling, month_cap}
-- tiles_proxy_allowance(day_ceiling, month_cap, day default today) -> {day, month, day_used, month_used, days_left,
--   day_cap (today's allowance), day_ceiling, month_cap, resets_on}
-- tiles_proxy_take_root(day_ceiling, month_cap) -> the same plus ok / reason ('day' | 'month'); takes one when ok.

CREATE OR REPLACE FUNCTION public.tiles_proxy_allowance(p_day_cap integer, p_month_cap integer, p_day date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with d as (select coalesce(p_day, (now() at time zone 'America/Los_Angeles')::date) as day),
       m as (select d.day, date_trunc('month', d.day)::date as first_day,
                    (date_trunc('month', d.day) + interval '1 month')::date as next_month from d),
       u as (select m.*,
                    coalesce((select roots from tiles_proxy_days t where t.day = m.day), 0) as day_used,
                    coalesce((select sum(roots) from tiles_proxy_days t where t.day >= m.first_day and t.day < m.day), 0)::integer as used_before
               from m)
  select jsonb_build_object(
           'day', day, 'month', to_char(day, 'YYYY-MM'),
           'day_used', day_used, 'month_used', used_before + day_used,
           'days_left', next_month - day,
           'day_cap', greatest(0, least(p_day_cap, ceil(greatest(0, p_month_cap - used_before)::numeric / (next_month - day))::integer)),
           'day_ceiling', p_day_cap, 'month_cap', p_month_cap, 'resets_on', next_month)
    from u;
$function$
;

CREATE OR REPLACE FUNCTION public.tiles_proxy_settings()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select coalesce((select jsonb_build_object('enabled', enabled, 'day_ceiling', day_ceiling, 'month_cap', month_cap)
                     from tiles_proxy_switch where id),
                  jsonb_build_object('enabled', false, 'day_ceiling', 32, 'month_cap', 900));
$function$
;

CREATE OR REPLACE FUNCTION public.tiles_proxy_take_root(p_day_cap integer, p_month_cap integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_day date := (now() at time zone 'America/Los_Angeles')::date;
  a jsonb;
  v_why text;
begin
  insert into tiles_proxy_days (day) values (v_day) on conflict (day) do nothing;
  perform 1 from tiles_proxy_days where day = v_day for update;
  a := tiles_proxy_allowance(p_day_cap, p_month_cap, v_day);
  if (a->>'month_used')::int >= p_month_cap then v_why := 'month';
  elsif (a->>'day_used')::int >= (a->>'day_cap')::int then v_why := 'day';
  end if;
  if v_why is null then
    update tiles_proxy_days set roots = roots + 1, updated_at = now() where day = v_day;
    a := tiles_proxy_allowance(p_day_cap, p_month_cap, v_day);
  else
    update tiles_proxy_days set refused = refused + 1, updated_at = now() where day = v_day;
  end if;
  return a || jsonb_build_object('ok', v_why is null, 'reason', v_why);
end $function$
;

revoke all on function public.tiles_proxy_settings() from public, anon, authenticated;
revoke all on function public.tiles_proxy_allowance(integer, integer, date) from public, anon, authenticated;
revoke all on function public.tiles_proxy_take_root(integer, integer) from public, anon, authenticated;
grant execute on function public.tiles_proxy_settings() to service_role;
grant execute on function public.tiles_proxy_allowance(integer, integer, date) to service_role;
grant execute on function public.tiles_proxy_take_root(integer, integer) to service_role;
