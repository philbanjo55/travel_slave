-- 7 Nov 2026 (Phil: "make Taggart and Bradley one stop, they're connected"): one ski outing, one stop,
-- like the Colter Bay -> Swan Lake merge (27 Oct). Taggart Lake becomes "Taggart & Bradley Lakes"
-- (6:30 AM, 210 + 190 = 400 min, tier A, once-only, no keep-together key), Bradley's info appended and
-- its shot added to the merged stop as an extra shot (Taggart's stays starred). Bradley Lake is set aside
-- (day_id null, tier null; nothing deleted). The Teton Live copy follows through training_sync.
-- Applied after the mfix56 / walkf56 bench tests finished (they read the trip's settings).
do $m$
declare v_t uuid := 'f42654fa-0bc4-49a1-b45d-612be84d6259'; v_b uuid := '4d506ef3-2878-4725-80f3-2996766171c0';
        v_binfo text; v_pos int;
begin
  select info into v_binfo from stops where id = v_b;
  update stops set name = 'Taggart & Bradley Lakes', duration_minutes = 400,
         info = coalesce(info, '') || E'\n\nBradley Lake (out and back from Taggart): ' || coalesce(v_binfo, '')
   where id = v_t and name = 'Taggart Lake';
  update solver_stop_settings set together = null, once = true, tier = 'A' where stop_id = v_t;
  select coalesce(max(position), 0) + 1 into v_pos from stop_sun_pairs where stop_id = v_t;
  insert into stop_sun_pairs (stop_id, vantage_id, position)
  select v_t, vantage_id, v_pos from stop_sun_pairs where stop_id = v_b
     and vantage_id not in (select vantage_id from stop_sun_pairs where stop_id = v_t);
  update stops set day_id = null where id = v_b;
  update solver_stop_settings set tier = null, together = null where stop_id = v_b;
end $m$;
