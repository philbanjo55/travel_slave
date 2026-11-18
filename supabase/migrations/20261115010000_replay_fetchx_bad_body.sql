-- replay_fetchx_tick: a 200 answer whose body is not JSON is retried instead of failing the whole tick (15 Nov 2026).
CREATE OR REPLACE FUNCTION public.replay_fetchx_tick()
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
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
      -- 15 Nov 2026: Open-Meteo once answered 200 with 'Unexpected error while streaming data: timeoutReached';
      -- the cast failed every minute and blocked the queue. A body that is not JSON is retried (6 tries), then failed.
      begin
        c := r.content::jsonb;
      exception when others then
        update replay_fetchx set status = case when r.tries < 6 then 'queued' else 'failed' end, tries = tries + 1,
               note = left('bad body: ' || coalesce(r.content, ''), 200), updated_at = now() where id = r.id;
        continue;
      end;
      one := cardinality(r.models) = 1;
      if r.kind = 'era' then
        insert into replay_wx_x (point_key, model, day, precip, gust)
        select r.point_key, 'era5', (t.v #>> '{}')::timestamp::date,
               array_agg((a.v #>> '{}')::real order by t.i), array_agg((b.v #>> '{}')::real order by t.i)
          from jsonb_array_elements(c->'hourly'->'time') with ordinality t(v, i)
          join jsonb_array_elements(c->'hourly'->'precipitation') with ordinality a(v, j) on a.j = t.i
          join jsonb_array_elements(c->'hourly'->'wind_gusts_10m') with ordinality b(v, k) on b.k = t.i
         group by 3 having count(*) = 24
        on conflict (point_key, model, day) do update set precip = excluded.precip, gust = excluded.gust;
      elsif r.kind = 'live' then
        -- The newest run of each model, as replay_fetch 'live' stores the sun.
        foreach m in array r.models loop
          v_pr := 'precipitation' || case when one then '' else '_' || m end;
          v_gu := 'wind_gusts_10m' || case when one then '' else '_' || m end;
          insert into replay_wx_x (point_key, model, day, precip, gust)
          select r.point_key, m || case l.lead when 1 then '' else '@' || l.lead end, x.day, x.pr, x.gu
            from (select (t.v #>> '{}')::timestamp::date as day,
                         array_agg((a.v #>> '{}')::real order by t.i) pr, array_agg((b.v #>> '{}')::real order by t.i) gu
                    from jsonb_array_elements(c->'hourly'->'time') with ordinality t(v, i)
                    left join jsonb_array_elements(c->'hourly'->v_pr) with ordinality a(v, j) on a.j = t.i
                    left join jsonb_array_elements(c->'hourly'->v_gu) with ordinality b(v, k) on b.k = t.i
                   group by 1 having count(*) = 24 and (count(a.v #>> '{}') > 0 or count(b.v #>> '{}') > 0)) x
            join (values (1, 0), (1, 1), (2, 1), (2, 2), (3, 2), (3, 3)) l(lead, off) on x.day = r.start_date + l.off
          on conflict (point_key, model, day) do update set precip = excluded.precip, gust = excluded.gust;
        end loop;
      else
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

  for r in select * from replay_fetchx where status = 'queued' order by (kind = 'live') desc, tries, start_date desc, id limit 2 loop
    select * into p from replay_points where point_key = r.point_key;
    v_url := case when r.kind = 'era'
      then 'https://archive-api.open-meteo.com/v1/archive?hourly=precipitation,wind_gusts_10m'
      when r.kind = 'live'
      then 'https://previous-runs-api.open-meteo.com/v1/forecast?hourly=precipitation,wind_gusts_10m&models=' || array_to_string(r.models, ',')
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
end $function$;
