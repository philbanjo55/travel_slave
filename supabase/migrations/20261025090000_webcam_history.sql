-- Real pictures of past days (Phil, 25 Oct 2026: "check the tetoncam archive",
-- then "go ahead"). TetonCam keeps every 15-min frame since 2014 in a public
-- Google Cloud bucket (archiving approved by phone, see webcam_cameras). The
-- edge function webcam-history has Claude label one frame an hour in daylight
-- for the test bench's Teton winters, with the same prompt and fields as
-- webcam-archive, so the bench's truth (satellite sun + KJAC ceiling) can be
-- checked against what the camera saw. Only labels are stored, not images.
-- Kept apart from webcam_frames so the live scoreboard and the learning
-- planner never read old frames.

create table if not exists webcam_history_labels (
  camera_code text not null references webcam_cameras(code),
  taken_at timestamptz not null,
  local_time text not null,              -- YYYY-MM-DD HH:MM in the camera's tz (the file name)
  status text not null default 'queued', -- queued / sent / done / error
  label text,
  hills_visible boolean,
  cloud_on_hills text,
  sun_on_land boolean,
  rain_or_wet_lens boolean,
  confidence real,
  note text,
  camera_time_text text,
  model text,
  error text,
  updated_at timestamptz not null default now(),
  primary key (camera_code, taken_at)
);

-- Hourly 08:00-16:00 Mountain time, 1 Dec - 31 Jan of both bench winters.
insert into webcam_history_labels (camera_code, taken_at, local_time)
-- (generate_series over dates gives timestamptz, so go through the text.)
select 'GT-TETONIA', l::timestamp at time zone 'America/Denver', l
  from (select to_char(d + make_interval(hours => h), 'YYYY-MM-DD HH24:MI') l
          from (select generate_series(date '2024-12-01', date '2025-01-31', interval '1 day') d
                union all select generate_series(date '2025-12-01', date '2026-01-31', interval '1 day')) days,
               generate_series(8, 16) h) x
on conflict do nothing;

-- Every minute while frames are queued: 8 per call (sent ones with no answer
-- in 10 minutes go back to the queue).
select cron.schedule('webcam-history', '* * * * *', $c$
  update webcam_history_labels set status = 'queued' where status = 'sent' and updated_at < now() - interval '10 minutes';
  select net.http_post(url := 'https://ohshrzlvvxyovcjmdajc.supabase.co/functions/v1/webcam-history',
                       body := '{"n": 8}'::jsonb, headers := '{"Content-Type":"application/json"}'::jsonb,
                       timeout_milliseconds := 1000)
   where exists (select 1 from webcam_history_labels where status = 'queued');
$c$);

-- Done 25 Oct 2026 (1,115 labelled, 1 missing file, $10.01); the cron was then
-- removed: select cron.unschedule('webcam-history');
-- Result vs KJAC (replay_hidden_obs, ceiling < 7000 ft): 80% of daylight hours
-- agree; the camera saw cloud on the peaks in 179 hours the airport called
-- clear (about 1 in 4 hidden hours), the reverse only 44.
