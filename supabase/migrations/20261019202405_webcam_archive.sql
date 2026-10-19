-- Fog truth from Landsverk road/harbour webcams (archiving approved by
-- Landsverk by phone, Oct 2026). Frames every 3 h; full images kept 7 days,
-- one midday frame per camera per day kept permanently; label + haze
-- metrics kept for every frame.
create table if not exists public.webcam_cameras (
  code text primary key,              -- Landsverk image name, lv.fo/tmp/<code>.jpg
  name text not null,
  island text,
  lat double precision, lng double precision,   -- approximate, for cell mapping only
  hint text,                          -- what to look at in this view (fed to the labeller)
  active boolean not null default true
);

insert into public.webcam_cameras (code, name, island, lat, lng, hint) values
  ('F-41', 'Á Sandavágshálsi, norður', 'Vágar', 62.063, -7.177, 'Mountain pass on Vágar. Judge whether the hills around the pass are clear or in cloud.'),
  ('F-23', 'Vatnsoyrar, norður', 'Vágar', 62.075, -7.240, 'Near Sørvágsvatn on Vágar. Judge distant hills and the lake area.'),
  ('F-47', 'Mykines, lending', 'Mykines', 62.102, -7.645, 'Mykines harbour landing. Judge cloud on the island slopes and sea visibility.'),
  ('F-33', 'Norðradalskarð', 'Streymoy', 62.040, -6.920, 'Mountain pass on Streymoy near Sornfelli. Fog and low cloud are common here.'),
  ('F-38', 'Kaldbaksbotnur', 'Streymoy', 62.070, -6.880, 'Head of Kaldbaksfjørður. Judge the fjord walls and hilltops.'),
  ('F-42', 'Gjáarskarð', 'Eysturoy', 62.310, -6.970, 'Mountain pass on the road to Gjógv, Eysturoy.'),
  ('F-43', 'Oyndarfjørður, Heltnin', 'Eysturoy', 62.275, -6.850, 'North Eysturoy road. Judge hills across the fjord.'),
  ('F-26', 'Syðradalur, Bilrað', 'Kalsoy', 62.235, -6.620, 'Kalsoy ferry terminal. Judge Kalsoy hills and the sound.')
on conflict (code) do nothing;

create table if not exists public.webcam_frames (
  id uuid primary key default gen_random_uuid(),
  camera_code text not null references public.webcam_cameras(code),
  captured_at timestamptz not null,
  storage_path text,                  -- NULL once the image has been pruned
  bytes int,
  width int, height int,
  keep boolean not null default false,
  luma_mean real, contrast_full real, contrast_top real, edge_full real, edge_top real,
  label text,                         -- clear | haze | low_cloud | fog | dark | camera_problem
  hills_visible boolean,
  cloud_on_hills text,                -- none | above_hills | touching_tops | covering_hills
  sea_visible boolean,
  rain_or_wet_lens boolean,
  label_confidence real,
  label_note text,
  label_model text,
  label_error text,
  unique (camera_code, captured_at)
);
create index if not exists webcam_frames_captured on public.webcam_frames (captured_at);

-- Every 3 h at :37 (never :07, see CLAUDE.md).
select cron.schedule('webcam-archive', '37 */3 * * *', $cmd$
  select net.http_post(
    url := 'https://ohshrzlvvxyovcjmdajc.supabase.co/functions/v1/webcam-archive',
    body := '{}'::jsonb,
    headers := '{"Content-Type":"application/json"}'::jsonb,
    timeout_milliseconds := 1000);
$cmd$);
