"""solver_light_terms rows computed straight from vantage_light (read-only), for dates whose light cache was pruned.
usage: light_sql.py <trip> <date> [cache] -> prints the SQL"""
import sys
trip, date = sys.argv[1], sys.argv[2]
cache = len(sys.argv) > 3
if cache:
    print(f"select stop_id, to_json(slot_at)#>>'{{}}' slot_at, dir, soft, blue, fog_wanted from solver_light_terms('{trip}', array['{date}'::date]) order by slot_at, stop_id")
else:
    print(f"""with z as (select solver_trip_tz('{trip}') tz)
select i.stop_id, to_json(x.slot_at)#>>'{{}}' slot_at,
       solver_light_dir(x.light, x.sun_alt, x.sun_visible, coalesce(i.light_wanted, '{{front,side}}')) dir,
       solver_light_soft(x.sun_alt, coalesce(i.light_wanted, '{{front,side}}')) soft,
       x.light = 'no sun' blue, i.fog_wanted
  from z, solver_stop_inputs i
  cross join lateral (select distinct on (l.local_time) (l.local_time at time zone z.tz) slot_at, l.sun_altitude::real sun_alt, l.light, l.sun_visible_from_vantage sun_visible
                        from vantage_light(i.star_vantage_id, '{date}'::date, 15, z.tz) l order by l.local_time) x
 where i.trip_id = '{trip}' and i.tier is not null and i.star_vantage_id is not null and x.sun_alt > -6
 order by x.slot_at, i.stop_id""")
