-- F-23 looks down the road: the lower two thirds are road and a rock cutting,
-- the top third is sky and the view toward Sørvágsvatn (Phil, 20 Oct 2026).
-- Its first Claude labels called that a camera problem; they are cleared so
-- the backfill relabels them with this hint.
update public.webcam_cameras
   set hint = 'Near Sørvágsvatn on Vágar. The lower two thirds of the frame are road and a rock cutting; the top third shows the sky and the view toward the lake and hills. Judge the weather from that top third only. This framing is normal for this camera, not a camera problem.'
 where code = 'F-23';

update public.webcam_frames
   set label = null, hills_visible = null, cloud_on_hills = null, sea_visible = null, rain_or_wet_lens = null,
       sun_on_land = null, label_confidence = null, label_note = null, label_model = null, label_error = null
 where camera_code = 'F-23' and label_model like 'claude%';
