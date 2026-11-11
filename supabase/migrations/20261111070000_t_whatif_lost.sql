-- Tell T what-if: what a note costs is counted against the same days planned without it.
CREATE OR REPLACE FUNCTION public.planner_t_whatif_result(p_a bigint, p_b bigint, p_keep boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v jsonb;
begin
  if not exists (select 1 from replay_runs where id in (p_a, p_b) and status like 'whatif%' having count(*) = 2) then
    return jsonb_build_object('ok', false, 'error', 'not a what-if pair');
  end if;
  with va as (select d.trip_date, x ->> 'name' as name from replay_run_days d, jsonb_array_elements(d.visits) x
               where d.run_id = p_a and not coalesce((x ->> 'booked')::boolean, false)),
       vb as (select d.trip_date, x ->> 'name' as name from replay_run_days d, jsonb_array_elements(d.visits) x
               where d.run_id = p_b and not coalesce((x ->> 'booked')::boolean, false)),
       nb as (select d.trip_date, d.stats -> 'notes' as n, d.stats ->> 'error' as err from replay_run_days d where d.run_id = p_b)
  select jsonb_build_object('ok', true,
    'days', (select count(*) from replay_run_days where run_id = p_b),
    'dropped', coalesce((select jsonb_agg(distinct name) from va where name not in (select name from vb)), '[]'::jsonb),
    'added', coalesce((select jsonb_agg(distinct name) from vb where name not in (select name from va)), '[]'::jsonb),
    -- lost: a place the noted plan leaves out on its last possible day, counted only when the plan without the note
    -- had it (11 Nov 2026: "what if we skip Jenny Lake" blamed the note for four outings the week was losing anyway).
    'lost', coalesce((select jsonb_agg(distinct t) from nb, jsonb_array_elements_text(coalesce(nb.n -> 'lost', '[]'::jsonb)) t
                       where t in (select name from va)), '[]'::jsonb),
    'cannot', coalesce((select jsonb_agg(distinct jsonb_build_object('date', nb.trip_date, 'what', t)) from nb, jsonb_array_elements_text(coalesce(nb.n -> 'broken', '[]'::jsonb)) t), '[]'::jsonb),
    'no_route', coalesce((select jsonb_agg(nb.trip_date) from nb where nb.err is not null), '[]'::jsonb),
    'by_day', coalesce((select jsonb_object_agg(td, jsonb_build_object('before', b4, 'after', af)) from (
        select coalesce(a.trip_date, b.trip_date)::text td, coalesce(a.names, '[]'::jsonb) b4, coalesce(b.names, '[]'::jsonb) af
          from (select trip_date, jsonb_agg(name) names from va group by 1) a
          full join (select trip_date, jsonb_agg(name) names from vb group by 1) b using (trip_date)
         where a.names is distinct from b.names) z), '{}'::jsonb))
    into v;
  if not p_keep then
    delete from replay_run_days where run_id in (p_a, p_b);
    delete from replay_run_state where run_id in (p_a, p_b);
    delete from replay_runs where id in (p_a, p_b) and status like 'whatif%';
  end if;
  return v;
end $function$;
