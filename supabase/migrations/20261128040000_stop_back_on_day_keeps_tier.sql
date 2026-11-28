-- Rating lost on a stop put back on a day (Phil, 28 Nov 2026, Teton Live: Snake River Overlook 7:15 AM said "Not rated:
-- the planner skips it"). training_sync clears the tier of a set-aside stop (day_id null). An Accept on 27 Nov
-- (solver_applies 1008a057) put 5 such entries back on days, and nothing gave them their tier back, so T skipped them
-- and the stop page said not rated. Fix: when a stop goes from no day to a day and has no tier, it takes the tier of
-- another visit of the same place in the trip (stop_place_key) that has one. Plus the 5 stops repaired now.
create or replace function stop_back_on_day_tier() returns trigger
language plpgsql security definer set search_path to 'public' as $f$
declare v_tier text;
begin
  if old.day_id is null and new.day_id is not null then
    select ss2.tier into v_tier
      from solver_stop_settings ss2 join stops o on o.id = ss2.stop_id
     where o.trip_id = new.trip_id and o.id <> new.id and o.day_id is not null and ss2.tier is not null
       and stop_place_key(o.id) = stop_place_key(new.id)
     order by o.updated_at desc nulls last limit 1;
    if v_tier is not null then
      update solver_stop_settings set tier = v_tier, updated_at = now() where stop_id = new.id and tier is null;
    end if;
  end if;
  return new;
end $f$;
revoke all on function stop_back_on_day_tier() from public, anon, authenticated;
create trigger stop_back_on_day_tier after update of day_id on stops
  for each row when (old.day_id is null and new.day_id is not null) execute function stop_back_on_day_tier();

update solver_stop_settings ss set tier = x.tier, updated_at = now()
  from (select s.id, (select ss2.tier from solver_stop_settings ss2 join stops o on o.id = ss2.stop_id
                       where o.trip_id = s.trip_id and o.id <> s.id and o.day_id is not null and ss2.tier is not null
                         and stop_place_key(o.id) = stop_place_key(s.id) limit 1) tier
          from stops s join solver_stop_settings t on t.stop_id = s.id
         where s.day_id is not null and t.tier is null
           and exists (select 1 from solver_applies a where a.trip_id = s.trip_id and a.undone_at is null
                        and exists (select 1 from jsonb_array_elements(a.before) b where (b->>'id')::uuid = s.id and b->>'day_id' is null))) x
 where ss.stop_id = x.id and x.tier is not null and ss.tier is null;
