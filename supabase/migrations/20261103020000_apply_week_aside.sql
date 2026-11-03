-- Whole-week Accept, part 2: accepting T's week also sets aside the rated stops of the
-- accepted days that T's week leaves out (they stayed and clashed: Teton Live 3 Nov, Taggart
-- ran 4 h into Swan Lake). Set aside = off the day only (day_id null); the tier stays, so T
-- can still plan the place later. Unrated stops (hotel, gear, Phil's own extras), booked and
-- frozen stops stay. Only when solver_apply_week asks (setting solver.aside_unplanned = on).
do $$
declare d text; o1 text; n1 text; o2 text; n2 text; o3 text; n3 text; u text;
begin
  d := pg_get_functiondef('public.solver_apply_plan(uuid,integer,boolean)'::regprocedure);
  u := $u$(v_aside_unplanned and not s.time_locked and not s.is_new and s.day_id in (select day_id from _ap2_visit)
            and s.id not in (select entry from _ap2_visit)
            and exists (select 1 from solver_stop_settings x where x.stop_id = s.id and x.tier is not null and x.tier <> 'F'))$u$;
  o1 := $o$  r record; v_entry uuid; v_frozen timestamptz;$o$;
  n1 := $n$  r record; v_entry uuid; v_frozen timestamptz; v_aside_unplanned boolean := coalesce(current_setting('solver.aside_unplanned', true), '') = 'on';$n$;
  o2 := $o$     where s.id not in (select entry from _ap2_visit)
       and not (not s.time_locked and s.place in (select place from _ap2_visit))$o$;
  n2 := o2 || E'\n       and not ' || u;
  o3 := $o$   where s.day_id is not null and not s.time_locked and not s.is_new
     and s.place in (select place from _ap2_visit) and s.id not in (select entry from _ap2_visit);$o$;
  n3 := $n$   where (s.day_id is not null and not s.time_locked and not s.is_new
     and s.place in (select place from _ap2_visit) and s.id not in (select entry from _ap2_visit))
      or $n$ || u || ';';
  if position(o1 in d) = 0 then raise exception 'declare not found'; end if;
  if position(o2 in d) = 0 then raise exception 'staying not found'; end if;
  if position(o3 in d) = 0 then raise exception 'aside not found'; end if;
  execute replace(replace(replace(d, o1, n1), o2, n2), o3, n3);

  d := pg_get_functiondef('public.solver_apply_week(uuid,boolean)'::regprocedure);
  o1 := $o$  perform set_config('solver.frozen_after', v_now::text, true);$o$;
  n1 := $n$  perform set_config('solver.frozen_after', v_now::text, true);
  perform set_config('solver.aside_unplanned', 'on', true);$n$;
  o2 := $o$  perform set_config('solver.frozen_after', '', true);$o$;
  n2 := $n$  perform set_config('solver.frozen_after', '', true);
  perform set_config('solver.aside_unplanned', '', true);$n$;
  if position(o1 in d) = 0 or position(o2 in d) = 0 then raise exception 'week settings not found'; end if;
  execute replace(replace(d, o1, n1), o2, n2);
end $$;
