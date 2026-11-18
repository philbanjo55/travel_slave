-- Phil, 23 Oct 2026: "Save those as possible stops for future." The NPS ski
-- and snowshoe handout routes not yet on the Grand Teton trip, as idea stops:
-- no day (not in the itinerary, the apps or the planner), name "Idea: ...".
-- Coordinates are map estimates. Applied once via SQL (insert-if-missing).
insert into stops (trip_id, day_id, position, name, emoji, shot_type, lat, lng, info, time_locked, movable)
select '5e247891-d800-4d07-b5e0-8ad748ae2754'::uuid, null, 0, v.name, '⛷️', 'mountain', v.lat, v.lng,
       'IDEA (not scheduled), saved 23 Oct 2026 from the NPS ski and snowshoe handout (rev. 2/2017). ' || v.info, false, true
  from (values
    ('Idea: Phelps Lake Overlook (ski/snowshoe)', 43.6556, -110.7790, 'Moderate, 5.2 mi round trip, 730 ft climbing. Start: Moose-Wilson Road, 3 mi south of the Moose visitor center at the Death Canyon Road gate; park on the west side (map estimate, confirm).'),
    ('Idea: Phelps Lake (ski/snowshoe)', 43.6556, -110.7790, 'Moderate, 4.0 mi round trip, 300 ft climbing. Same start as Phelps Lake Overlook (Death Canyon Road gate on the Moose-Wilson Road).'),
    ('Idea: Moose-Wilson Road (ski)', 43.6220, -110.7960, 'Easy, 5.8 mi round trip, 500 ft climbing, on the closed road. Start from the Death Canyon Road gate, or from Granite Canyon Trailhead 1 mi into the park from Teton Village (map estimate, confirm).'),
    ('Idea: Taggart Lake-Beaver Creek Loop (ski/snowshoe)', 43.6930, -110.7330, 'Moderate to difficult, 4.0 mi loop, 500 ft climbing, steep glacial moraine hills. Start: Taggart Lake Trailhead. Longer version of the Day 5 Taggart Lake out-and-back (3.0 mi, 400 ft).'),
    ('Idea: Signal Mountain Summit Road (ski/snowshoe)', 43.8400, -110.6130, 'Moderate to difficult, 12.0 mi round trip, 900 ft climbing. Start: north trailhead, park next to Signal Mountain Lodge, 3 mi south of Jackson Lake Junction (map estimate, confirm). Summit view over Jackson Lake and the range.'),
    ('Idea: Swan Lake-Heron Pond Loop (ski/snowshoe)', 43.9020, -110.6420, 'Easy, 3.0 mi loop, 300 ft climbing; can extend south toward Hermitage Point. Start: Hermitage Point Trailhead, park in front of the closed Colter Bay Visitor Center (map estimate, confirm). Pairs with the Day 4 Colter Bay stop.'),
    ('Idea: Polecat Creek Loop, Flagg Ranch (ski/snowshoe)', 44.1060, -110.6690, 'Easy, 2.5 mi loop, 80 ft climbing. Start: Flagg Ranch, 2 mi south of Yellowstone (42 mi north of Moose), park in front of Headwaters Lodge (map estimate, confirm).'),
    ('Idea: North/South Flagg Canyon, Flagg Ranch (ski/snowshoe)', 44.1060, -110.6690, 'North Flagg Canyon: moderate to difficult, 4.0 mi round trip, 500 ft; avoid cornices where the trail follows the cliff edge above the Snake River; return via the snowmobile trail for a loop. South Flagg Canyon: easy, 4.2 mi round trip, 200 ft. Start: Flagg Ranch, park in front of Headwaters Lodge.')
  ) v(name, lat, lng, info)
 where not exists (select 1 from stops x where x.trip_id = '5e247891-d800-4d07-b5e0-8ad748ae2754' and x.name = v.name);
