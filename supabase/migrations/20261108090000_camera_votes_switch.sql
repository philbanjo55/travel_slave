-- 8 Nov 2026 (Phil: read the two high resort cameras for cloud): a camera can be read
-- without voting on whether the peaks are visible. webcam_cameras.votes = false moves
-- Claude's "hills visible" and "sun on land" for that camera's pictures into view_clear /
-- view_sun and leaves hills_visible / sun_on_land null, so every reader of the peaks
-- (t_truth, replay_hidden_vote, replay_hidden_truth, t_day_check, solver_verify_run,
-- solver_backtest_run, solver_fit_calibration_live) skips them; label, cloud_on_hills and
-- the note stay (label set = the hourly backfill does not read the picture again).
alter table webcam_cameras add column if not exists votes boolean not null default true;
alter table webcam_frames add column if not exists view_clear boolean;
alter table webcam_frames add column if not exists view_sun boolean;

create or replace function webcam_frame_novote() returns trigger language plpgsql as $f$
begin
  if (new.hills_visible is not null or new.sun_on_land is not null)
     and exists (select 1 from webcam_cameras c where c.code = new.camera_code and not c.votes) then
    new.view_clear := coalesce(new.hills_visible, new.view_clear);
    new.view_sun := coalesce(new.sun_on_land, new.view_sun);
    new.hills_visible := null;
    new.sun_on_land := null;
  end if;
  return new;
end $f$;

create trigger webcam_frame_novote before insert or update of hills_visible, sun_on_land
  on webcam_frames for each row execute function webcam_frame_novote();

update webcam_cameras set votes = false, label_paused = false
 where code in ('GT-JHMR-CODYBOWL', 'GT-JHMR-TETONLIFT');
