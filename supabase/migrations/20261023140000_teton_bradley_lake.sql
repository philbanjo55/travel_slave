-- Phil, 23 Oct 2026: add the Bradley Lake out-and-back to the Day 5 Taggart
-- Lake morning (real trip and Teton Live). Own stop after Taggart (placeholder
-- 10:00 AM, 2 h, same lot), one vantage at the east shore aimed at the Grand
-- (map estimates), suggested tier B, morning front light.
do $$
declare r record; st uuid; subj uuid; vt uuid;
begin
  for r in select * from (values
      ('5e247891-d800-4d07-b5e0-8ad748ae2754'::uuid, 'a9719a71-29c8-4d78-99ea-bd973bac7c97'::uuid, '63c6bed6-6fb1-4863-bca1-5471e29faf51'::uuid),
      ('7e57bed0-0000-4000-8000-000000000003'::uuid, '3c0a0177-fe0a-49e1-a9f5-68696f3eceba'::uuid, '110f4442-ce3e-4f03-ad84-acea1618346a'::uuid)) t(trip, day, sleep) loop
    if exists (select 1 from stops where day_id = r.day and name = 'Bradley Lake (out and back from Taggart)') then continue; end if;
    update stops set position = 3 where id = r.sleep;
    insert into stops (day_id, trip_id, position, name, emoji, time_label, duration_minutes, drive_override_minutes, lat, lng, shot_type, info, time_locked, movable)
    values (r.day, r.trip, 2, 'Bradley Lake (out and back from Taggart)', '👣', '10:00 AM', 120, 0, 43.6930, -110.7330, 'mountain',
      '[B] · MOVABLE · Same lot as Taggart Lake (end of plowing): https://www.google.com/maps?q=43.6930,-110.7330' || E'\n' ||
      'ROUTE: from Taggart Lake keep going north on the trail over the moraine to Bradley Lake (NPS handout map: about 0.7 mi from the junction by Taggart Lake), then back the same way to Taggart and the lot. Adds roughly 1.5 to 2 mi and a steep moraine climb; unmarked in winter, snowshoes easier than skis here.' || E'\n' ||
      'Bradley Lake sits at the mouth of Garnet Canyon, right under the range. East shore is the starting viewpoint (map estimate, confirm). Time is a placeholder after Taggart.',
      false, true)
    returning id into st;
    insert into scout_subjects (trip_id, name, lat, lng, coord_confidence, notes, status)
    values (r.trip, 'Bradley Lake: peaks above', 43.7412, -110.8024, 'estimate', 'Aimed at the Grand Teton summit from Bradley Lake (Claude, 23 Oct 2026)', 'active')
    returning id into subj;
    insert into scout_vantages (subject_id, code, name, shot_name, lat, lng, coord_confidence, notes)
    values (subj, 'BL1', 'east shore', 'east shore', 43.7165, -110.7440, 'estimate', 'Map estimate (Claude, 23 Oct 2026)')
    returning id into vt;
    insert into stop_sun_pairs (stop_id, vantage_id, position) values (st, vt, 0);
    insert into solver_stop_settings (stop_id, tier, star_vantage_id, light_wanted, time_locked, source, note)
    values (st, 'B', vt, '{front}', false, 'suggested', 'Added with Phil''s Day 5 Bradley Lake out and back, 23 Oct 2026');
  end loop;
end $$;
