-- Planner test bench, upgrade #5 (Phil, 27 Oct 2026): fit "peaks hidden" on the
-- same truth the bench scores with. replay_fit_hidden used the airport alone
-- (replay_hidden_obs: KJAC ceiling < 7000 ft, visibility, fog), but visits are
-- scored against replay_hidden_truth = the airport OR the place's camera
-- (TetonCam history labels). Over the two Teton winters (1,164 daylight hours)
-- the peaks were hidden 62% of hours, the airport says 47%, and the old fit
-- expected 46%. Leave-one-winter-out Brier (mean of the day-1 models):
-- climatology 0.235, airport-trained 0.201, truth-trained 0.173 (both winters
-- better: 0.218 -> 0.174 and 0.184 -> 0.171). Places without a truth camera
-- (truth_cam null, the Faroes) are unchanged: truth = the airport there.
create or replace function public.replay_fit_hidden()
 returns integer
 language plpgsql
 set search_path to 'public', 'extensions'
as $function$
declare n int;
begin
  truncate replay_hidden_counts;
  insert into replay_hidden_counts (trip_id, season, model, bin, n, hits)
  with hrs as (
    select distinct p.trip_id, o.hr, o.hidden
      from replay_places p
      join replay_hidden_truth o on o.trip_id = p.trip_id
      join metar_stations s on s.icao = p.station
     where exists (select 1 from replay_wx_day w where w.point_key = p.fc_point and w.day = (o.hr at time zone 'UTC')::date)
       and (select sp.altitude from sun_position(o.hr, s.lat, s.lng) sp) > 0
  )
  select h.trip_id, replay_season((h.hr at time zone 'UTC')::date), w.model,
         replay_cloud_bin(w.cloud[extract(hour from h.hr at time zone 'UTC')::int + 1]), count(*), sum(h.hidden)
    from hrs h
    join replay_places p on p.trip_id = h.trip_id
    join replay_wx_day w on w.point_key = p.fc_point and w.day = (h.hr at time zone 'UTC')::date
   where w.cloud[extract(hour from h.hr at time zone 'UTC')::int + 1] is not null
     and not exists (select 1 from replay_model_dups d where d.point_key = w.point_key and d.model = w.model and d.day = w.day)
   group by 1, 2, 3, 4;
  get diagnostics n = row_count;
  return n;
end $function$;

select public.replay_fit_hidden();
update public.replay_places set fitted_at = now() where trip_id is not null;
