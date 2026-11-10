-- Faroes truth rule test (worksheet h5, Phil 9 Nov 2026: "Go"). Checked 9 Nov against 10 Faroes cameras
-- (1,070 labelled hours, 20 Oct - 9 Nov): the airport rule (EKVG ceiling under 2,000 ft = peaks hidden)
-- calls the peaks hidden 58% of daylight hours, the camera majority 24%; it agrees with the majority 57%
-- of hours, a 1,000 ft cutoff 78% (best for the Vagar cameras, 75%).
--
-- replay_places.vote_ceiling_ft: when set, the camera vote (replay_hidden_vote) counts the airport as
-- hidden below this cutoff instead of the place's ceiling_ft, both as the airport's own vote and as the
-- fallback for hours with fewer than 2 cameras (every past Faroes May). Set only on the real Faroes
-- trip's bench place, so: the bench judge truth_vote and the camera-vote odds (vfit, refit by hand) see
-- the 1,000 ft rule for Faroes test periods; today's planner (odds from replay_hidden_truth, ceiling_ft
-- 2000), Faroes Live, the Teton trips and every live run are unchanged (null = as before).
alter table public.replay_places add column if not exists vote_ceiling_ft int;

create or replace view public.replay_hidden_vote as
 WITH cams AS (
         SELECT p.trip_id, c.code
           FROM replay_places p
             JOIN metar_stations s ON s.icao = p.station
             JOIN webcam_cameras c ON c.lat IS NOT NULL AND sqrt(power((c.lat - s.lat) * 111::double precision, 2::double precision) + power((c.lng - s.lng) * 111::double precision * cos(radians(s.lat)), 2::double precision)) < 80::double precision
        ), votes AS (
         SELECT k.trip_id, l.taken_at AS hr, (NOT l.hills_visible)::integer AS hidden
           FROM cams k
             JOIN webcam_history_labels l ON l.camera_code = k.code
          WHERE l.status = 'done'::text AND l.hills_visible IS NOT NULL AND COALESCE(l.label, ''::text) <> ALL (ARRAY['dark'::text, 'camera_problem'::text])
        UNION ALL
         SELECT k.trip_id, f.captured_at, (NOT f.hills_visible)::integer AS int4
           FROM cams k
             JOIN webcam_frames f ON f.camera_code = k.code
          WHERE f.hills_visible IS NOT NULL AND NOT COALESCE(f.stale, false) AND COALESCE(f.label, ''::text) <> ALL (ARRAY['dark'::text, 'camera_problem'::text])
        ), agg AS (
         SELECT votes.trip_id, votes.hr, count(*) AS n, sum(votes.hidden) AS h
           FROM votes
          GROUP BY votes.trip_id, votes.hr
        )
 SELECT t.trip_id,
    t.hr,
        CASE
            WHEN a.n >= 2 THEN (((a.h + COALESCE(ap.hidden, 0)) * 2) >= (a.n +
            CASE
                WHEN ap.hidden IS NULL THEN 0
                ELSE 1
            END))::integer
            ELSE COALESCE(CASE WHEN pp.vote_ceiling_ft IS NOT NULL THEN v.hidden END, t.hidden)
        END AS hidden,
    COALESCE(a.n, 0::bigint) AS cams
   FROM replay_hidden_truth t
     JOIN replay_places pp ON pp.trip_id = t.trip_id
     LEFT JOIN agg a ON a.trip_id = t.trip_id AND a.hr = t.hr
     LEFT JOIN LATERAL ( SELECT x.hidden
           FROM replay_hidden_obs x
          WHERE x.trip_id = t.trip_id AND x.hr = t.hr
         LIMIT 1) o ON true
     LEFT JOIN LATERAL ( SELECT y.hidden FROM (
             SELECT 0 AS src, (COALESCE(m.ceiling_ft < pp.vote_ceiling_ft, false) OR COALESCE(m.visibility_m < 1000, false) OR COALESCE(m.fog, false))::integer AS hidden
               FROM metar_history m
              WHERE pp.vote_ceiling_ft IS NOT NULL AND m.station = pp.station AND m.hr = t.hr
             UNION ALL
             SELECT 1, (COALESCE(so.ceiling_ft < pp.vote_ceiling_ft, false) OR COALESCE(so.visibility_m < 1000::double precision, false) OR COALESCE(so.fog, false))::integer
               FROM station_obs_hourly so
              WHERE pp.vote_ceiling_ft IS NOT NULL AND so.station = pp.station AND so.hr = t.hr AND so.hr >= '2026-09-01 00:00:00+00'::timestamptz
             ) y ORDER BY y.src LIMIT 1) v ON true
     CROSS JOIN LATERAL (SELECT CASE WHEN pp.vote_ceiling_ft IS NOT NULL THEN v.hidden ELSE o.hidden END AS hidden) ap;

update public.replay_places set vote_ceiling_ft = 1000 where trip_id = 'e04fbc9d-86b1-42b2-bf08-fc65a18e665d';
