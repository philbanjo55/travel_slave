-- Worksheet B5 (6 Nov 2026): EKVG METAR for 1-14 June 2024 and 2025 was never loaded, so 28 Faroes test days
-- had no truth and scored every hour as "peaks visible". June now loaded; their cached truth builds are rebuilt.
create temp table b5 as select b.id from replay_builds b join replay_days d on d.id = b.replay_day_id
 where d.trip_id = 'e04fbc9d-86b1-42b2-bf08-fc65a18e665d' and b.kind = 'truth'
   and ((d.replay_date between '2024-06-01' and '2024-06-14') or (d.replay_date between '2025-06-01' and '2025-06-14'));
delete from replay_scores_c where build_id in (select id from b5);
delete from replay_scores where build_id in (select id from b5);
delete from replay_builds where id in (select id from b5);
select count(*) from b5;
