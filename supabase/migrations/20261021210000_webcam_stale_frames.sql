-- Stale webcam frames (Phil, 20 Oct 2026). A camera can stop updating and
-- keep serving its last picture (F-41 served its 16:25 image at 18:00 UTC),
-- so a frame's capture time is not always the time it shows. Two checks:
--   repeat image: same SHA-256 as an earlier frame of that camera (12 h);
--     webcam-archive then skips the Claude call too.
--   camera clock: the time printed on the image (read by Claude as
--     camera_time_text, camera-local) is more than 45 min from when we
--     fetched it.
-- Stale frames stay stored but are left out of the camera tiles, the
-- scoreboard (solver_verify_run) and the backtest (solver_backtest_run).

alter table public.webcam_cameras add column if not exists tz text not null default 'UTC';
update public.webcam_cameras set tz = 'Atlantic/Faroe' where region = 'Faroe Islands' and tz = 'UTC';

alter table public.webcam_frames add column if not exists image_sha256 text;
alter table public.webcam_frames add column if not exists fetched_at timestamptz;   -- when the image was downloaded
alter table public.webcam_frames add column if not exists camera_time_text text;    -- as printed, camera-local
alter table public.webcam_frames add column if not exists camera_time timestamptz;
alter table public.webcam_frames add column if not exists stale boolean not null default false;
alter table public.webcam_frames add column if not exists stale_reason text;

create or replace function public.webcam_frame_stale()
returns trigger language plpgsql set search_path = public as $$
declare v_tz text; v_ref timestamptz;
begin
  select tz into v_tz from webcam_cameras where code = new.camera_code;
  new.camera_time := null;
  if coalesce(new.camera_time_text, '') <> '' then
    begin
      new.camera_time := new.camera_time_text::timestamp at time zone coalesce(v_tz, 'UTC');
    exception when others then new.camera_time := null;
    end;
  end if;
  -- Captures run at :37 past the slot hour; older rows have no fetched_at.
  v_ref := coalesce(new.fetched_at, new.captured_at + interval '37 minutes');
  new.stale := false; new.stale_reason := null;
  if new.image_sha256 is not null and exists (
       select 1 from webcam_frames p
        where p.camera_code = new.camera_code and p.image_sha256 = new.image_sha256
          and p.captured_at < new.captured_at and p.captured_at > new.captured_at - interval '12 hours') then
    new.stale := true; new.stale_reason := 'repeat image';
  elsif new.camera_time is not null and abs(extract(epoch from v_ref - new.camera_time)) > 2700 then
    new.stale := true;
    new.stale_reason := 'camera clock ' || to_char(new.camera_time at time zone coalesce(v_tz, 'UTC'), 'HH24:MI');
  end if;
  return new;
end $$;

create or replace trigger webcam_frame_stale before insert or update of image_sha256, camera_time_text, fetched_at
  on public.webcam_frames for each row execute function public.webcam_frame_stale();

-- Scoreboard and backtest: stale frames are no truth.
do $do$
declare d text; n text;
begin
  d := pg_get_functiondef('public.solver_verify_run'::regproc);
  n := replace(d,
$a$     where f.sun_altitude > 3 and f.edge_top is not null and f.captured_at > now() - interval '5 days'$a$,
$b$     where f.sun_altitude > 3 and f.edge_top is not null and f.captured_at > now() - interval '5 days' and not f.stale$b$);
  if n = d then raise exception 'solver_verify_run text not matched'; end if;
  execute n;

  d := pg_get_functiondef('public.solver_backtest_run(boolean)'::regprocedure);
  n := replace(d,
$a$      from webcam_frames f where f.sun_altitude > 3$a$,
$b$      from webcam_frames f where f.sun_altitude > 3 and not f.stale$b$);
  if n = d then raise exception 'solver_backtest_run text not matched'; end if;
  execute n;
end $do$;
