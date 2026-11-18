-- Worksheet C2 (Phil, 6 Nov 2026): replay_hidden_fit / replay_morning_fit were views recomputed on every
-- build (17 s and more each). Now stored (materialized) under the same names, refreshed by a statement
-- trigger whenever their counts table changes; the views stay as replay_*_fit_v. Rows checked identical (md5).
set statement_timeout = '40min';
insert into app_logs (level, message, data) select 'info', 'C2 fits before', jsonb_build_object(
  'hidden', (select md5(string_agg(t::text, '|' order by t::text)) from replay_hidden_fit t),
  'morning', (select md5(string_agg(t::text, '|' order by t::text)) from replay_morning_fit t));
create materialized view replay_hidden_fit_m as WITH g AS (
         SELECT c.trip_id,
            c.mg,
            c.hb,
            c.sb,
            min(c.season) AS lo,
            max(c.season) AS hi
           FROM replay_hidden_counts c
          GROUP BY c.trip_id, c.mg, c.hb, c.sb
        ), s AS (
         SELECT g.trip_id,
            g.mg,
            g.hb,
            g.sb,
            generate_series(g.lo, GREATEST(g.hi, EXTRACT(year FROM CURRENT_DATE)::integer + 1)) AS season
           FROM g
        ), agg AS (
         SELECT s.trip_id,
            s.season,
            s.mg,
            s.hb,
            s.sb,
            c.model,
            c.bin,
            sum(c.n) AS n,
            sum(c.hits) AS hits
           FROM s
             JOIN replay_hidden_counts c ON c.trip_id = s.trip_id AND c.mg = s.mg AND c.hb = s.hb AND c.sb = s.sb AND c.season <> s.season
          GROUP BY s.trip_id, s.season, s.mg, s.hb, s.sb, c.model, c.bin
        ), base AS (
         SELECT agg.trip_id,
            agg.season,
            agg.mg,
            agg.hb,
            agg.sb,
            agg.model,
            sum(agg.hits)::real / NULLIF(sum(agg.n), 0::numeric)::double precision AS p0
           FROM agg
          GROUP BY agg.trip_id, agg.season, agg.mg, agg.hb, agg.sb, agg.model
        )
 SELECT a.trip_id,
    a.season,
    a.model,
    a.bin,
    a.n,
    ((a.hits::double precision + 2::double precision * b.p0) / (a.n + 2)::double precision)::real AS p,
    a.mg,
    a.hb,
    a.sb
   FROM agg a
     JOIN base b USING (trip_id, season, mg, hb, sb, model);
create materialized view replay_morning_fit_m as WITH g AS (
         SELECT c.trip_id,
            c.mg,
            c.lk,
            c.ab,
            min(c.season) AS lo,
            max(c.season) AS hi
           FROM replay_morning_counts c
          GROUP BY c.trip_id, c.mg, c.lk, c.ab
        ), s AS (
         SELECT g.trip_id,
            g.mg,
            g.lk,
            g.ab,
            generate_series(g.lo, GREATEST(g.hi, EXTRACT(year FROM CURRENT_DATE)::integer + 1)) AS season
           FROM g
        ), agg AS (
         SELECT s.trip_id,
            s.season,
            s.mg,
            s.lk,
            s.ab,
            c.model,
            c.m8,
            c.bin,
            sum(c.n) AS n,
            sum(c.hits) AS hits
           FROM s
             JOIN replay_morning_counts c ON c.trip_id = s.trip_id AND c.mg = s.mg AND c.lk = s.lk AND c.ab = s.ab AND c.season <> s.season
          GROUP BY s.trip_id, s.season, s.mg, s.lk, s.ab, c.model, c.m8, c.bin
        ), base AS (
         SELECT agg.trip_id,
            agg.season,
            agg.mg,
            agg.lk,
            agg.ab,
            agg.model,
            agg.m8,
            sum(agg.hits)::real / NULLIF(sum(agg.n), 0::numeric)::double precision AS p0
           FROM agg
          GROUP BY agg.trip_id, agg.season, agg.mg, agg.lk, agg.ab, agg.model, agg.m8
        )
 SELECT a.trip_id,
    a.season,
    a.model,
    a.m8,
    a.bin,
    a.n,
    ((a.hits::double precision + 2::double precision * b.p0) / (a.n + 2)::double precision)::real AS p,
    a.mg,
    a.lk,
    a.ab
   FROM agg a
     JOIN base b USING (trip_id, season, mg, lk, ab, model, m8);
insert into app_logs (level, message, data) select 'info', 'C2 fits stored', jsonb_build_object(
  'hidden', (select md5(string_agg(t::text, '|' order by t::text)) from replay_hidden_fit_m t),
  'morning', (select md5(string_agg(t::text, '|' order by t::text)) from replay_morning_fit_m t),
  'hidden_rows', (select count(*) from replay_hidden_fit_m), 'morning_rows', (select count(*) from replay_morning_fit_m));
alter view replay_hidden_fit rename to replay_hidden_fit_v;
alter view replay_morning_fit rename to replay_morning_fit_v;
alter materialized view replay_hidden_fit_m rename to replay_hidden_fit;
alter materialized view replay_morning_fit_m rename to replay_morning_fit;
create index on replay_hidden_fit (trip_id, season, mg, hb);
create index on replay_morning_fit (trip_id, season, lk);
create or replace function replay_fits_refresh_hidden() returns trigger language plpgsql set search_path = public as $f$
begin refresh materialized view replay_hidden_fit; return null; end $f$;
create or replace function replay_fits_refresh_morning() returns trigger language plpgsql set search_path = public as $f$
begin refresh materialized view replay_morning_fit; return null; end $f$;
create trigger replay_hidden_counts_refresh after insert or update or delete or truncate on replay_hidden_counts
  for each statement execute function replay_fits_refresh_hidden();
create trigger replay_morning_counts_refresh after insert or update or delete or truncate on replay_morning_counts
  for each statement execute function replay_fits_refresh_morning();
-- The views add seasons up to next year from CURRENT_DATE: refresh both daily so a new year is covered.
select cron.schedule('replay-fits-refresh', '11 3 * * *', $c$set statement_timeout = '20min'; refresh materialized view replay_hidden_fit; refresh materialized view replay_morning_fit$c$);
insert into app_logs (level, message) values ('info', 'C2 fits switched');
