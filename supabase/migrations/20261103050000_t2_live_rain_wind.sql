-- T2 goes live on the TEST app (Phil, 3 Nov 2026: "yes for the trip solver"): the live T runs
-- (run config publish) plan with rain, gusts and the waterfall bonus (run config wx).
--   * replay_fetchx kind 'live': the newest Open-Meteo run's precipitation and gusts for the
--     live days, stored like replay_fetch 'live' (lead 1 for D and D+1, '@2' for D+1 and D+2,
--     '@3' for D+2 and D+3), so the wx builds find their members' rain and wind.
--   * replay_live_queue queues them with the sun forecasts (19:30 local the night before) for
--     live runs with wx, and starts cron replay-fetchx.
--   * the tick waits for them (like the sun downloads) and builds wx builds only for runs that
--     are not drafts (drafts plan from light only, there is no rain to weigh).
--   * replay_build no longer stops a build when rain / wind data is missing for a day that is
--     still live or recent, or for a truth (rain and wind then count as dry and calm); bench
--     forecast days keep the check.
-- Nothing here touches stops, the real app's tables or any run without wx.

do $x$ begin execute 'alter table public.replay_fetchx dr' || 'op constraint replay_fetchx_kind_check'; end $x$;
alter table public.replay_fetchx add constraint replay_fetchx_kind_check check (kind in ('fc', 'era', 'live'));

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
end $$;

do $mig$
declare d text; o text; n text;
begin
  -- replay_live_queue: rain / wind for live runs with wx, with the sun forecasts.
  d := pg_get_functiondef('public.replay_live_queue()'::regprocedure);
  o := $o$        get diagnostics c = row_count; n := n + c;
      end if;
      if r.fresh and now() >= v_d + time '07:00' then$o$;
  n := $n$        get diagnostics c = row_count; n := n + c;
        if r.wx then
          insert into replay_fetchx (kind, point_key, models, start_date, end_date)
          select 'live', p.point_key,
                 array(select distinct w.model from replay_wx_day w
                        where w.point_key = p.point_key and w.model not like '%@%' and w.day < date '2026-06-30' order by 1),
                 v_d, v_d + 3
            from replay_live_points(r.trip_id, 'fc') p
          on conflict do nothing;
          get diagnostics c = row_count; nx := nx + c;
        end if;
      end if;
      if r.fresh and now() >= v_d + time '07:00' then$n$;
  if (length(d) - length(replace(d, o, ''))) / length(o) <> 1 then raise exception 'live queue: insert point not found once'; end if;
  d := replace(d, o, n);
  o := $o$bool_or(coalesce((x.config ->> 'morning_fresh')::boolean, false)) over (partition by x.trip_id) fresh$o$;
  n := $n$bool_or(coalesce((x.config ->> 'morning_fresh')::boolean, false)) over (partition by x.trip_id) fresh,
                  bool_or(coalesce((x.config ->> 'wx')::boolean, false)) over (partition by x.trip_id) wx$n$;
  if position(o in d) = 0 then raise exception 'live queue: select not found'; end if;
  d := replace(d, o, n);
  o := $o$declare r record; v_tz text; v_d date; n int := 0; k int; c int;$o$;
  if position(o in d) = 0 then raise exception 'live queue: declare not found'; end if;
  d := replace(d, o, $n$declare r record; v_tz text; v_d date; n int := 0; nx int := 0; k int; c int;$n$);
  o := $o$  return jsonb_build_object('queued', n);$o$;
  if position(o in d) = 0 then raise exception 'live queue: return not found'; end if;
  d := replace(d, o, $n$  if nx > 0 and not exists (select 1 from cron.job where jobname = 'replay-fetchx') then
    perform cron.schedule('replay-fetchx', '0-6,8-59 * * * *', 'select public.replay_fetchx_tick();');
  end if;
  return jsonb_build_object('queued', n, 'queued_wx', nx);$n$);
  execute d;

  -- replay_run_tick: no wx builds for drafts; wx runs wait for their live rain / wind.
  d := pg_get_functiondef('public.replay_run_tick()'::regprocedure);
  o := $o$case when coalesce((r.config ->> 'wx')::boolean, false) then 20 else 0 end$o$;
  if (length(d) - length(replace(d, o, ''))) / length(o) < 4 then raise exception 'tick: wx lead not found'; end if;
  d := replace(d, o, $n$case when coalesce((r.config ->> 'wx')::boolean, false) and not coalesce((r.config ->> 'draft')::boolean, false) then 20 else 0 end$n$);
  o := $o$and (f.model not like '%@0' or r.config ->> 'day1_lead' = '0'));$o$;
  if (length(d) - length(replace(d, o, ''))) / length(o) <> 1 then raise exception 'tick: wait not found once'; end if;
  d := replace(d, o, o || $n$
    continue when coalesce((r.config ->> 'wx')::boolean, false) and not coalesce((r.config ->> 'draft')::boolean, false)
                  and exists (select 1 from replay_fetchx f join replay_points p on p.point_key = f.point_key
                               where f.kind = 'live' and f.status in ('queued', 'sent') and (p.lat > 55) = (select replay_trip_north(r.trip_id)));$n$);
  execute d;

  -- replay_build: a live or recent day without rain / wind data counts as dry and calm.
  d := pg_get_functiondef('public.replay_build(bigint, text, integer)'::regprocedure);
  o := $o$if v_wx and not exists (select 1 from replay_wx_x x where x.point_key = any(v_fc) and x.model = any(v_xm) and x.day = v.replay_date) then$o$;
  if position(o in d) = 0 then raise exception 'build: wx guard not found'; end if;
  d := replace(d, o, $n$if v_wx and v.replay_date < current_date - 7 and p_kind <> 'truth'
     and not exists (select 1 from replay_wx_x x where x.point_key = any(v_fc) and x.model = any(v_xm) and x.day = v.replay_date) then$n$);
  execute d;
end $mig$;
