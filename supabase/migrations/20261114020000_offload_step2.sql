-- Offload step 2 (Phil, 14 Nov 2026: "Yes"): the nightly Claude sessions read the Teton camera
-- pictures; the paid reader (webcam-archive v24) reads only the hours the planner needs within
-- minutes; a 06:00 UTC backup reads anything still unread; the evening plan check is done by a
-- session first and by the paid t-review only if no check exists 75 min after the plan.
-- Switch back: update webcam_cameras set label_by = 'api' where label_by = 'session'.

-- 1. The hours the paid reader must read now (webcam-archive asks this on every run).
create or replace function public.webcam_paid_slots()
returns timestamptz[]
language sql stable security definer
set search_path to 'public', 'extensions'
as $$
  with runs as (
    select r.trip_id, (now() at time zone coalesce(t.timezone, 'UTC'))::date d, r.start_date, r.nights
      from replay_runs r join trips t on t.id = r.trip_id
     where r.status = 'running' and coalesce((r.config ->> 'live')::boolean, false)
       and coalesce((r.config ->> 'publish')::boolean, false) and not coalesce((r.config ->> 'draft')::boolean, false)
       and coalesce((r.config ->> 'early')::boolean, false)
  ), slots as (
    -- the camera look after sunrise reads the pictures of its own hour
    select date_trunc('hour', replay_early_at(trip_id, d)) s from runs
     where d between start_date and start_date + nights - 1
    union
    -- Re-plan now (button, notes about today, "I'm at X", sky notes) reads this hour, else the hour before
    select date_trunc('hour', now()) where exists (select 1 from planner_t_now
      where status in ('queued', 'planning') or requested_at > now() - interval '15 minutes')
    union
    select date_trunc('hour', now()) - interval '1 hour' where exists (select 1 from planner_t_now
      where status in ('queued', 'planning') or requested_at > now() - interval '15 minutes')
  )
  select coalesce(array_agg(distinct s), '{}') from slots where s is not null
$$;
revoke all on function public.webcam_paid_slots() from public, anon, authenticated;

-- 2. The nightly sessions' queue, in parts (4 sessions read at once).
create or replace function public.webcam_session_queue(p_part integer, p_parts integer, p_n integer default 45)
returns table(frame_id uuid, camera_code text, camera_name text, region text, place text, hint text,
              captured_at timestamptz, storage_path text)
language sql stable
set search_path to 'public'
as $$
  select f.id, f.camera_code, c.name, c.region, c.island, c.hint, f.captured_at, f.storage_path
    from webcam_frames f join webcam_cameras c on c.code = f.camera_code
   where c.label_by = 'session' and c.active and not coalesce(c.label_paused, false)
     and f.label is null and f.label_model is null and f.storage_path is not null
     and not coalesce(f.stale, false) and coalesce(f.sun_altitude, 0) > -6
     and f.fetched_at > now() - interval '2 days'
     and (p_part < 0 or abs(hashtext(f.id::text)) % greatest(p_parts, 1) = p_part)
   order by f.captured_at, f.camera_code
   limit p_n
$$;

-- 3. A session's reading keeps a time taken from the file name (TetonCam) and never writes over a
--    picture someone has already read.
create or replace function public.webcam_session_label(p_frame uuid, p jsonb)
returns void
language sql
set search_path to 'public'
as $$
  update webcam_frames set
    label = case when p ->> 'label' in ('clear','haze','low_cloud','fog','dark','camera_problem') then p ->> 'label' end,
    hills_visible = (p ->> 'hills_visible')::boolean,
    cloud_on_hills = case when p ->> 'cloud_on_hills' in ('none','above_hills','touching_tops','covering_hills','unknown') then p ->> 'cloud_on_hills' end,
    sea_visible = (p ->> 'sea_visible')::boolean,
    rain_or_wet_lens = (p ->> 'rain_or_wet_lens')::boolean,
    sun_on_land = (p ->> 'sun_on_land')::boolean,
    label_confidence = (p ->> 'confidence')::real,
    label_note = left(p ->> 'note', 500),
    camera_time_text = coalesce(camera_time_text, nullif(left(trim(coalesce(p ->> 'camera_time', '')), 40), '')),
    label_model = 'claude-session',
    label_error = null
  where id = p_frame and label is null and label_model is null
