-- T learns from the days just lived (Phil, 3 Nov 2026: "do all 3"). Run config `learn`
-- (build lead + 40): the hidden-peaks odds per model and cloud bin, which otherwise come only
-- from the other seasons' history (replay_hidden_fit), are blended with how THIS season's last
-- 30 days before the planned day actually went (replay_hidden_truth: airport ceiling or the
-- place's truth camera), never the day itself or later: p = (K p_hist + hits) / (K + n),
-- K = min(history hours, 100), as the adaptive calibration does. On the bench each past week
-- only sees its own winter's earlier days, so the test is fair; live T runs see the practice
-- trip's real recent days. Morning re-plan odds (replay_morning_fit) are unchanged.

do $$
declare d text; o1 text; n1 text; o2 text; n2 text;
begin
  d := pg_get_functiondef('public.replay_build(bigint,text,integer)'::regprocedure);
  o1 := $o$  v_lead int := p_lead % 10; v_cal boolean := (p_lead % 20) >= 10; v_wx boolean := p_lead >= 20; v_xm text[];$o$;
  n1 := $n$  v_lead int := p_lead % 10; v_cal boolean := (p_lead % 20) >= 10; v_wx boolean := (p_lead % 40) >= 20; v_xm text[];
  v_learn boolean := p_lead >= 40; v_ltz text; v_fcp text; v_slat double precision; v_slng double precision;$n$;
  o2 := $o$     where trip_id = v.trip_id and season = v_season group by model having count(*) = 5) f;
  if p_kind in ('morning', 'morningf') then$o$;
  n2 := $n$     where trip_id = v.trip_id and season = v_season group by model having count(*) = 5) f;
  if v_learn and p_kind = 'forecast' then
    select coalesce(t.timezone, 'UTC'), p.fc_point, s.lat, s.lng into v_ltz, v_fcp, v_slat, v_slng
      from replay_places p join metar_stations s on s.icao = p.station join trips t on t.id = p.trip_id
     where p.trip_id = v.trip_id limit 1;
    select jsonb_object_agg(model, ps) into v_fit from (
      select f.model, jsonb_agg(case when r.n is null then f.p
                                     else ((least(f.n, 100)::double precision * f.p + r.hits) / (least(f.n, 100)::double precision + r.n))::real end
                                order by f.bin) ps
        from replay_hidden_fit f
        left join (
          select w.model, replay_cloud_bin(w.cloud[extract(hour from h.hr at time zone 'UTC')::int + 1]) bin,
                 count(*)::double precision n, sum(h.hidden)::double precision hits
            from (select distinct o.hr, o.hidden
                    from replay_hidden_truth o
                   where o.trip_id = v.trip_id
                     and o.hr >= ((v.replay_date - 30)::timestamp at time zone v_ltz)
                     and o.hr < (v.replay_date::timestamp at time zone v_ltz)
                     and replay_season((o.hr at time zone 'UTC')::date) = v_season
                     and (select sp.altitude from sun_position(o.hr, v_slat, v_slng) sp) > 0) h
            join replay_wx_day w on w.point_key = v_fcp and w.day = (h.hr at time zone 'UTC')::date
           where w.cloud[extract(hour from h.hr at time zone 'UTC')::int + 1] is not null
             and not exists (select 1 from replay_model_dups dm where dm.point_key = w.point_key and dm.model = w.model and dm.day = w.day)
           group by 1, 2) r on r.model = f.model and r.bin = f.bin
       where f.trip_id = v.trip_id and f.season = v_season
       group by f.model having count(*) = 5) x;
  end if;
  if p_kind in ('morning', 'morningf') then$n$;
  if position(o1 in d) = 0 then raise exception 'replay_build declare not found'; end if;
  if position(o2 in d) = 0 then raise exception 'replay_build fit not found'; end if;
  execute replace(replace(d, o1, n1), o2, n2);

  d := pg_get_functiondef('public.replay_run_tick()'::regprocedure);
  o1 := $o$+ case when coalesce((r.config ->> 'wx')::boolean, false) then 20 else 0 end;$o$;
  n1 := $n$+ case when coalesce((r.config ->> 'wx')::boolean, false) then 20 else 0 end
             + case when coalesce((r.config ->> 'learn')::boolean, false) then 40 else 0 end;$n$;
  if (length(d) - length(replace(d, o1, ''))) / length(o1) <> 1 then raise exception 'tick lead line: expected 1'; end if;
  execute replace(d, o1, n1);
end $$;
