-- f8 (Phil, 8-9 Nov 2026): camera notes on every rated Grand Teton stop (info only, no itinerary change).
-- Teton Live gets them through training_sync. Re-running replaces the block (same marker).
with cam as (
  select code, name, lat, lng from webcam_cameras
   where code in ('GT-DORNANS','GT-MOOSE','GT-KELLY','GT-LOSTCREEK','GT-MORAN','GT-GOLF','GT-EGVB') and active),
st as (
  select s.id, s.lat, s.lng from stops s join days d on d.id = s.day_id join solver_stop_inputs i on i.stop_id = s.id
   where d.trip_id = '5e247891-d800-4d07-b5e0-8ad748ae2754' and i.tier is not null),
near as (
  select st.id, string_agg(c.name || ' (' || round((111.2 * sqrt(power(c.lat - st.lat, 2) + power((c.lng - st.lng) * cos(radians(st.lat)), 2)))::numeric) || ' km)', ', ' order by c.d) txt
    from st cross join lateral (
      select c.*, power(c.lat - st.lat, 2) + power((c.lng - st.lng) * cos(radians(st.lat)), 2) d from cam c order by 5 limit 2) c
   group by st.id),
note as (
  select st.id, E'\n\nCAMERAS TO CHECK (added 9 Nov 2026, Feeds page in the TEST app):\n'
    || '- Nearest valley views: ' || near.txt || '. These show the range as you would see it from the valley, valley fog included.'
    || case when st.lat > 43.8 then E'\n- Mount Moran from Hatchet Resort: the north end of the range, for this end of the park.' else '' end
    || E'\n- The Grand from the Idaho side (TetonCam Tetonia, Idaho side, Targhee summit): whether the summit is out. Valley fog on this side does not show there.'
    || E'\n- Resort ridge cameras (Rendezvous, summit, Cody Bowl, Teton lift): in cloud = the Grand is almost surely hidden. Clear says nothing about the Grand (the ridge is ~10,000 ft, the Grand 13,775 ft).' txt
  from st join near on near.id = st.id)
update stops s set info = regexp_replace(coalesce(s.info, ''), E'\n\nCAMERAS TO CHECK .*$', '', 's') || note.txt
  from note where s.id = note.id and s.id is not null

;
