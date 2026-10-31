-- T in the TEST app (Phil, 31 Oct 2026: T only, on the Teton Live practice trip first).
-- A live T run on the practice trip itself (its own dates 1-6 Nov, its own stop copies),
-- with run config publish = true: solver-replay v48 writes its evening plan and its
-- morning re-plan to solver_runs / solver_plans (stats.planner 'T'), which the app reads.
-- The practice trip shares the main trip's place (KJAC, the Teton forecast cell), so its
-- replay_places row and the hidden-peaks / morning count tables (the fits are views over them) are copied from the main trip.

create or replace function public.replay_copy_place(p_from uuid, p_to uuid)
returns jsonb language plpgsql set search_path to 'public' as $$
declare t text; sel text; ins text; n int; out jsonb := '{}';
begin
  foreach t in array array['replay_places', 'replay_hidden_counts', 'replay_morning_counts'] loop
    select string_agg(case when c.column_name = 'trip_id' then quote_literal(p_to) || '::uuid' else quote_ident(c.column_name) end, ', ' order by c.ordinal_position),
           string_agg(quote_ident(c.column_name), ', ' order by c.ordinal_position)
      into sel, ins
      from information_schema.columns c where c.table_schema = 'public' and c.table_name = t
       and c.is_identity = 'NO' and c.is_generated = 'NEVER';
    execute format('insert into %I (%s) select %s from %I where trip_id = %L on conflict do nothing', t, ins, sel, t, p_from);
    get diagnostics n = row_count;
    out := out || jsonb_build_object(t, n);
  end loop;
  return out;
end $$;
revoke all on function public.replay_copy_place(uuid, uuid) from public, anon, authenticated;

select public.replay_copy_place('5e247891-d800-4d07-b5e0-8ad748ae2754', '7e57bed0-0000-4000-8000-000000000003');

-- The run: live_T's settings with the practice trip's stop copies and dates.
insert into replay_runs (trip_id, start_date, trip_dates, nights, config)
select '7e57bed0-0000-4000-8000-000000000003', date '2026-11-01',
       array['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06']::date[], 6,
       (x.config - 'name' - 'gear' - 'anchors_on' - 'fixed_days' - 'plan_local' - 'stagger_min') || jsonb_build_object(
         'name', 'app_T', 'publish', true, 'plan_local', '20:45', 'stagger_min', 6,
         'fixed_days', '["2026-10-31", "2026-11-06"]'::jsonb,
         'gear', jsonb_build_object(
           'stops', (select jsonb_agg(m.new_id) from jsonb_array_elements_text(x.config -> 'gear' -> 'stops') g(id)
                       join training_copy_map m on m.old_id::text = g.id and m.kind = 'stop' and m.trip_id = '7e57bed0-0000-4000-8000-000000000003'),
           'from', jsonb_build_object('date', '2026-11-01', 'time', x.config -> 'gear' -> 'from' ->> 'time'),
           'to', jsonb_build_object('date', '2026-11-05', 'time', x.config -> 'gear' -> 'to' ->> 'time')),
         'anchors_on', jsonb_build_array(
           jsonb_build_object('stop_id', (select new_id from training_copy_map where old_id = 'e8cd127e-cee8-4376-a8a2-7a4808513019' and kind = 'stop' and trip_id = '7e57bed0-0000-4000-8000-000000000003'), 'date', '2026-11-01'),
           jsonb_build_object('stop_id', (select new_id from training_copy_map where old_id = 'ad52beaf-9a1c-466d-94b7-9f469e207794' and kind = 'stop' and trip_id = '7e57bed0-0000-4000-8000-000000000003'), 'date', '2026-11-05')))
  from replay_runs x where x.config ->> 'name' = 'live_T' and coalesce((x.config ->> 'live')::boolean, false)
  order by x.start_date limit 1;

-- The weekly roll-over copies main-trip live runs only (the practice trip has its own dates).
do $$
declare d text; o text; n text;
begin
  d := pg_get_functiondef('public.replay_live_roll(date)'::regprocedure);
  o := $o$   where coalesce((x.config ->> 'live')::boolean, false) and x.status = 'done'$o$;
  n := $n$   where coalesce((x.config ->> 'live')::boolean, false) and x.status = 'done' and not coalesce((x.config ->> 'publish')::boolean, false)$n$;
  if position(o in d) = 0 then raise exception 'roll pattern not found'; end if;
  execute replace(d, o, n);
end $$;
