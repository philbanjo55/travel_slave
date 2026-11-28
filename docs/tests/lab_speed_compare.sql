with d as (select l.tag, l.trip_id, l.variant, rd.night, md5(rd.visits::text) h, rd.predicted
           from lab_speed_runs l join replay_run_days rd on rd.run_id = l.run_id and rd.kind = 'mrmc' where l.tag = '__TAG__')
select left(trip_id::text, 8) t, count(distinct night) nights,
       count(*) filter (where a.h is not distinct from b.h and a.h is not distinct from c.h) as all_same,
       count(*) filter (where a.h is distinct from a2) as a_vs_a2_diff,
       count(*) filter (where a.h is distinct from b.h) as a_vs_b_diff
from (select trip_id, night, max(h) filter (where variant='A') h, max(h) filter (where variant='A2') a2 from d group by 1,2) a
join lateral (select max(h) filter (where variant='B') h from d where d.trip_id=a.trip_id and d.night=a.night) b on true
join lateral (select max(h) filter (where variant='A2') h from d where d.trip_id=a.trip_id and d.night=a.night) c on true
group by trip_id order by 1
