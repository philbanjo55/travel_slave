-- Planner test bench (Phil, 25 Oct 2026): replay the planner on past days of the
-- real trips' windows, with the forecast made the day before and satellite sunshine
-- as truth. Backend only: nothing here is read by either app (RLS on, no policies),
-- and the real trips are only read. Feasibility notes: docs/solver/TESTBENCH_FEASIBILITY.md.
--
-- Weather comes from Open-Meteo through pg_net (this container gets 403):
--   forecast  = Previous Runs API, *_previous_day1 (direct radiation, total cloud),
--               one row per model per hour at the subject's 0.25 deg cell;
--               the models stand in for the 51 ensemble versions.
--   truth     = Satellite API, hourly direct normal irradiance at the subject's
--               0.1 deg point (sun on the mountain).
-- replay_fetch_tick (pg_cron replay-fetch, even minutes) sends two requests at a
-- time and parses what came back; it unschedules itself when the queue is empty.

create table if not exists replay_points (
  point_key text primary key,
  kind text not null check (kind in ('fc', 'sat')),
  lat double precision not null,
  lng double precision not null
);

create table if not exists replay_fetch (
  id bigserial primary key,
  kind text not null check (kind in ('fc', 'sat')),
  model text not null,
  point_key text not null references replay_points(point_key),
  start_date date not null,
  end_date date not null,
  req_id bigint,
  status text not null default 'queued',
  tries integer not null default 0,
  note text,
  updated_at timestamptz not null default now(),
  unique (kind, model, point_key, start_date)
);

