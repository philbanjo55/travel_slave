-- Find my spot from a photo (Phil, 16 Nov 2026: "Yes build").
-- The app asks edge function photo-spot to place a stop photo: Claude names what is in the picture (the "look"),
-- then a GitHub Actions run (.github/workflows/photo-spot.yml, tools/sun3d/photospot/job.py) searches our terrain
-- for where the camera stood and writes the result here. "Add as a shot" = photo_spot_add_shot(job, lens).
-- Additive only: a new table, a new public bucket for the result pictures, one new function.

create table if not exists public.photo_spot_jobs (
  id uuid primary key default gen_random_uuid(),
  stop_id uuid not null references public.stops(id) on delete cascade,
  photo_id uuid references public.stop_photos(id) on delete set null,
  photo_url text,
  status text not null default 'queued' check (status in ('queued', 'looking', 'solving', 'done', 'error')),
  note text,                    -- short state words for the app ("waiting for the worker", ...)
  look jsonb,                   -- Claude's landmarks (names, pixel spots as fractions of the picture, flags)
  result jsonb,                 -- spot, aim, lens, 4x5 equivalent, confidence, lens rows, overlay path
  error text,
  shots jsonb not null default '{}'::jsonb,   -- lens id -> vantage id made by photo_spot_add_shot
  cost_usd numeric,
  run_id bigint,                -- the GitHub Actions run that solved it
  dispatched_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists photo_spot_jobs_photo on public.photo_spot_jobs (photo_id, created_at desc);
create index if not exists photo_spot_jobs_stop on public.photo_spot_jobs (stop_id, created_at desc);
create unique index if not exists photo_spot_jobs_one_open
  on public.photo_spot_jobs (photo_id, stop_id) where status in ('queued', 'looking', 'solving');

alter table public.photo_spot_jobs enable row level security;
drop policy if exists app_read on public.photo_spot_jobs;
create policy app_read on public.photo_spot_jobs for select using (true);

-- Result pictures (the photo with our sky line drawn over it): photo-spot/<job>.jpg, public like `terrain`.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photo-spot', 'photo-spot', true, 5242880, array['image/jpeg', 'image/png'])
on conflict (id) do nothing;

-- "Add as a shot": a new vantage at the lens row's spot, framed with that lens, on the stop and every twin
-- (the main trip's stop and its practice copies, training_copy_map kind 'stop'). Stars untouched, nothing deleted.
-- Subject: the stop's own subject whose bearing best matches the aim (within half the picture's width), else the
-- trip's subject named like the photo's main landmark, else a new subject at that landmark.
create or replace function public.photo_spot_add_shot(p_job uuid, p_lens text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  j public.photo_spot_jobs;
  r jsonb;
  row_ jsonb;
  v_stop uuid;
  v_trip uuid;
  v_main uuid;
  v_main_trip uuid;
  v_lat double precision;
  v_lng double precision;
  v_head double precision;
  v_pitch double precision;
  v_half double precision;
  v_subject uuid;
  v_best double precision := 1e9;
  v_d double precision;
  v_name text;
  v_vantage uuid;
  v_lm jsonb;
  v_stops uuid[];
  s uuid;
  rec record;
begin
  select * into j from public.photo_spot_jobs where id = p_job;
  if j.id is null then raise exception 'Job not found'; end if;
  if j.status <> 'done' or coalesce((j.result ->> 'ok')::boolean, false) is not true then
    raise exception 'This photo has no spot yet';
  end if;
  if j.shots ? p_lens then
    return jsonb_build_object('vantage_id', j.shots ->> p_lens, 'again', true);
  end if;
  r := j.result;
  select x into row_ from jsonb_array_elements(coalesce(r -> 'lenses', '[]'::jsonb)) x where x ->> 'id' = p_lens limit 1;
  if row_ is null then raise exception 'No plan for that lens'; end if;
  if coalesce((row_ ->> 'possible')::boolean, true) is not true then raise exception 'That lens cannot make this picture'; end if;
  v_lat := (row_ ->> 'lat')::double precision; v_lng := (row_ ->> 'lng')::double precision;
  v_head := mod((row_ ->> 'heading')::numeric + 360, 360)::double precision;
  v_pitch := greatest(-89, least(89, coalesce((row_ ->> 'pitch')::double precision, 0)));
  v_half := least(45, greatest(3, coalesce((r ->> 'hfov')::double precision, 20) / 2));
  if v_lat is null or v_lng is null or abs(v_lat) > 90 or abs(v_lng) > 180 then raise exception 'The spot is missing'; end if;

  v_stop := j.stop_id;
  select trip_id into v_trip from public.stops where id = v_stop;
  -- the main trip's stop (a practice copy's stop points back to it), then every copy of it
  select old_id into v_main from public.training_copy_map where kind = 'stop' and new_id = v_stop limit 1;
  v_main := coalesce(v_main, v_stop);
  select trip_id into v_main_trip from public.stops where id = v_main;
  v_stops := array[v_main] || coalesce((select array_agg(new_id) from public.training_copy_map where kind = 'stop' and old_id = v_main), '{}');

  -- subject: the stop's own subjects first
  for rec in
    select distinct su.id, su.lat, su.lng
      from public.stop_sun_pairs sp
      join public.scout_vantages v on v.id = sp.vantage_id
      join public.scout_subjects su on su.id = v.subject_id
     where sp.stop_id = v_main and su.lat is not null and su.lng is not null
  loop
    v_d := abs(mod((degrees(atan2((rec.lng - v_lng) * cos(radians(v_lat)), rec.lat - v_lat)) - v_head + 540)::numeric, 360) - 180);
    if v_d <= v_half and v_d < v_best then v_best := v_d; v_subject := rec.id; end if;
  end loop;
  v_lm := r -> 'main_landmark';
  if v_subject is null and v_lm is not null and v_lm ->> 'name' is not null then
    select id into v_subject from public.scout_subjects
     where trip_id = v_main_trip and lower(name) = lower(v_lm ->> 'name') order by created_at limit 1;
    if v_subject is null and (v_lm ->> 'lat') is not null and (v_lm ->> 'lng') is not null then
      insert into public.scout_subjects (trip_id, name, lat, lng, height_m, coord_confidence, notes)
      values (v_main_trip, left(v_lm ->> 'name', 120), (v_lm ->> 'lat')::double precision, (v_lm ->> 'lng')::double precision,
              nullif(v_lm ->> 'height_m', '')::double precision, 'estimated', 'From a photo placed by Find spot.')
      returning id into v_subject;
    end if;
  end if;
  if v_subject is null then raise exception 'Could not tell what the shot is of'; end if;

  v_name := left(coalesce(nullif(btrim(r ->> 'shot_name'), ''), 'from your photo'), 100);
  insert into public.scout_vantages (subject_id, code, name, shot_name, lat, lng, coord_confidence, photo_id, notes,
                                     frame_heading_deg, frame_pitch_deg, frame_lens, frame_orient, framed_at)
  values (v_subject, public.sun_next_code(v_main), v_name, v_name, v_lat, v_lng, 'estimated', j.photo_id,
          left(coalesce(row_ ->> 'note', 'Placed by Find spot from a photo.'), 500),
          v_head, v_pitch, p_lens, 'landscape', now())
  returning id into v_vantage;

  foreach s in array v_stops loop
    if exists (select 1 from public.stops where id = s) and not exists (select 1 from public.stop_sun_pairs where stop_id = s and vantage_id = v_vantage) then
      insert into public.stop_sun_pairs (stop_id, vantage_id, position)
      values (s, v_vantage, coalesce((select max(position) + 1 from public.stop_sun_pairs where stop_id = s), 0));
    end if;
  end loop;

  update public.photo_spot_jobs set shots = shots || jsonb_build_object(p_lens, v_vantage), updated_at = now() where id = p_job;
  return jsonb_build_object('vantage_id', v_vantage, 'name', v_name, 'subject_id', v_subject, 'stops', to_jsonb(v_stops));
end $function$;

revoke all on function public.photo_spot_add_shot(uuid, text) from public;
grant execute on function public.photo_spot_add_shot(uuid, text) to anon, authenticated, service_role;
