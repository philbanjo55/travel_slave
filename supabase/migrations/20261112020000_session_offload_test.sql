-- Offload test, step 1 (Phil, 11 Nov 2026: "Yes", test only until it is proven): Claude sessions on Opus 5.5 do the
-- nightly plan check and read the whole day's Teton camera pictures, side by side with the paid API. Everything here
-- is new and separate: nothing the app, T or the paid functions read is touched.
--  webcam_session_night_queue(part, parts, n): the last day's API-read daylight pictures of the cameras still on the
--    paid reading, not yet read by a session. part -1 = whatever is left (the sweep). Returns no labels (blind).
--  t_review_tests: the session's plan check, kept apart from t_reviews (the app shows the paid one).
create or replace function public.webcam_session_night_queue(p_part integer default -1, p_parts integer default 4, p_n integer default 45)
 returns table(frame_id uuid, camera_code text, camera_name text, region text, place text, hint text, captured_at timestamp with time zone, storage_path text)
 language sql stable set search_path to 'public'
as $function$
  select f.id, f.camera_code, c.name, c.region, c.island, c.hint, f.captured_at, f.storage_path
    from webcam_frames f join webcam_cameras c on c.code = f.camera_code
   where c.active and not coalesce(c.label_paused, false) and f.storage_path is not null
     and f.label_model like 'claude-%' and f.label_model <> 'claude-session'
     and not coalesce(f.stale, false) and coalesce(f.sun_altitude, 0) > -6
     and f.fetched_at > now() - interval '22 hours'
     and not exists (select 1 from webcam_session_labels s where s.frame_id = f.id)
     and (p_part < 0 or abs(hashtext(f.id::text)) % greatest(p_parts, 1) = p_part)
   order by f.captured_at, f.camera_code
   limit p_n
$function$;
revoke all on function public.webcam_session_night_queue(integer, integer, integer) from public, anon, authenticated;

create table if not exists public.t_review_tests (
  id bigint generated always as identity primary key,
  trip_id uuid not null, run_id uuid not null unique, plan_date date, note text,
  verdict text, summary text, flags jsonb, checks jsonb, minutes numeric, created_at timestamptz not null default now());
