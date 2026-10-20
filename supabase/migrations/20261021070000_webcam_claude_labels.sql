-- Webcam labels from Claude (webcam-archive), plus Phil's own taps kept apart
-- so the two can be compared. sun_altitude now comes from the archive itself
-- (it was only set by the CLIP labeller); older frames are backfilled here.
alter table public.webcam_frames
  add column sun_on_land boolean,
  add column phil_label text check (phil_label in ('clear', 'cloud_on_hills', 'fog', 'cant_tell')),
  add column phil_labeled_at timestamptz;

update public.webcam_frames f
   set sun_altitude = (select sp.altitude from public.sun_position(f.captured_at, c.lat, c.lng) sp)
  from public.webcam_cameras c
 where c.code = f.camera_code and f.sun_altitude is null and c.lat is not null;

-- Scoreboard truth for "hills hidden": Phil's tap, else Claude's label, else
-- the top-half edge heuristic.
do $do$ begin
  execute replace(pg_get_functiondef('public.solver_verify_run'::regproc),
    $old$case when f.label_model = 'phil' and f.hills_visible is not null then not f.hills_visible
                when b.n >= 5 then f.edge_top < 0.5 * b.clear_edge end as hidden$old$,
    $new$case when f.phil_label in ('clear', 'cloud_on_hills', 'fog') then f.phil_label <> 'clear'
                when f.phil_label = 'cant_tell' then null
                when f.label_model like 'claude%' and f.label not in ('dark', 'camera_problem')
                     and f.hills_visible is not null then not f.hills_visible
                when b.n >= 5 then f.edge_top < 0.5 * b.clear_edge end as hidden$new$);
end $do$;
