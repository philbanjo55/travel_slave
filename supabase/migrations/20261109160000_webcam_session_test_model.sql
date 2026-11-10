-- Camera label test on Opus (Phil, 9 Nov 2026: "I want opus"). The first run (20:14 UTC 9 Nov, 23 frames)
-- ran on the scheduled session's default model, Sonnet; those rows are tagged and kept out of the main
-- comparison. From the next run the task is pinned to claude-opus-5-5, the API labeller's model.
alter table public.webcam_session_labels add column if not exists model text;
drop function if exists public.webcam_session_compare();
update public.webcam_session_labels set model = 'claude-sonnet-5-5' where model is null and created_at < '2026-11-09 20:30+00';
alter table public.webcam_session_labels alter column model set default 'claude-opus-5-5';

create or replace function public.webcam_session_compare(p_model text default 'claude-opus-5-5')
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
     where s.model = p_model
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
revoke all on function public.webcam_session_compare(text) from public, anon, authenticated;
