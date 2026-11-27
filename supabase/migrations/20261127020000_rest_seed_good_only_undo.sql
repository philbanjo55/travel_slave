-- Undo of 20261127010000 (Phil, 27 Nov 2026: discuss first). planner_t_rest_seed back as it was.
CREATE OR REPLACE FUNCTION public.planner_t_rest_seed(p_trip uuid, p_date date, p_at timestamp with time zone DEFAULT now(), p_asof timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with r as (
    select r.id, r.params ->> 'step' step from solver_runs r
     where r.trip_id = p_trip and r.plan_date = p_date and r.params ->> 'planner' = 'T'
       and r.params ->> 'step' in ('night', 'morning', 'early', 'now') and r.created_at <= p_asof
     order by r.created_at desc limit 1),
  v as (
    select x ->> 'stop_id' stop_id, max(round(250 * (x ->> 'value')::numeric))::int val
      from r join solver_plans p on p.run_id = r.id and p.rank = 1
     cross join jsonb_array_elements(p.visits) x
     where x ->> 'value' is not null and not coalesce((x ->> 'done')::boolean, false)
       and (x ->> 'end')::timestamptz > p_at
     group by 1)
  select jsonb_build_object('plan', (select id from r), 'step', (select step from r),
                            'state', coalesce((select jsonb_object_agg(stop_id, val) from v), '{}'::jsonb),
                            'seen', coalesce((select jsonb_agg(stop_id order by stop_id) from v), '[]'::jsonb),
                            'n', (select count(*) from v))
$function$
;
