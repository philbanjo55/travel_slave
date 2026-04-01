-- PHILM+FRAME Database Schema
-- Run this in your Supabase SQL editor

-- ─────────────────────────────────────────
-- TRIPS
-- ─────────────────────────────────────────
create table trips (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  subtitle text,
  owner text not null default 'phil',
  start_date date,
  end_date date,
  cover_image_url text,
  accent_color text default '#c4a882',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ─────────────────────────────────────────
-- DAYS
-- ─────────────────────────────────────────
create table days (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid references trips(id) on delete cascade,
  day_number integer not null,
  date date,
  title text,
  subtitle text,
  region text,
  checked boolean default false,
  map_center_lat double precision,
  map_center_lng double precision,
  map_zoom integer default 10,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(trip_id, day_number)
);

-- ─────────────────────────────────────────
-- STOPS
-- ─────────────────────────────────────────
create table stops (
  id uuid primary key default gen_random_uuid(),
  day_id uuid references days(id) on delete cascade,
  trip_id uuid references trips(id) on delete cascade,
  position integer not null,
  name text not null,
  emoji text default '📷',
  time_label text,
  duration_minutes integer,
  drive_override_minutes integer,
  lat double precision,
  lng double precision,
  place_id text,
  alltrails_url text,
  map_url text,
  signal_status text check (signal_status in ('ok','warning','none')),
  info text,
  log text,
  hist text,
  photo_note text,
  checked boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ─────────────────────────────────────────
-- STOP PHOTOS
-- ─────────────────────────────────────────
create table stop_photos (
  id uuid primary key default gen_random_uuid(),
  stop_id uuid references stops(id) on delete cascade,
  url text,
  base64_data text,
  caption text,
  position integer default 0,
  created_at timestamptz default now()
);

-- ─────────────────────────────────────────
-- ACCOMMODATIONS (sb/sa per day)
-- ─────────────────────────────────────────
create table accommodations (
  id uuid primary key default gen_random_uuid(),
  day_id uuid references days(id) on delete cascade,
  type text check (type in ('start','end')),
  name text,
  lat double precision,
  lng double precision,
  map_url text
);

-- ─────────────────────────────────────────
-- CACHED DRIVE TIMES (Google Maps results)
-- ─────────────────────────────────────────
create table drive_times (
  id uuid primary key default gen_random_uuid(),
  from_stop_id uuid references stops(id) on delete cascade,
  to_stop_id uuid references stops(id) on delete cascade,
  duration_minutes integer,
  distance_km double precision,
  fetched_at timestamptz default now()
);

-- ─────────────────────────────────────────
-- INDEXES
-- ─────────────────────────────────────────
create index idx_days_trip on days(trip_id);
create index idx_stops_day on stops(day_id);
create index idx_stops_trip on stops(trip_id);
create index idx_photos_stop on stop_photos(stop_id);

-- ─────────────────────────────────────────
-- ROW LEVEL SECURITY (basic, single user)
-- ─────────────────────────────────────────
alter table trips enable row level security;
alter table days enable row level security;
alter table stops enable row level security;
alter table stop_photos enable row level security;
alter table accommodations enable row level security;
alter table drive_times enable row level security;

-- Allow full access via anon key (single user app, no auth needed)
create policy "full_access" on trips for all using (true);
create policy "full_access" on days for all using (true);
create policy "full_access" on stops for all using (true);
create policy "full_access" on stop_photos for all using (true);
create policy "full_access" on accommodations for all using (true);
create policy "full_access" on drive_times for all using (true);
