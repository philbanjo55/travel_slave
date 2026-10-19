-- Cameras for any trip: each row carries its own image URL, region (for the
-- labeller), source and where permission came from.
alter table public.webcam_cameras
  add column if not exists trip_id uuid references public.trips(id),
  add column if not exists region text,
  add column if not exists image_url text,
  add column if not exists source text,
  add column if not exists permission_note text;

update public.webcam_cameras set
  trip_id = 'e04fbc9d-86b1-42b2-bf08-fc65a18e665d',
  region = 'Faroe Islands',
  image_url = 'https://www.lv.fo/tmp/' || code || '.jpg',
  source = 'Landsverk',
  permission_note = 'Archiving approved by Landsverk by phone (Phil, Oct 2026)'
where image_url is null and code like 'F-%';

alter table public.webcam_cameras alter column image_url set not null;

-- Free labeller: CLIP zero-shot, run nightly in GitHub Actions
-- (tools/webcam_clip). Scores are softmax probabilities per label.
alter table public.webcam_frames
  add column if not exists sun_altitude real,
  add column if not exists clip_label text,
  add column if not exists clip_scores jsonb,
  add column if not exists clip_model text,
  add column if not exists clip_at timestamptz;
