-- F5 (8 Nov 2026): the Previous Runs archive keeps no day-ahead cloud layers (every model came
-- back empty), so the layers come from single ECMWF runs instead (kind 'layr').
alter table replay_wx_layers add column if not exists tot real[];
alter table replay_fetch drop constraint replay_fetch_kind_check;
alter table replay_fetch add constraint replay_fetch_kind_check check (kind = any (array['fc', 'sat', 'run', 'live', 'lay', 'layr']));

CREATE OR REPLACE FUNCTION public.replay_fetch_tick()
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
declare r record; c jsonb; n_done int := 0; n_sent int := 0; v_url text; p record; ld int; v_base text; v_dr text; v_cl text;
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
        insert into replay_sat_day (point_key, day, dni)
        select r.point_key, (t.v #>> '{}')::timestamp::date, array_agg((x.v #>> '{}')::real order by t.i)
          from jsonb_array_elements(c->'hourly'->'time') with ordinality t(v, i)
          join jsonb_array_elements(c->'hourly'->'direct_normal_irradiance') with ordinality x(v, j) on x.j = t.i
         group by 2 having count(*) = 24
        on conflict do nothing;
      elsif r.kind = 'live' then
        -- The newest run: lead 1 for UTC D and D+1, lead 2 for D+1 and D+2, lead 3 for D+2 and D+3.
        insert into replay_wx_day (point_key, model, day, dr, cloud)
        select r.point_key, r.model || case l.lead when 1 then '' else '@' || l.lead end, x.day, x.dr, x.cloud
          from (select (t.v #>> '{}')::timestamp::date as day, array_agg((a.v #>> '{}')::real order by t.i) dr, array_agg((b.v #>> '{}')::real order by t.i) cloud
                  from jsonb_array_elements(c->'hourly'->'time') with ordinality t(v, i)
                  join jsonb_array_elements(c->'hourly'->'direct_radiation') with ordinality a(v, j) on a.j = t.i
                  join jsonb_array_elements(c->'hourly'->'cloud_cover') with ordinality b(v, k) on b.k = t.i
                 group by 1 having count(*) = 24 and (count(a.v #>> '{}') > 0 or count(b.v #>> '{}') > 0)) x
          join (values (1, 0), (1, 1), (2, 1), (2, 2), (3, 2), (3, 3)) l(lead, off) on x.day = r.start_date + l.off
        on conflict (point_key, model, day) do update set dr = excluded.dr, cloud = excluded.cloud;
      elsif r.kind = 'lay' then
        -- F5 (8 Nov 2026): cloud layers, day-ahead (lead 1) unless model ends '@0' (newest run).
        v_base := split_part(r.model, '@', 1);
        v_cl := case when r.model like '%@0' then '' else '_previous_day1' end;
        insert into replay_wx_layers (point_key, model, day, low, mid, high)
        select r.point_key, r.model, (t.v #>> '{}')::timestamp::date,
               array_agg((a.v #>> '{}')::real order by t.i), array_agg((b.v #>> '{}')::real order by t.i), array_agg((h.v #>> '{}')::real order by t.i)
          from jsonb_array_elements(c->'hourly'->'time') with ordinality t(v, i)
          join jsonb_array_elements(c->'hourly'->('cloud_cover_low' || v_cl)) with ordinality a(v, j) on a.j = t.i
          join jsonb_array_elements(c->'hourly'->('cloud_cover_mid' || v_cl)) with ordinality b(v, k) on b.k = t.i
          join jsonb_array_elements(c->'hourly'->('cloud_cover_high' || v_cl)) with ordinality h(v, m) on h.m = t.i
         group by 3
        having count(*) = 24 and (count(a.v #>> '{}') > 0 or count(b.v #>> '{}') > 0)
        on conflict (point_key, model, day) do update set low = excluded.low, mid = excluded.mid, high = excluded.high;
      elsif r.kind = 'layr' then
        -- F5 (8 Nov 2026): one ECMWF run (00 UTC of start_date) with total and layer cloud; the run's
        -- own day as 'x@r0', the next day as 'x@r1' (day-ahead, like the nightly plan).
        insert into replay_wx_layers (point_key, model, day, tot, low, mid, high)
        select r.point_key, split_part(r.model, '@', 1) || '@r' || ((t.v #>> '{}')::timestamp::date - r.start_date),
               (t.v #>> '{}')::timestamp::date,
               array_agg((o.v #>> '{}')::real order by t.i),
               array_agg((a.v #>> '{}')::real order by t.i), array_agg((b.v #>> '{}')::real order by t.i), array_agg((h.v #>> '{}')::real order by t.i)
          from jsonb_array_elements(c->'hourly'->'time') with ordinality t(v, i)
          join jsonb_array_elements(c->'hourly'->'cloud_cover') with ordinality o(v, n) on o.n = t.i
          join jsonb_array_elements(c->'hourly'->'cloud_cover_low') with ordinality a(v, j) on a.j = t.i
          join jsonb_array_elements(c->'hourly'->'cloud_cover_mid') with ordinality b(v, k) on b.k = t.i
          join jsonb_array_elements(c->'hourly'->'cloud_cover_high') with ordinality h(v, m) on h.m = t.i
         where (t.v #>> '{}')::timestamp::date - r.start_date in (0, 1)
         group by 2, 3
        having count(*) = 24 and count(a.v #>> '{}') > 0
        on conflict (point_key, model, day) do update set tot = excluded.tot, low = excluded.low, mid = excluded.mid, high = excluded.high;
      elsif r.kind = 'run' then
        -- One model run (00 UTC of start_date): its first day as 'x@f', its second as 'x@f1'.
        insert into replay_wx_day (point_key, model, day, dr, cloud)
        select r.point_key, split_part(r.model, '@', 1) || case when (t.v #>> '{}')::timestamp::date = r.start_date then '@f' else '@f1' end,
               (t.v #>> '{}')::timestamp::date, array_agg((a.v #>> '{}')::real order by t.i), array_agg((b.v #>> '{}')::real order by t.i)
          from jsonb_array_elements(c->'hourly'->'time') with ordinality t(v, i)
          join jsonb_array_elements(c->'hourly'->'direct_radiation') with ordinality a(v, j) on a.j = t.i
          join jsonb_array_elements(c->'hourly'->'cloud_cover') with ordinality b(v, k) on b.k = t.i
         group by 2, 3
        having count(*) = 24 and (count(a.v #>> '{}') > 0 or count(b.v #>> '{}') > 0)
        on conflict do nothing;
      else
        -- model 'x' = day-ahead (lead 1); 'x@23' = made 2 and 3 days ahead, stored as 'x@2', 'x@3';
        -- 'x@0' = the newest run (no _previous_day suffix).
        v_base := split_part(r.model, '@', 1);
        for ld in select unnest(case when r.model like '%@4567' then array[4, 5, 6, 7] when r.model like '%@23' then array[2, 3] when r.model like '%@0' then array[0] else array[1] end) loop
          v_dr := case when ld = 0 then 'direct_radiation' else 'direct_radiation_previous_day' || ld end;
          v_cl := case when ld = 0 then 'cloud_cover' else 'cloud_cover_previous_day' || ld end;
          insert into replay_wx_day (point_key, model, day, dr, cloud)
          select r.point_key, v_base || case when ld = 1 then '' else '@' || ld end, (t.v #>> '{}')::timestamp::date,
                 array_agg((a.v #>> '{}')::real order by t.i), array_agg((b.v #>> '{}')::real order by t.i)
            from jsonb_array_elements(c->'hourly'->'time') with ordinality t(v, i)
            join jsonb_array_elements(c->'hourly'->v_dr) with ordinality a(v, j) on a.j = t.i
            join jsonb_array_elements(c->'hourly'->v_cl) with ordinality b(v, k) on b.k = t.i
           group by 3
          having count(*) = 24 and (count(a.v #>> '{}') > 0 or count(b.v #>> '{}') > 0)
          on conflict do nothing;
        end loop;
      end if;
      update replay_fetch set status = 'done', updated_at = now() where id = r.id;
      n_done := n_done + 1;
    elsif (r.status_code = 429 or r.timed_out or r.error_msg is not null) and r.tries < 6 then
      update replay_fetch set status = 'queued', tries = tries + 1, note = coalesce(r.error_msg, 'http ' || r.status_code), updated_at = now() where id = r.id;
    else
      update replay_fetch set status = 'failed', note = left(coalesce(r.content, r.error_msg, 'http ' || r.status_code), 200), updated_at = now() where id = r.id;
    end if;
  end loop;

  -- Send the next three (Open-Meteo returns 429 when too many run at once).
  for r in select * from replay_fetch where status = 'queued' order by (kind = 'live' or start_date >= current_date - 7) desc, tries, id limit 3 loop
    select * into p from replay_points where point_key = r.point_key;
    v_url := case when r.kind = 'live'
      then 'https://previous-runs-api.open-meteo.com/v1/forecast?hourly=direct_radiation,cloud_cover&models=' || r.model
      when r.kind = 'run'
      then 'https://single-runs-api.open-meteo.com/v1/forecast?hourly=direct_radiation,cloud_cover&run=' || r.start_date || 'T00:00&models=' || split_part(r.model, '@', 1)
      when r.kind = 'lay' and r.model like '%@0'
      then 'https://previous-runs-api.open-meteo.com/v1/forecast?hourly=cloud_cover_low,cloud_cover_mid,cloud_cover_high&models=' || split_part(r.model, '@', 1)
      when r.kind = 'lay'
      then 'https://previous-runs-api.open-meteo.com/v1/forecast?hourly=cloud_cover_low_previous_day1,cloud_cover_mid_previous_day1,cloud_cover_high_previous_day1&models=' || r.model
      when r.kind = 'layr'
      then 'https://single-runs-api.open-meteo.com/v1/forecast?hourly=cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high&run=' || r.start_date || 'T00:00&models=' || split_part(r.model, '@', 1)
      when r.kind = 'sat'
      then 'https://satellite-api.open-meteo.com/v1/archive?hourly=direct_normal_irradiance'
      when r.model like '%@23'
      then 'https://previous-runs-api.open-meteo.com/v1/forecast?hourly=direct_radiation_previous_day2,cloud_cover_previous_day2,direct_radiation_previous_day3,cloud_cover_previous_day3&models=' || split_part(r.model, '@', 1)
      when r.model like '%@4567'
      then 'https://previous-runs-api.open-meteo.com/v1/forecast?hourly=direct_radiation_previous_day4,cloud_cover_previous_day4,direct_radiation_previous_day5,cloud_cover_previous_day5,direct_radiation_previous_day6,cloud_cover_previous_day6,direct_radiation_previous_day7,cloud_cover_previous_day7&models=' || split_part(r.model, '@', 1)
      when r.model like '%@0'
      then 'https://previous-runs-api.open-meteo.com/v1/forecast?hourly=direct_radiation,cloud_cover&models=' || split_part(r.model, '@', 1)
      else 'https://previous-runs-api.open-meteo.com/v1/forecast?hourly=direct_radiation_previous_day1,cloud_cover_previous_day1&models=' || r.model end
      || '&latitude=' || p.lat || '&longitude=' || p.lng || case when r.kind in ('run', 'layr') then '&forecast_days=2'
                 else '&start_date=' || r.start_date || '&end_date=' || r.end_date end || '&timezone=UTC';
    update replay_fetch set req_id = net.http_get(v_url, timeout_milliseconds := 30000), status = 'sent', updated_at = now() where id = r.id;
    n_sent := n_sent + 1;
  end loop;

  if not exists (select 1 from replay_fetch where status in ('queued', 'sent')) then
    perform cron.unschedule('replay-fetch');
  end if;
  return jsonb_build_object('parsed', n_done, 'sent', n_sent);
end $function$
;
-- Teton cell, one ECMWF run per day: both winters, both autumns, October 2026.
insert into replay_fetch (kind, model, point_key, start_date, end_date)
select 'layr', 'ecmwf_ifs', 'fc:43.7500000000000000,-110.7500000000000000', d::date, d::date
  from (select generate_series(s, e, interval '1 day') d
          from (values ('2024-11-29'::date, '2025-02-01'::date), ('2025-11-29', '2026-02-01'), ('2026-09-27', '2026-10-29'),
                       ('2024-09-30', '2024-11-28'), ('2025-09-30', '2025-11-28')) v(s, e)) g
 where not exists (select 1 from replay_fetch f where f.kind = 'layr' and f.point_key like 'fc:43.75%' and f.start_date = g.d::date);
