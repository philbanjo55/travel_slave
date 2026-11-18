-- Phil, 23 Oct 2026: save the ski/snowshoe routes with Teton views found
-- online as ideas (no day, not in the planner). Map-estimate coordinates.
insert into stops (trip_id, day_id, position, name, emoji, shot_type, lat, lng, info, time_locked, movable)
select '5e247891-d800-4d07-b5e0-8ad748ae2754'::uuid, null, 0, v.name, '⛷️', 'mountain', v.lat, v.lng,
       'IDEA (not scheduled), saved 23 Oct 2026 from local ski and snowshoe guides (JH Nordic Alliance, Jackson Hole Chamber); details vary between sources. ' || v.info, false, true
  from (values
    ('Idea: Lucas-Fabian Homestead (ski/snowshoe)', 43.712, -110.727, 'Easy to moderate, about 4 mi round trip from the Taggart Lake lot. Historic homestead with the range behind; by the Lucas-Fabian bridge on the Day 3 Jenny Lake route, so it can be a short detour that day (map estimate, confirm).'),
    ('Idea: Emily''s Pond Levee, Wilson (ski/snowshoe)', 43.495, -110.865, 'Easy and flat, 2 to 4.5 mi (sources disagree) on the Snake River levee at Wilson. River and cottonwoods in front, the south end of the Tetons behind (map estimate, confirm).'),
    ('Idea: Teton Pines Nordic Center (groomed)', 43.538, -110.824, 'About 16 km of groomed track, 4 mi south of Teton Village; probably a trail fee. Views of the south end of the range (map estimate, confirm).'),
    ('Idea: Shooting Star Nordic, Teton Village (groomed)', 43.580, -110.819, 'About 15 km of groomed track at Teton Village; may be members only, check before going (map estimate, confirm).')
  ) v(name, lat, lng, info)
 where not exists (select 1 from stops x where x.trip_id = '5e247891-d800-4d07-b5e0-8ad748ae2754' and x.name = v.name);
