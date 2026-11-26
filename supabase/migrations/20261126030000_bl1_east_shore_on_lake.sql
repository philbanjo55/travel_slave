-- Bradley Lake 'east shore' (BL1, Phil 26 Nov 2026: "seems way off the trail"): the 23 Oct map estimate sat on the
-- moraine ~450 m east of the lake and ~600 m from any trail. Moved to the lake's east end where the Valley Trail
-- meets it (lake surface 2139 m in the laser survey). Old values in pin_moves_20261113 (undo). Light cache cleared.
-- Applied by hand on 26 Nov 2026; this file is the record.
insert into pin_moves_20261113 (vantage_id, fix, old_lat, old_lng, old_subject, new_lat, new_lng, new_subject, at)
select v.id, 'BL1 east shore moved onto the lake shore (Phil 26 Nov 2026)', v.lat, v.lng, v.subject_id, 43.7145, -110.7497, v.subject_id, now()
  from scout_vantages v
 where v.id in ('22375bad-2214-424b-916a-97806818dd9c', 'bc73f0b3-01e1-4cff-bf3c-937e53413fd8') and v.lat <> 43.7145;
update scout_vantages set lat = 43.7145, lng = -110.7497, terrain_profile_id = null, updated_at = now(),
       notes = 'Moved 26 Nov 2026 to the lake''s east end on the Valley Trail. Was a map estimate on the moraine 450 m east (Claude, 23 Oct 2026).'
 where id in ('22375bad-2214-424b-916a-97806818dd9c', 'bc73f0b3-01e1-4cff-bf3c-937e53413fd8') and lat <> 43.7145;
