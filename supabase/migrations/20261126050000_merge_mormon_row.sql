-- 26 Nov 2026 (Phil: "pink house and all that should be one big stop"): the Day 4 morning on Mormon Row becomes one
-- stop, like the Chapel & Menor's Ferry merge the same day. T.A. Moulton Barn becomes
-- "Mormon Row: Moulton Barns + Pink House": pin at the Antelope Flats parking (end of plowing, where the morning
-- starts on snowshoes), 6:25 AM, 245 min (snowshoe in 40 + T.A. Moulton 150 + John Moulton / Pink House 40 incl. the
-- walk back = 6:25 to 10:30, as the three stops were), tier GOD, its starred shot kept, the keep-together key dropped
-- (one stop now). The access notes (Antelope Flats) go first, then T.A. Moulton's, then John Moulton's; every shot of
-- the three is on the big stop. Antelope Flats — Snowshoe In and John Moulton Barn + Pink House are set aside
-- (day_id null, tier null; nothing deleted). The Teton Live copy follows through training_sync.
do $m$
declare v_ta uuid := '8200fc29-f054-481f-bdae-5a1031a1d703'; v_jm uuid := 'cd94b8ce-8b9e-46e7-979b-50d2c241dcf0';
        v_af uuid := '1461c7aa-06d0-468a-85e2-ff1d16806ca4'; v_af_info text; v_jm_info text; v_pos int;
begin
  select info into v_af_info from stops where id = v_af;
  select info into v_jm_info from stops where id = v_jm;
  update stops set name = 'Mormon Row: Moulton Barns + Pink House', lat = 43.6665, lng = -110.681,
         time_label = '6:25 AM', duration_minutes = 245, drive_override_minutes = null,
         info = E'ACCESS (snowshoe in from Antelope Flats): ' || coalesce(v_af_info, '') || E'\n\nT.A. MOULTON BARN\n' || coalesce(info, '')
                || E'\n\nJOHN MOULTON BARN + PINK HOUSE\n' || coalesce(v_jm_info, '')
   where id = v_ta and name = 'T.A. Moulton Barn';
  update solver_stop_settings set together = null where stop_id = v_ta;
  select coalesce(max(position), 0) + 1 into v_pos from stop_sun_pairs where stop_id = v_ta;
  insert into stop_sun_pairs (stop_id, vantage_id, position)
  select distinct on (vantage_id) v_ta, vantage_id, v_pos + position from stop_sun_pairs where stop_id in (v_jm, v_af)
     and vantage_id not in (select vantage_id from stop_sun_pairs where stop_id = v_ta)
   order by vantage_id, position;
  update stops set day_id = null where id in (v_jm, v_af);
  update solver_stop_settings set tier = null, together = null where stop_id in (v_jm, v_af);
end $m$;
