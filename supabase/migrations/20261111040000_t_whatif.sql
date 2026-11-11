-- Tell T: what a note would cost, before Phil's OK (worksheet g4, "a warning before you confirm").
-- The rest of the trip (from tomorrow) is planned twice from light only, as the week draft is: once as things stand
-- (a) and once with the note's rules added (b). Both are plain bench runs with status 'whatif' (the scheduler never
-- touches them; edge function t-notes drives them step by step), run config whatif = nothing is published.
-- planner_t_whatif_result compares them (places that drop out of the week, places with no day left, what the note
-- asks that cannot be done) and removes both runs. t_notes.cost keeps the answer for the app.
alter table public.t_notes add column if not exists cost jsonb;

-- Only for trips with notes switched on (planner_t_trips config tell): the planner must be the note-aware version,
-- an older one would publish these runs as week drafts. p_force is for tests against a local planner.
drop function if exists public.planner_t_whatif_start(uuid, jsonb);
create or replace function public.planner_t_whatif_start(p_trip uuid, p_rules jsonb, p_force boolean default false)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_cfg jsonb; v_tz text; v_dates date[]; v_a bigint; v_b bigint; v_base jsonb; d date;
begin
  select config into v_cfg from planner_t_trips where trip_id = p_trip;
  if v_cfg is null then return jsonb_build_object('ok', false, 'error', 'T does not plan this trip'); end if;
  if not p_force and not coalesce((v_cfg ->> 'tell')::boolean, false) then return jsonb_build_object('ok', false, 'error', 'notes are not switched on for this trip'); end if;
  select coalesce(timezone, 'UTC') into v_tz from trips where id = p_trip;
  v_dates := array(select dd.date from days dd where dd.trip_id = p_trip and dd.date > (now() at time zone v_tz)::date order by dd.date);
  if coalesce(cardinality(v_dates), 0) = 0 then return jsonb_build_object('ok', false, 'error', 'no later days'); end if;
  v_base := v_cfg || jsonb_build_object('name', 'whatif_T', 'draft', true, 'live', true, 'publish', true, 'whatif', true, 'tell', true,
                                        'fc_days', 0, 'kinds', '["mrmc"]'::jsonb, 'made', now());
  insert into replay_runs (trip_id, start_date, trip_dates, nights, config, status)
  values (p_trip, v_dates[1], v_dates, cardinality(v_dates), v_base, 'whatif') returning id into v_a;
  insert into replay_runs (trip_id, start_date, trip_dates, nights, config, status)
  values (p_trip, v_dates[1], v_dates, cardinality(v_dates),
          v_base || jsonb_build_object('notes', coalesce(v_cfg -> 'notes', '[]'::jsonb) || coalesce(p_rules, '[]'::jsonb)), 'whatif') returning id into v_b;
  insert into replay_run_state (run_id, kind, night, state, sets) values (v_a, 'mrmc', 0, '{}'::jsonb, '{"seen": []}'::jsonb), (v_b, 'mrmc', 0, '{}'::jsonb, '{"seen": []}'::jsonb);
  foreach d in array v_dates loop
    insert into replay_days (trip_id, replay_date, trip_date) values (p_trip, d, d) on conflict do nothing;
  end loop;
  return jsonb_build_object('ok', true, 'a', v_a, 'b', v_b, 'nights', cardinality(v_dates));
end $$;

-- After each planner step: the run moves on to the night its plan state has reached.
create or replace function public.planner_t_whatif_step(p_run bigint)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare s record; r record;
begin
  select * into r from replay_runs where id = p_run and status in ('whatif', 'whatif_done');
  if r.id is null then return jsonb_build_object('ok', false, 'error', 'not a what-if run'); end if;
  select * into s from replay_run_state where run_id = p_run and kind = 'mrmc';
  if s.status = 'idle' and s.night > r.night then
    update replay_runs set night = s.night, status = case when s.night >= r.nights then 'whatif_done' else status end, updated_at = now() where id = p_run;
  end if;
  return jsonb_build_object('ok', true, 'night', greatest(s.night, r.night), 'nights', r.nights, 'done', s.night >= r.nights, 'state', s.status, 'note', left(s.note, 200));
end $$;

create or replace function public.planner_t_whatif_result(p_a bigint, p_b bigint, p_keep boolean default false)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
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
    'lost', coalesce((select jsonb_agg(distinct t) from nb, jsonb_array_elements_text(coalesce(nb.n -> 'lost', '[]'::jsonb)) t), '[]'::jsonb),
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
end $$;
revoke all on function public.planner_t_whatif_start(uuid, jsonb, boolean) from public, anon, authenticated;
revoke all on function public.planner_t_whatif_step(bigint) from public, anon, authenticated;
revoke all on function public.planner_t_whatif_result(bigint, bigint, boolean) from public, anon, authenticated;
