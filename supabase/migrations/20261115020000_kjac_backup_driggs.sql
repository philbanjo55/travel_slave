-- Driggs (KDIJ) as a stand-in for Jackson Hole airport (KJAC), which stopped reporting at 23:00 UTC 13 Nov 2026
-- (Phil, 14 Nov: "set up the Driggs backup now just in case"). Checked on 131 shared daylight hours (29 Sep - 12 Oct
-- 2026): when Driggs reports cloud below 7,000 ft (or fog / visibility < 1 km) Jackson agreed every time; when Driggs
-- reports clear, Jackson was still hidden 22 times (Driggs, west of the range, misses Jackson-side cloud). So Driggs
-- counts only as "hidden", only in hours KJAC sent nothing, and only from 14 Nov 2026 (the fitted odds, learned from
-- data before 30 Jun 2026, stay exactly as they are). Undo: update replay_places set backup_station = null.

alter table public.replay_places add column if not exists backup_station text, add column if not exists backup_ceiling_ft integer;
update public.replay_places set backup_station = 'KDIJ', backup_ceiling_ft = 7000 where station = 'KJAC';

-- the backup station's reports are fetched like the trip's own
create or replace function public.active_metar_stations()
 returns setof text
 language sql
 stable
 set search_path to 'public'
as $function$
  select distinct upper(coalesce(nullif(trim(t.metar_station), ''), d.metar_station))
  from days d join trips t on t.id = d.trip_id
  where t.archived is not true
    and (t.end_date is null or t.end_date >= current_date)
    and coalesce(nullif(trim(t.metar_station), ''), d.metar_station) is not null
    and coalesce(nullif(trim(t.metar_station), ''), d.metar_station) <> '-'
  union
  select distinct upper(p.backup_station) from replay_places p where p.backup_station is not null
$function$;

create or replace view public.replay_hidden_obs as
 SELECT p.trip_id,
    m.hr,
    ((COALESCE((m.ceiling_ft < p.ceiling_ft), false) OR COALESCE((m.visibility_m < 1000), false) OR COALESCE(m.fog, false)))::integer AS hidden
   FROM (replay_places p
     JOIN metar_history m ON ((m.station = p.station)))
UNION ALL
 SELECT p.trip_id,
    o.hr,
    ((COALESCE((o.ceiling_ft < p.ceiling_ft), false) OR COALESCE((o.visibility_m < (1000)::double precision), false) OR COALESCE(o.fog, false)))::integer AS hidden
   FROM (replay_places p
     JOIN station_obs_hourly o ON ((o.station = p.station)))
  WHERE ((o.hr >= '2026-09-01 00:00:00+00'::timestamp with time zone) AND (NOT (EXISTS ( SELECT 1
           FROM metar_history m
          WHERE ((m.station = p.station) AND (m.hr = o.hr))))))
UNION ALL
 SELECT p.trip_id,
    o.hr,
    1 AS hidden
   FROM (replay_places p
     JOIN station_obs_hourly o ON ((o.station = p.backup_station)))
  WHERE ((p.backup_station IS NOT NULL) AND (o.hr >= '2026-11-14 00:00:00+00'::timestamp with time zone)
    AND (COALESCE((o.ceiling_ft < p.backup_ceiling_ft), false) OR COALESCE((o.visibility_m < (1000)::double precision), false) OR COALESCE(o.fog, false))
    AND (NOT (EXISTS ( SELECT 1 FROM station_obs_hourly k WHERE ((k.station = p.station) AND (k.hr = o.hr)))))
    AND (NOT (EXISTS ( SELECT 1 FROM metar_history m WHERE ((m.station = p.station) AND (m.hr = o.hr))))));
