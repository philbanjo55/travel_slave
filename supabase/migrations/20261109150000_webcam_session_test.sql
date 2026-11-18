-- Camera labels: side-by-side test, Claude session vs the paid API (worksheet c8, Phil 9 Nov 2026: "go
-- for it"). Nothing live changes: the API keeps labelling every camera, and the session's labels go to
-- their own table, never into webcam_frames. The session labels blind (it never reads the API's labels).
-- Scheduled task "Camera label test (Claude session vs API)" reads, each run, the newest API-labelled
-- daylight frame of every camera from the last 6 hours, labels it with the API's own rules and saves it
-- here. webcam_session_compare() reports how often the two agree, per camera (like the Haiku test, F1).

create table if not exists public.webcam_session_labels (
  frame_id uuid primary key references public.webcam_frames(id) on delete cascade,
  label text,
  hills_visible boolean,
  cloud_on_hills text,
  sea_visible boolean,
  rain_or_wet_lens boolean,
  sun_on_land boolean,
  label_confidence real,
  label_note text,
  camera_time_text text,
  created_at timestamptz not null default now()
);

-- One frame per camera: the newest API-labelled, non-stale daylight frame of the last 6 hours that the
-- session hasn't labelled yet. No label columns are returned.
create or replace function public.webcam_session_test_queue(p_n int default 30)
 returns table (frame_id uuid, camera_code text, camera_name text, region text, place text, hint text, captured_at timestamptz, storage_path text)
 language sql stable
 set search_path to 'public'
as $function$
  select q.id, q.camera_code, q.name, q.region, q.island, q.hint, q.captured_at, q.storage_path
    from (
      select distinct on (f.camera_code) f.id, f.camera_code, c.name, c.region, c.island, c.hint, f.captured_at, f.storage_path
        from webcam_frames f join webcam_cameras c on c.code = f.camera_code
       where c.active and f.storage_path is not null
         and f.label_model like 'claude-%' and f.label_model <> 'claude-session'
         and not coalesce(f.stale, false) and coalesce(f.sun_altitude, 0) > -6
         and f.fetched_at > now() - interval '6 hours'
         and not exists (select 1 from webcam_session_labels s where s.frame_id = f.id)
       order by f.camera_code, f.captured_at desc
    ) q
   order by q.camera_code
   limit p_n
$function$;

create or replace function public.webcam_session_test_label(p_frame uuid, p jsonb)
 returns void
 language sql
 set search_path to 'public'
as $function$
  insert into webcam_session_labels (frame_id, label, hills_visible, cloud_on_hills, sea_visible, rain_or_wet_lens,
                                     sun_on_land, label_confidence, label_note, camera_time_text)
  values (p_frame,
    case when p ->> 'label' in ('clear','haze','low_cloud','fog','dark','camera_problem') then p ->> 'label' end,
    (p ->> 'hills_visible')::boolean,
    case when p ->> 'cloud_on_hills' in ('none','above_hills','touching_tops','covering_hills','unknown') then p ->> 'cloud_on_hills' end,
    (p ->> 'sea_visible')::boolean,
    (p ->> 'rain_or_wet_lens')::boolean,
    (p ->> 'sun_on_land')::boolean,
    (p ->> 'confidence')::real,
    left(p ->> 'note', 500),
    nullif(left(trim(coalesce(p ->> 'camera_time', '')), 40), ''))
  on conflict (frame_id) do nothing
$function$;

-- Agreement per camera (and 'ALL'). Non-voting cameras keep the API's peaks / sun reading in
-- view_clear / view_sun (trigger webcam_frame_novote), so those are compared there.
-- hills_api_only = API says visible, session hidden; hills_session_only = the reverse.
create or replace function public.webcam_session_compare()
 returns table (camera_code text, n int, hills_agree_pct numeric, hills_api_only int, hills_session_only int,
                label_agree_pct numeric, cloud_agree_pct numeric, sun_agree_pct numeric, time_agree_pct numeric)
 language sql stable
 set search_path to 'public'
as $function$
  with j as (
    select f.camera_code,
           coalesce(f.hills_visible, f.view_clear) a_h, s.hills_visible s_h,
           f.label a_l, s.label s_l, f.cloud_on_hills a_c, s.cloud_on_hills s_c,
           coalesce(f.sun_on_land, f.view_sun) a_s, s.sun_on_land s_s,
           f.camera_time_text a_t, s.camera_time_text s_t
      from webcam_session_labels s join webcam_frames f on f.id = s.frame_id
  ), g as (
    select coalesce(camera_code, 'ALL') camera_code, count(*)::int n,
           round(100.0 * avg((a_h = s_h)::int), 0) hills_agree_pct,
           count(*) filter (where a_h and not s_h)::int hills_api_only,
           count(*) filter (where s_h and not a_h)::int hills_session_only,
           round(100.0 * avg((a_l = s_l)::int), 0) label_agree_pct,
           round(100.0 * avg((a_c = s_c)::int), 0) cloud_agree_pct,
           round(100.0 * avg((a_s = s_s)::int), 0) sun_agree_pct,
           round(100.0 * avg((coalesce(a_t, '') = coalesce(s_t, ''))::int), 0) time_agree_pct
      from j group by rollup (camera_code)
  )
  select * from g order by (camera_code = 'ALL') desc, camera_code
$function$;

revoke all on function public.webcam_session_test_queue(int) from public, anon, authenticated;
revoke all on function public.webcam_session_test_label(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.webcam_session_compare() from public, anon, authenticated;
