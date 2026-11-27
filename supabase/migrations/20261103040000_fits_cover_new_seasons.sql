-- The hidden-peaks, morning and sun fits are leave-one-season-out views: a season's odds come
-- from every OTHER season's counts. They only listed seasons that have counts of their own, so a
-- season with no history yet (2026: the October test weeks, both practice trips and the real
-- Grand Teton trip on 29 Dec 2026; 2027: the real Faroes trip) had no fit at all, and
-- replay_build fell back to the crude rule (peaks hidden = cloud above 70%, no morning
-- re-conditioning, raw sun). Found 3 Nov 2026 while testing W (learn). Now every season from a
-- trip's first one to next year gets a row; seasons without counts of their own use all of them.
-- Seasons that have counts are unchanged.

create or replace view public.replay_hidden_fit as
 WITH s AS (
         SELECT c.trip_id, generate_series(min(c.season), greatest(max(c.season), extract(year from current_date)::int + 1)) AS season
           FROM replay_hidden_counts c GROUP BY c.trip_id
        ), agg AS (
         SELECT s.trip_id, s.season, c.model, c.bin, sum(c.n) AS n, sum(c.hits) AS hits
           FROM s JOIN replay_hidden_counts c ON c.trip_id = s.trip_id AND c.season <> s.season
          GROUP BY s.trip_id, s.season, c.model, c.bin
        ), base AS (
         SELECT agg.trip_id, agg.season, agg.model,
            (sum(agg.hits))::real / (NULLIF(sum(agg.n), (0)::numeric))::double precision AS p0
           FROM agg GROUP BY agg.trip_id, agg.season, agg.model
        )
 SELECT a.trip_id, a.season, a.model, a.bin, a.n,
    (((a.hits)::double precision + (2)::double precision * b.p0) / ((a.n + 2))::double precision)::real AS p
   FROM agg a JOIN base b USING (trip_id, season, model);

create or replace view public.replay_morning_fit as
 WITH s AS (
         SELECT c.trip_id, generate_series(min(c.season), greatest(max(c.season), extract(year from current_date)::int + 1)) AS season
           FROM replay_morning_counts c GROUP BY c.trip_id
        ), agg AS (
         SELECT s.trip_id, s.season, c.model, c.m8, c.bin, sum(c.n) AS n, sum(c.hits) AS hits
           FROM s JOIN replay_morning_counts c ON c.trip_id = s.trip_id AND c.season <> s.season
          GROUP BY s.trip_id, s.season, c.model, c.m8, c.bin
        ), base AS (
         SELECT agg.trip_id, agg.season, agg.model, agg.m8,
            (sum(agg.hits))::real / (NULLIF(sum(agg.n), (0)::numeric))::double precision AS p0
           FROM agg GROUP BY agg.trip_id, agg.season, agg.model, agg.m8
        )
 SELECT a.trip_id, a.season, a.model, a.m8, a.bin, a.n,
    (((a.hits)::double precision + (2)::double precision * b.p0) / ((a.n + 2))::double precision)::real AS p
   FROM agg a JOIN base b USING (trip_id, season, model, m8);

create or replace view public.replay_sun_fit as
 WITH s AS (
         SELECT c.trip_id, generate_series(min(c.season), greatest(max(c.season), extract(year from current_date)::int + 1)) AS season
           FROM replay_sun_counts c GROUP BY c.trip_id
        ), agg AS (
         SELECT s.trip_id, s.season, c.model, c.bin, sum(c.n) AS n, sum(c.sum_r) AS sr
           FROM s JOIN replay_sun_counts c ON c.trip_id = s.trip_id AND c.season <> s.season
          GROUP BY s.trip_id, s.season, c.model, c.bin
        )
 SELECT trip_id, season, model, bin, n,
    ((sr + ((3)::numeric * (ARRAY[0.05, 0.2, 0.4, 0.6, 0.8, 0.95])[bin])::double precision) / ((n + 3))::double precision)::real AS p
   FROM agg;

-- Builds are cached until fitted_at changes: new fits, new builds.
update replay_places set fitted_at = now() where trip_id is not null;
