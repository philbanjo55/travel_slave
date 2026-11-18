-- Disk IO fix (21 Oct 2026). The nightly solver-plan job called
-- solver_trip_tz() once per solver_scores row (thousands of calls). While the
-- Faroe trip had no timezone, each call fell back to reading the raw blob of
-- every forecast row for the trip: the job hit the 2-minute statement timeout
-- (no nightly plans on 20 Oct) and burned the Disk IO budget.
-- 1. The fallback now reads the newest 20 forecast rows only.
-- 2. The cron job looks the time zone up once per trip.

create or replace function public.solver_trip_tz(p_trip_id uuid)
 returns text language plpgsql stable set search_path to 'public'
as $function$
declare tz text;
begin
  select t.timezone into tz from trips t where t.id = p_trip_id;
  if not found then return null; end if;
  if tz is not null then
    begin perform now() at time zone tz; return tz; exception when others then null; end;
  end if;
  select x.tz into tz from (
    select f.raw->'provenance'->>'timezone' as tz
      from weather_forecasts f join stops s on s.id = f.stop_id
     where s.trip_id = p_trip_id
     order by f.fetched_at desc limit 20) x
   where x.tz is not null limit 1;
  if tz is not null then
    begin perform now() at time zone tz; return tz; exception when others then null; end;
  end if;
  return 'UTC';
end $function$;

select cron.schedule('solver-plan', '55 22 * * *', $cmd$
  select net.http_post(
    url := 'https://ohshrzlvvxyovcjmdajc.supabase.co/functions/v1/solver-plan',
    body := q.body, headers := '{"Content-Type":"application/json"}'::jsonb, timeout_milliseconds := 1000)
  from (
    -- time zone looked up once per trip (it was called per score row: thousands of calls)
    with b as (
      select distinct on (sb.trip_id) sb.id, sb.trip_id, public.solver_trip_tz(sb.trip_id) as tz
        from public.solver_score_builds sb
        join public.trips t on t.id = sb.trip_id and t.archived is not true
       order by sb.trip_id, sb.built_at desc),
    d as (
      select distinct b.trip_id, (s.slot_at at time zone b.tz)::date::text as d
        from b join public.solver_scores s on s.build_id = b.id)
    select jsonb_build_object('trip_id', d.trip_id, 'date', d.d) as body from d
    union all
    select jsonb_build_object('trip_id', b.trip_id,
             'days', (select jsonb_agg(jsonb_build_object('date', x.d) order by x.d)
                        from (select d.d from d where d.trip_id = b.trip_id order by 1 limit 3) x))
      from b
  ) q;
$cmd$);
