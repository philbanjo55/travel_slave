-- Week audit (Phil, 28 Nov 2026: "if Cunningham cabin isn't there that's wrong right? We should make an audit system
-- ... that checks all are scheduled"). The week Accept would apply = for each day from today, T's newest day plan
-- (forecast plans before typical-light drafts, visits still ahead), exactly as solver_apply_week picks it. Every place
-- on your itinerary from today on that is rated and not marked Nailed must be in it at least once; the ones that are
-- not are returned with where they sit in your itinerary. Read only.
-- Found on Teton Live 28 Nov: Cunningham Cabin was in the 04:25 UTC week draft on Sat but not in Sat's 8:45 PM evening
-- plan; Accept takes Sat from the evening plan and the later days from the draft (which had it on Sat), so it fell out.
create or replace function t_week_audit(p_trip uuid) returns jsonb
language plpgsql stable security definer set search_path to 'public' as $f$
declare v_today date := (now() at time zone solver_trip_tz(p_trip))::date; v_planned text[]; v_missing jsonb;
begin
  select coalesce(array_agg(distinct lower(trim(v ->> 'name'))), '{}') into v_planned
    from days d
    cross join lateral (select p.visits from solver_runs sr join solver_plans p on p.run_id = sr.id and p.rank = 1
                         where sr.trip_id = p_trip and sr.stats ->> 'planner' = 'T' and sr.stats ->> 'kind' = 'day'
                           and sr.stats -> 'days' -> 0 ->> 'trip_date' = d.date::text
                         order by coalesce((sr.stats -> 'days' -> 0 ->> 'light_only')::boolean, false), sr.created_at desc
                         limit 1) x
    cross join lateral jsonb_array_elements(x.visits) v
   where d.trip_id = p_trip and d.date >= v_today and (v ->> 'start')::timestamptz > now();
  select coalesce(jsonb_agg(jsonb_build_object('place', m.name, 'tier', m.tier, 'your_days', m.days) order by m.name), '[]'::jsonb)
    into v_missing
    from (select min(s.name) as name, min(ss.tier) as tier, jsonb_agg(distinct d.date order by d.date) as days
            from stops s join days d on d.id = s.day_id join solver_stop_settings ss on ss.stop_id = s.id
           where s.trip_id = p_trip and d.date >= v_today and ss.tier is not null
             and ss.shot_status is distinct from 'nailed' and ss.star_vantage_id is not null
             and not coalesce(s.time_locked, false)
           group by lower(trim(s.name))
          having not (lower(trim(min(s.name))) = any(v_planned))) m;
  return jsonb_build_object('ok', jsonb_array_length(v_missing) = 0, 'missing', v_missing, 'today', v_today, 'at', now());
end $f$;
grant execute on function t_week_audit(uuid) to anon, authenticated;
