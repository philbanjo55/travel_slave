-- Prove "live" is live (Phil, 3 Nov 2026). Four of the five Teton cameras print no clock, so a
-- frozen picture was caught only when the exact same bytes came back. webcam-archive v16 now
-- stores the camera's own time from the source: the server's Last-Modified (NPS Kelly) or the
-- capture time in the final image address after redirects (Roundshot panoramas; it was missed
-- because fetch follows their redirect itself), plus the ETag (YouTube's Moose thumbnail has no
-- time, only a version tag: recorded, not yet used). The stale trigger also flags a frame whose
-- source time is over 45 min older than the fetch.
alter table public.webcam_frames add column if not exists source_time timestamptz;
alter table public.webcam_frames add column if not exists source_etag text;

create or replace function public.webcam_frame_stale()
returns trigger language plpgsql set search_path to 'public' as $function$
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
  elsif new.source_time is not null and extract(epoch from v_ref - new.source_time) > 2700 then
    new.stale := true;
    new.stale_reason := 'source time ' || to_char(new.source_time at time zone coalesce(v_tz, 'UTC'), 'HH24:MI');
  end if;
  return new;
end $function$;