create table if not exists replay_wx (
  point_key text not null,
  model text not null,
  valid_at timestamptz not null,   -- end of the hour (radiation is the preceding hour's mean)
  dr real,                         -- direct radiation on the flat, W/m2
  cloud real,                      -- total cloud, %
  primary key (point_key, model, valid_at)
);

create table if not exists replay_sat (
  point_key text not null,
  valid_at timestamptz not null,
  dni real,                        -- direct normal irradiance, W/m2
  primary key (point_key, valid_at)
);

create table if not exists replay_days (
  id bigserial primary key,
  trip_id uuid not null references trips(id),
  replay_date date not null,       -- the past day whose weather is used
  trip_date date not null,         -- the trip day planned on it (its hotels and own stops)
  status text not null default 'queued',
  note text,
  updated_at timestamptz not null default now(),
  unique (trip_id, replay_date)
);

create table if not exists replay_builds (
  id uuid primary key default gen_random_uuid(),
  replay_day_id bigint not null references replay_days(id),
  kind text not null check (kind in ('forecast', 'truth')),
  members integer,
  slots integer,
  created_at timestamptz not null default now()
);

create table if not exists replay_scores (
  build_id uuid not null references replay_builds(id) on update cascade,
  stop_id uuid not null,
  slot_at timestamptz not null,
  v smallint[] not null,
  primary key (build_id, stop_id, slot_at)
);

create table if not exists replay_results (
  id bigserial primary key,
  replay_day_id bigint not null references replay_days(id),
  config text not null default 'base',
  plan text not null,              -- forecast / light / my_day / hindsight
  predicted real,                  -- what the planner expected (tier points)
  realized real,                   -- what it got against the satellite (tier points)
  drive_minutes integer,
  visits jsonb,
  stats jsonb,
  created_at timestamptz not null default now(),
  unique (replay_day_id, config, plan)
);

-- Points, fetch queue and replay days for Grand Teton Winter 2026 (Dec-Jan of
-- 2024/25 and 2025/26, trip days cycled 1-7 with 29 Dec = day 1) and Faroe
-- Islands 2027 (13-28 May 2024-2026, same calendar day).
create or replace function replay_setup() returns jsonb
language plpgsql as $$
declare v_teton uuid := '5e247891-d800-4d07-b5e0-8ad748ae2754'; v_faroe uuid := 'e04fbc9d-86b1-42b2-bf08-fc65a18e665d';
begin
  insert into replay_points (point_key, kind, lat, lng)
  select distinct k.kind || ':' || k.lat || ',' || k.lng, k.kind, k.lat, k.lng
    from solver_stop_inputs i
    join scout_vantages v on v.id = i.star_vantage_id
    join scout_subjects s on s.id = v.subject_id
    cross join lateral (values
      ('fc',  round((s.lat * 4)::numeric) / 4,   round((s.lng * 4)::numeric) / 4),
      ('sat', round((s.lat * 10)::numeric) / 10, round((s.lng * 10)::numeric) / 10)) k(kind, lat, lng)
   where i.trip_id in (v_teton, v_faroe) and i.tier is not null and s.lat is not null
  on conflict do nothing;

  insert into replay_fetch (kind, model, point_key, start_date, end_date)
  select p.kind, m.model, p.point_key, w.s, w.e
    from replay_points p
    cross join lateral (select case when p.lat > 55 then 'faroe' else 'teton' end as place) pl
    cross join lateral (
      select unnest(case when p.kind = 'sat' then array['satellite']
                         when pl.place = 'faroe' then array['ecmwf_ifs025','gfs_seamless','icon_seamless','ukmo_seamless',
                                                            'meteofrance_seamless','gem_seamless','jma_seamless','metno_seamless','dmi_seamless']
                         else array['ecmwf_ifs025','gfs_seamless','icon_seamless','ukmo_seamless',
                                    'meteofrance_seamless','gem_seamless','jma_seamless','ncep_hrrr_conus'] end) as model) m
    cross join lateral (
      select * from (values
        ('teton', date '2024-11-30', date '2025-02-01'), ('teton', date '2025-11-30', date '2026-02-01'),
        ('faroe', date '2024-05-12', date '2024-05-29'), ('faroe', date '2025-05-12', date '2025-05-29'),
        ('faroe', date '2026-05-12', date '2026-05-29')) x(place, s, e)
       where x.place = pl.place) w
  on conflict do nothing;

  insert into replay_days (trip_id, replay_date, trip_date)
  select v_teton, d::date, date '2026-12-29' + (((d::date - date '2024-12-29') % 7 + 7) % 7)
    from generate_series(date '2024-12-01', date '2025-01-31', interval '1 day') d
  union all
  select v_teton, d::date, date '2026-12-29' + (((d::date - date '2025-12-29') % 7 + 7) % 7)
    from generate_series(date '2025-12-01', date '2026-01-31', interval '1 day') d
  union all
  select v_faroe, d::date, make_date(2027, 5, extract(day from d)::int)
    from generate_series(date '2024-05-13', date '2024-05-28', interval '1 day') d
  union all
  select v_faroe, d::date, make_date(2027, 5, extract(day from d)::int)
    from generate_series(date '2025-05-13', date '2025-05-28', interval '1 day') d
  union all
  select v_faroe, d::date, make_date(2027, 5, extract(day from d)::int)
    from generate_series(date '2026-05-13', date '2026-05-28', interval '1 day') d
  on conflict do nothing;

  return jsonb_build_object('points', (select count(*) from replay_points), 'fetch', (select count(*) from replay_fetch),
                            'days', (select count(*) from replay_days));
end $$;

create or replace function replay_fetch_tick() returns jsonb
language plpgsql as $$
declare r record; c jsonb; n_done int := 0; n_sent int := 0; v_url text; p record;
begin
  -- Collect what came back.
  for r in select f.*, h.status_code, h.content, h.timed_out, h.error_msg
             from replay_fetch f left join net._http_response h on h.id = f.req_id
            where f.status = 'sent' loop
    if r.status_code is null and coalesce(r.timed_out, false) is false and r.error_msg is null then
      if r.updated_at < now() - interval '10 minutes' then
        update replay_fetch set status = 'queued', tries = tries + 1, note = 'no response', updated_at = now() where id = r.id;
      end if;
      continue;
    end if;
    if r.status_code = 200 then
      c := r.content::jsonb;
      if r.kind = 'sat' then
        insert into replay_sat (point_key, valid_at, dni)
        select r.point_key, (t.v #>> '{}')::timestamp at time zone 'UTC', nullif(x.v #>> '{}', 'null')::real
          from jsonb_array_elements(c->'hourly'->'time') with ordinality t(v, i)
          join jsonb_array_elements(c->'hourly'->'direct_normal_irradiance') with ordinality x(v, j) on x.j = t.i
        on conflict do nothing;
      else
        insert into replay_wx (point_key, model, valid_at, dr, cloud)
        select r.point_key, r.model, (t.v #>> '{}')::timestamp at time zone 'UTC',
               nullif(a.v #>> '{}', 'null')::real, nullif(b.v #>> '{}', 'null')::real
          from jsonb_array_elements(c->'hourly'->'time') with ordinality t(v, i)
          join jsonb_array_elements(c->'hourly'->'direct_radiation_previous_day1') with ordinality a(v, j) on a.j = t.i
          join jsonb_array_elements(c->'hourly'->'cloud_cover_previous_day1') with ordinality b(v, k) on b.k = t.i
         where a.v <> 'null'::jsonb or b.v <> 'null'::jsonb
        on conflict do nothing;
      end if;
      update replay_fetch set status = 'done', updated_at = now() where id = r.id;
      n_done := n_done + 1;
    elsif (r.status_code = 429 or r.timed_out or r.error_msg is not null) and r.tries < 6 then
      update replay_fetch set status = 'queued', tries = tries + 1, note = coalesce(r.error_msg, 'http ' || r.status_code), updated_at = now() where id = r.id;
    else
      update replay_fetch set status = 'failed', note = left(coalesce(r.content, r.error_msg, 'http ' || r.status_code), 200), updated_at = now() where id = r.id;
    end if;
  end loop;

  -- Send the next two (Open-Meteo returns 429 when too many run at once).
  for r in select * from replay_fetch where status = 'queued' order by tries, id limit 2 loop
    select * into p from replay_points where point_key = r.point_key;
    v_url := case when r.kind = 'sat'
      then 'https://satellite-api.open-meteo.com/v1/archive?hourly=direct_normal_irradiance'
      else 'https://previous-runs-api.open-meteo.com/v1/forecast?hourly=direct_radiation_previous_day1,cloud_cover_previous_day1&models=' || r.model end
      || '&latitude=' || p.lat || '&longitude=' || p.lng || '&start_date=' || r.start_date || '&end_date=' || r.end_date || '&timezone=UTC';
    update replay_fetch set req_id = net.http_get(v_url, timeout_milliseconds := 30000), status = 'sent', updated_at = now() where id = r.id;
    n_sent := n_sent + 1;
  end loop;

  if not exists (select 1 from replay_fetch where status in ('queued', 'sent')) then
    perform cron.unschedule('replay-fetch');
  end if;
  return jsonb_build_object('parsed', n_done, 'sent', n_sent);
end $$;