$$;

-- 4. Paid plan check: an evening plan waits 75 min for the session's check (04:12 UTC) first;
--    every other plan as before (12 min).
create or replace function public.t_review_queue()
returns integer
language plpgsql
set search_path to 'public', 'extensions'
as $function$
declare n int := 0; r record;
begin
  update t_reviews set status = 'error', error = 'no answer in 15 min', done_at = now()
   where status = 'running' and started_at < now() - interval '15 minutes';
  insert into t_reviews (trip_id, run_id, plan_date, note)
  select sr.trip_id, sr.id, sr.plan_date, p.note
    from solver_runs sr join solver_plans p on p.run_id = sr.id and p.rank = 1
    join planner_t_trips t on t.trip_id = sr.trip_id and t.review
   where sr.created_at > now() - interval '3 hours'
     and p.note in ('T: evening plan', 'T: morning re-plan', 'T: morning re-plan (cameras)')
     -- practice trips: the evening plan only (~$0.60 a review, 9 Nov 2026); real trips: every plan
     and (p.note = 'T: evening plan' or not exists (select 1 from trips tr where tr.id = sr.trip_id and tr.training_of is not null))
     and jsonb_array_length(coalesce(p.visits, '[]'::jsonb)) > 0
  on conflict (run_id) do nothing;
  -- a newer version of the same plan (same trip, date and kind) replaces a queued check
  update t_reviews q set status = 'skipped', error = 'superseded by a newer plan', done_at = now()
   where q.status = 'queued'
     and exists (select 1 from t_reviews q2 join solver_runs s2 on s2.id = q2.run_id
                   join solver_runs s1 on s1.id = q.run_id
                  where q2.trip_id = q.trip_id and q2.plan_date = q.plan_date and q2.note = q.note
                    and q2.id <> q.id and s2.created_at > s1.created_at);
  for r in select q.id from t_reviews q join solver_runs sr on sr.id = q.run_id
            where q.status = 'queued' and q.created_at > now() - interval '3 hours'
              and sr.created_at <= now() - case when q.note = 'T: evening plan' then interval '75 minutes'
                                                else interval '12 minutes' end   -- let quick re-plans settle first
            order by q.id limit 3 loop
    update t_reviews set status = 'running', started_at = now() where id = r.id;
    perform net.http_post(
      url := 'https://ohshrzlvvxyovcjmdajc.supabase.co/functions/v1/t-review',
      body := jsonb_build_object('review_id', r.id),
      headers := '{"Content-Type":"application/json"}'::jsonb, timeout_milliseconds := 1000);
    n := n + 1;
  end loop;
  update t_reviews set status = 'skipped', error = 'too old', done_at = now() where status = 'queued' and created_at <= now() - interval '3 hours';
  return n;
end $function$;

-- 5. Backup at 06:00-06:35 UTC (1 AM EST): the paid reader reads whatever the sessions left.
select cron.schedule('webcam-label-backup', '0,5,10,15,20,25,30,35 6 * * *', $$
  select net.http_post(
    url := 'https://ohshrzlvvxyovcjmdajc.supabase.co/functions/v1/webcam-archive',
    body := '{"backfill": 20}'::jsonb,
    headers := '{"Content-Type":"application/json"}'::jsonb,
    timeout_milliseconds := 1000);
$$);

-- 6. The switch (applied 14 Nov 2026 after webcam-archive v24 was deployed): the 13 read Teton cameras.
update webcam_cameras set label_by = 'session'
 where code like 'GT-%' and active and not coalesce(label_paused, false);
