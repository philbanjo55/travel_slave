-- T2 (Phil, 3 Nov 2026: "it needs to work with the weather and all the other data points"):
-- the bench forecasts held only sun (direct radiation) and total cloud, so T never saw rain,
-- wind or a waterfall's rained-yesterday bonus, which the old live builder
-- (solver_build_scores) does use. This downloads, for every bench forecast already held:
--   * precipitation (mm/h) and wind gusts (km/h) for the same models, made 1-3 days ahead
--     (Open-Meteo Previous Runs), as replay_wx_x model 'x' / 'x@2' / 'x@3' (as replay_wx_day);
--   * what happened: ERA5 (Open-Meteo archive) precipitation and gusts at the same points,
--     replay_wx_x model 'era5'.
-- One request per point and period with every model and lead (far fewer calls than
-- replay_fetch's one per model). Its own queue and tick, so the live fetches are untouched.
-- Cron replay-fetchx skips :07 like replay-fetch, 2 calls a tick, unschedules itself when empty.

create table if not exists public.replay_wx_x (
  point_key text not null,
  model text not null,
  day date not null,
  precip real[],
  gust real[],
  primary key (point_key, model, day)
);
alter table public.replay_wx_x enable row level security;

create table if not exists public.replay_fetchx (
  id bigserial primary key,
  kind text not null check (kind in ('fc', 'era')),
  point_key text not null,
  models text[] not null,
  start_date date not null,
  end_date date not null,
  req_id bigint,
  status text not null default 'queued',
  tries int not null default 0,
  note text,
  updated_at timestamptz not null default now(),
  unique (kind, point_key, start_date, end_date)
);
alter table public.replay_fetchx enable row level security;

create or replace function public.replay_fetchx_tick()
returns jsonb language plpgsql set search_path to 'public', 'extensions' as $$
declare r record; c jsonb; p record; v_url text; n_done int := 0; n_sent int := 0; m text; ld int; v_pr text; v_gu text; one boolean;
begin
  for r in select f.*, h.status_code, h.content, h.timed_out, h.error_msg
             from replay_fetchx f left join net._http_response h on h.id = f.req_id
            where f.status = 'sent' loop
    if r.status_code is null and coalesce(r.timed_out, false) is false and r.error_msg is null then
      if r.updated_at < now() - interval '10 minutes' then
        update replay_fetchx set status = 'queued', tries = tries + 1, note = 'no response', updated_at = now() where id = r.id;
      end if;
      continue;
    end if;
    if r.status_code = 200 then
      c := r.content::jsonb;
      if r.kind = 'era' then
        insert into replay_wx_x (point_key, model, day, precip, gust)
        select r.point_key, 'era5', (t.v #>> '{}')::timestamp::date,
               array_agg((a.v #>> '{}')::real order by t.i), array_agg((b.v #>> '{}')::real order by t.i)
          from jsonb_array_elements(c->'hourly'->'time') with ordinality t(v, i)
          join jsonb_array_elements(c->'hourly'->'precipitation') with ordinality a(v, j) on a.j = t.i
          join jsonb_array_elements(c->'hourly'->'wind_gusts_10m') with ordinality b(v, k) on b.k = t.i
         group by 3 having count(*) = 24
        on conflict (point_key, model, day) do update set precip = excluded.precip, gust = excluded.gust;
      else
        -- With one model Open-Meteo leaves the model suffix off the variable names.
        one := cardinality(r.models) = 1;
        foreach m in array r.models loop
          for ld in 1..3 loop
            v_pr := 'precipitation_previous_day' || ld || case when one then '' else '_' || m end;
            v_gu := 'wind_gusts_10m_previous_day' || ld || case when one then '' else '_' || m end;
            insert into replay_wx_x (point_key, model, day, precip, gust)
            select r.point_key, m || case when ld = 1 then '' else '@' || ld end, (t.v #>> '{}')::timestamp::date,
                   array_agg((a.v #>> '{}')::real order by t.i), array_agg((b.v #>> '{}')::real order by t.i)
              from jsonb_array_elements(c->'hourly'->'time') with ordinality t(v, i)
              left join jsonb_array_elements(c->'hourly'->v_pr) with ordinality a(v, j) on a.j = t.i
              left join jsonb_array_elements(c->'hourly'->v_gu) with ordinality b(v, k) on b.k = t.i
             group by 3
            having count(*) = 24 and (count(a.v #>> '{}') > 0 or count(b.v #>> '{}') > 0)
            on conflict (point_key, model, day) do update set precip = excluded.precip, gust = excluded.gust;
          end loop;
        end loop;
      end if;
      update replay_fetchx set status = 'done', updated_at = now() where id = r.id;
      n_done := n_done + 1;
    elsif (r.status_code = 429 or r.timed_out or r.error_msg is not null) and r.tries < 6 then
      update replay_fetchx set status = 'queued', tries = tries + 1, note = coalesce(r.error_msg, 'http ' || r.status_code), updated_at = now() where id = r.id;
    else
      update replay_fetchx set status = 'failed', note = left(coalesce(r.content, r.error_msg, 'http ' || r.status_code), 200), updated_at = now() where id = r.id;
    end if;
  end loop;

  for r in select * from replay_fetchx where status = 'queued' order by tries, start_date desc, id limit 2 loop
    select * into p from replay_points where point_key = r.point_key;
    v_url := case when r.kind = 'era'
      then 'https://archive-api.open-meteo.com/v1/archive?hourly=precipitation,wind_gusts_10m'
      else 'https://previous-runs-api.open-meteo.com/v1/forecast?hourly='
           || 'precipitation_previous_day1,wind_gusts_10m_previous_day1,precipitation_previous_day2,wind_gusts_10m_previous_day2,'
           || 'precipitation_previous_day3,wind_gusts_10m_previous_day3&models=' || array_to_string(r.models, ',') end
      || '&latitude=' || p.lat || '&longitude=' || p.lng || '&start_date=' || r.start_date || '&end_date=' || r.end_date || '&timezone=UTC';
    update replay_fetchx set req_id = net.http_get(v_url, timeout_milliseconds := 60000), status = 'sent', updated_at = now() where id = r.id;
    n_sent := n_sent + 1;
  end loop;

  if not exists (select 1 from replay_fetchx where status in ('queued', 'sent')) then
    perform cron.unschedule('replay-fetchx');
  end if;
  return jsonb_build_object('parsed', n_done, 'sent', n_sent);
end $$;

-- Every bench period (Teton winters + October, Faroes Mays + the Faroes Live October), each fc point.
insert into replay_fetchx (kind, point_key, models, start_date, end_date)
select k.kind, p.point_key,
       case when k.kind = 'era' then array['era5']
            when p.lat > 55 then array['ecmwf_ifs025','gfs_seamless','icon_seamless','ukmo_seamless','meteofrance_seamless','gem_seamless','jma_seamless','metno_seamless','dmi_seamless']
            else array['ecmwf_ifs025','gfs_seamless','icon_seamless','ukmo_seamless','meteofrance_seamless','gem_seamless','jma_seamless','ncep_hrrr_conus'] end,
       w.s, w.e
  from replay_points p
  cross join (values ('fc'), ('era')) k(kind)
  join (values (false, date '2024-11-29', date '2025-02-01'), (false, date '2025-11-29', date '2026-02-01'),
               (false, date '2026-09-29', date '2026-11-01'),
               (true, date '2024-04-29', date '2024-06-17'), (true, date '2025-04-29', date '2025-06-17'),
               (true, date '2026-04-29', date '2026-06-17'), (true, date '2026-10-20', date '2026-11-01')) w(north, s, e)
    on w.north = (p.lat > 55)
 where p.kind = 'fc'
on conflict do nothing;

do $$ begin
  if not exists (select 1 from cron.job where jobname = 'replay-fetchx') then
    perform cron.schedule('replay-fetchx', '0-6,8-59 * * * *', 'select public.replay_fetchx_tick();');
  end if;
end $$;
