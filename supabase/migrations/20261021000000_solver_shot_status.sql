-- Shot status per stop (Phil, 20 Oct 2026): one check mark, three states.
--   null      not shot: the planner values it in full
--   'got'     shot, could be better: a return visit is worth only the
--             improvement over shot_value (V 0..1 of the conditions at the time)
--   'nailed'  done: the planner stops suggesting it
-- Set from chat for now, later from a tick in the TEST app. Removing the tick
-- (status null) makes the stop worth its full value again.

alter table public.solver_stop_settings
  add column shot_status text check (shot_status in ('got', 'nailed')),
  add column shot_value real check (shot_value between 0 and 1),
  add column shot_at timestamptz;

create or replace view public.solver_stop_inputs with (security_invoker = true) as
select s.id as stop_id, s.trip_id, s.day_id, d.date, s.position, s.name, s.shot_type,
       s.duration_minutes, s.lat, s.lng,
       ss.tier,
       case ss.tier when 'GOD' then 10 when 'S' then 5 when 'A' then 2
                    when 'B' then 1 when 'C' then 1 when 'D' then 0.5 else 0 end::numeric as tier_weight,
       coalesce(ss.star_vantage_id,
                (select p.vantage_id from public.stop_sun_pairs p
                  where p.stop_id = s.id order by p.position, p.created_at limit 1)) as star_vantage_id,
       ss.star_vantage_id is null as star_is_default,
       ss.light_wanted,
       s.shot_type = 'waterfall' as rain_bonus,
       coalesce(ss.time_locked, false) as time_locked,
       coalesce(ss.source, 'unset') as source,
       coalesce(ss.fog_wanted, false) as fog_wanted,
       ss.shot_status,
       ss.shot_value,
       ss.shot_at
  from public.stops s
  left join public.days d on d.id = s.day_id
  left join public.solver_stop_settings ss on ss.stop_id = s.id;

-- Mark a stop shot. p_at: when it was shot; the conditions then (mean V of
-- the starred shot over the stop's duration, from the newest score build that
-- covers that time) become the baseline. No score for that time: 0.5.
-- p_status null clears the tick.
create or replace function public.solver_mark_shot(p_stop_id uuid, p_status text, p_at timestamptz default null,
                                                   p_value real default null)
returns jsonb language plpgsql set search_path to 'public' as $$
declare
  v real := p_value;
  dur integer;
begin
  if p_status is not null and p_status not in ('got', 'nailed') then
    raise exception 'status must be got, nailed or null';
  end if;
  if p_status = 'got' and v is null and p_at is not null then
    select coalesce(duration_minutes, 60) into dur from stops where id = p_stop_id;
    select max(x.m) into v from (
      select s.slot_at, (select avg(e) from unnest(s.v) e) / 250.0 as m
        from solver_scores s
       where s.stop_id = p_stop_id
         and s.build_id = (select s2.build_id from solver_scores s2 join solver_score_builds b on b.id = s2.build_id
                            where s2.stop_id = p_stop_id and s2.slot_at between p_at - interval '15 minutes' and p_at + interval '15 minutes'
                            order by b.built_at desc limit 1)
         and s.slot_at >= p_at - interval '7 minutes' and s.slot_at < p_at + make_interval(mins => dur)) x;
  end if;
  insert into solver_stop_settings (stop_id, source, shot_status, shot_value, shot_at)
  values (p_stop_id, 'phil', p_status,
          case when p_status = 'got' then coalesce(v, 0.5) end,
          case when p_status is not null then coalesce(p_at, now()) end)
  on conflict (stop_id) do update
    set shot_status = excluded.shot_status, shot_value = excluded.shot_value, shot_at = excluded.shot_at;
  return (select jsonb_build_object('stop_id', stop_id, 'shot_status', shot_status, 'shot_value', shot_value, 'shot_at', shot_at)
            from solver_stop_settings where stop_id = p_stop_id);
end $$;
revoke execute on function public.solver_mark_shot(uuid, text, timestamptz, real) from public, anon, authenticated;
