-- Camera labels by a scheduled Claude session instead of the paid API (Phil, 9 Nov 2026: "same with
-- the picture stuff too", for the cameras that aren't time-critical). label_by 'session': the hourly
-- webcam-archive still saves the picture (label_paused = true, so no API call) and the scheduled task
-- "Camera labels (Claude session)" labels the unread daylight frames every 3 hours with the same rules,
-- label_model 'claude-session'. Moved now: the 8 Faroes cameras being read (F-23-1, F-41, F-42, F-33,
-- F-12, F-38, F-21, F-43) and the two resort ridge cameras that don't vote (GT-JHMR-CODYBOWL,
-- GT-JHMR-TETONLIFT). The Teton voting cameras stay on the API: the live camera look and Re-plan now
-- wait at most 15 / 4 minutes for their labels.
alter table public.webcam_cameras add column if not exists label_by text not null default 'api';
update public.webcam_cameras set label_by = 'session', label_paused = true
 where code in ('F-23-1','F-41','F-42','F-33','F-12','F-38','F-21','F-43','GT-JHMR-CODYBOWL','GT-JHMR-TETONLIFT');

-- Unread daylight frames of session cameras from the last 2 days, oldest first.
create or replace function public.webcam_session_queue(p_n int default 40)
 returns table (frame_id uuid, camera_code text, camera_name text, region text, place text, hint text, captured_at timestamptz, storage_path text)
 language sql stable
 set search_path to 'public'
as $function$
  select f.id, f.camera_code, c.name, c.region, c.island, c.hint, f.captured_at, f.storage_path
    from webcam_frames f join webcam_cameras c on c.code = f.camera_code
   where c.label_by = 'session' and c.active and f.label_model is null and f.storage_path is not null
     and not coalesce(f.stale, false) and coalesce(f.sun_altitude, 0) > -6
     and f.fetched_at > now() - interval '2 days'
   order by f.captured_at
   limit p_n
$function$;

-- Write one label (same columns as webcam-archive's labelColumns), label_model 'claude-session'.
create or replace function public.webcam_session_label(p_frame uuid, p jsonb)
 returns void
 language sql
 set search_path to 'public'
as $function$
  update webcam_frames set
    label = case when p ->> 'label' in ('clear','haze','low_cloud','fog','dark','camera_problem') then p ->> 'label' end,
    hills_visible = (p ->> 'hills_visible')::boolean,
    cloud_on_hills = case when p ->> 'cloud_on_hills' in ('none','above_hills','touching_tops','covering_hills','unknown') then p ->> 'cloud_on_hills' end,
    sea_visible = (p ->> 'sea_visible')::boolean,
    rain_or_wet_lens = (p ->> 'rain_or_wet_lens')::boolean,
    sun_on_land = (p ->> 'sun_on_land')::boolean,
    label_confidence = (p ->> 'confidence')::real,
    label_note = left(p ->> 'note', 500),
    camera_time_text = nullif(left(trim(coalesce(p ->> 'camera_time', '')), 40), ''),
    label_model = 'claude-session',
    label_error = null
  where id = p_frame
$function$;

revoke all on function public.webcam_session_queue(int) from public, anon, authenticated;
revoke all on function public.webcam_session_label(uuid, jsonb) from public, anon, authenticated;
