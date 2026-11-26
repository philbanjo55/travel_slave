-- 26 Nov 2026 (Phil: "Just make Menor's Ferry and Chapel one stop ... them being connected is annoying me"): one stop,
-- like Taggart & Bradley (7 Nov). The Chapel becomes "Chapel of the Transfiguration & Menor's Ferry" (10:15 AM,
-- 60 + 5 walk + 30 = 95 min, tier C), Menor's Ferry's info appended and its two shots (M1, M2) added to the merged stop.
-- Menor's Ferry is set aside (day_id null, tier null; nothing deleted: its photo stays on it and still shows on the
-- merged stop through the shared photo group). The Teton Live copy follows through training_sync.
do $m$
declare v_c uuid := '177d6283-e0d0-453d-8501-c859d274cf0c'; v_m uuid := '9f0314bf-bede-4915-8974-b392472b2363';
        v_minfo text; v_pos int;
begin
  select info into v_minfo from stops where id = v_m;
  update stops set name = 'Chapel of the Transfiguration & Menor''s Ferry', duration_minutes = 95,
         info = coalesce(info, '') || E'\n\nMENOR''S FERRY (merged into this stop 26 Nov 2026, same walk-in): ' || coalesce(v_minfo, '')
   where id = v_c and name = 'Chapel of the Transfiguration';
  select coalesce(max(position), 0) + 1 into v_pos from stop_sun_pairs where stop_id = v_c;
  insert into stop_sun_pairs (stop_id, vantage_id, position)
  select v_c, vantage_id, v_pos + position from stop_sun_pairs where stop_id = v_m
     and vantage_id not in (select vantage_id from stop_sun_pairs where stop_id = v_c);
  update stops set day_id = null where id = v_m;
  update solver_stop_settings set tier = null, together = null where stop_id = v_m;
end $m$;
