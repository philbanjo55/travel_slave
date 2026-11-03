-- Month-matched odds (Phil, 3 Nov 2026: "do all of these"). The hidden-peaks and morning fits
-- learn per month group: 1 = autumn (Sep-Nov), 0 = everything else (the winters, the Faroes Mays).
-- A day uses its own group's fit when that group has one, else group 0, so every fit that exists
-- today is unchanged (all existing counts are group 0) and Faroes Live in autumn keeps its May fit
-- until autumn data exists for it. Autumn 2024 / 2025 forecasts for the Teton cell come from
-- replay_fetch (queued 3 Nov) and KJAC METAR (loaded 2016-2025). The sun fits (calsun only, not
-- used by T) are left as they are.

create or replace function public.replay_month_group(p_day date)
returns smallint language sql immutable as $$
  select (case when extract(month from p_day) in (9, 10, 11) then 1 else 0 end)::smallint
$$;

alter table public.replay_hidden_counts add column if not exists mg smallint not null default 0;
alter table public.replay_morning_counts add column if not exists mg smallint not null default 0;
do $$ begin
  execute 'alter table public.replay_hidden_counts ' || 'dr' || 'op constraint replay_hidden_counts_pkey';
end $$;
alter table public.replay_hidden_counts add constraint replay_hidden_counts_pkey primary key (trip_id, season, mg, model, bin);

-- Views: leave one season out within the same month group; mg added as the last column.
create or replace view public.replay_hidden_fit as
 WITH g AS (
         SELECT c.trip_id, c.mg, min(c.season) AS lo, max(c.season) AS hi FROM replay_hidden_counts c GROUP BY c.trip_id, c.mg
        ), s AS (
         SELECT g.trip_id, g.mg, generate_series(g.lo, greatest(g.hi, extract(year from current_date)::int + 1)) AS season FROM g
        ), agg AS (
         SELECT s.trip_id, s.season, s.mg, c.model, c.bin, sum(c.n) AS n, sum(c.hits) AS hits
           FROM s JOIN replay_hidden_counts c ON c.trip_id = s.trip_id AND c.mg = s.mg AND c.season <> s.season
          GROUP BY s.trip_id, s.season, s.mg, c.model, c.bin
        ), base AS (
         SELECT agg.trip_id, agg.season, agg.mg, agg.model,
            (sum(agg.hits))::real / (NULLIF(sum(agg.n), (0)::numeric))::double precision AS p0
           FROM agg GROUP BY agg.trip_id, agg.season, agg.mg, agg.model
        )
 SELECT a.trip_id, a.season, a.model, a.bin, a.n,
    (((a.hits)::double precision + (2)::double precision * b.p0) / ((a.n + 2))::double precision)::real AS p, a.mg
   FROM agg a JOIN base b USING (trip_id, season, mg, model);

create or replace view public.replay_morning_fit as
 WITH g AS (
         SELECT c.trip_id, c.mg, min(c.season) AS lo, max(c.season) AS hi FROM replay_morning_counts c GROUP BY c.trip_id, c.mg
        ), s AS (
         SELECT g.trip_id, g.mg, generate_series(g.lo, greatest(g.hi, extract(year from current_date)::int + 1)) AS season FROM g
        ), agg AS (
         SELECT s.trip_id, s.season, s.mg, c.model, c.m8, c.bin, sum(c.n) AS n, sum(c.hits) AS hits
           FROM s JOIN replay_morning_counts c ON c.trip_id = s.trip_id AND c.mg = s.mg AND c.season <> s.season
          GROUP BY s.trip_id, s.season, s.mg, c.model, c.m8, c.bin
        ), base AS (
         SELECT agg.trip_id, agg.season, agg.mg, agg.model, agg.m8,
            (sum(agg.hits))::real / (NULLIF(sum(agg.n), (0)::numeric))::double precision AS p0
           FROM agg GROUP BY agg.trip_id, agg.season, agg.mg, agg.model, agg.m8
        )
 SELECT a.trip_id, a.season, a.model, a.m8, a.bin, a.n,
    (((a.hits)::double precision + (2)::double precision * b.p0) / ((a.n + 2))::double precision)::real AS p, a.mg
   FROM agg a JOIN base b USING (trip_id, season, mg, model, m8);

-- The fits count per month group; replay_build reads its day's group (else group 0).
do $$
declare d text; o text; n text;
begin
  d := pg_get_functiondef('public.replay_fit_hidden()'::regprocedure);
  o := 'insert into replay_hidden_counts (trip_id, season, model, bin, n, hits)';
  if position(o in d) = 0 then raise exception 'fit_hidden insert not found'; end if;
  d := replace(d, o, 'insert into replay_hidden_counts (trip_id, season, model, bin, n, hits, mg)');
  o := 'count(*), sum(h.hidden)' || E'\n' || '    from hrs h';
  if position(o in d) = 0 then raise exception 'fit_hidden select not found'; end if;
  d := replace(d, o, 'count(*), sum(h.hidden), replay_month_group((h.hr at time zone ''UTC'')::date)' || E'\n' || '    from hrs h');
  o := 'group by 1, 2, 3, 4;';
  if position(o in d) = 0 then raise exception 'fit_hidden group not found'; end if;
  d := replace(d, o, 'group by 1, 2, 3, 4, 7;');
  execute d;

  d := pg_get_functiondef('public.replay_fit_morning()'::regprocedure);
  o := 'insert into replay_morning_counts (trip_id, season, model, m8, bin, n, hits)';
  if position(o in d) = 0 then raise exception 'fit_morning insert not found'; end if;
  d := replace(d, o, 'insert into replay_morning_counts (trip_id, season, model, m8, bin, n, hits, mg)');
  o := 'count(*), sum(h.hidden)' || E'\n' || '    from hrs h';
  if position(o in d) = 0 then raise exception 'fit_morning select not found'; end if;
  d := replace(d, o, 'count(*), sum(h.hidden), replay_month_group((h.hr at time zone ''UTC'')::date)' || E'\n' || '    from hrs h');
  o := 'group by 1, 2, 3, 4, 5;';
  if position(o in d) = 0 then raise exception 'fit_morning group not found'; end if;
  d := replace(d, o, 'group by 1, 2, 3, 4, 5, 8;');
  execute d;

  d := pg_get_functiondef('public.replay_build(bigint,text,integer)'::regprocedure);
  o := 'v_learn boolean := p_lead >= 40;';
  if position(o in d) = 0 then raise exception 'build declare not found'; end if;
  d := replace(d, o, 'v_learn boolean := p_lead >= 40; v_mg smallint := 0; v_mmg smallint := 0;');
  o := '  select jsonb_object_agg(model, ps) into v_fit from (' || E'\n' ||
       '    select model, jsonb_agg(p order by bin) ps from replay_hidden_fit' || E'\n' ||
       '     where trip_id = v.trip_id and season = v_season group by model having count(*) = 5) f;';
  if position(o in d) = 0 then raise exception 'build fit not found'; end if;
  d := replace(d, o,
       '  -- Month group (v61 SQL, 3 Nov 2026): the day''s own group when it has a fit, else group 0.' || E'\n' ||
       '  v_mg := replay_month_group(v.replay_date);' || E'\n' ||
       '  if v_mg <> 0 and not exists (select 1 from replay_hidden_fit where trip_id = v.trip_id and season = v_season and mg = v_mg) then v_mg := 0; end if;' || E'\n' ||
       '  v_mmg := replay_month_group(v.replay_date);' || E'\n' ||
       '  if v_mmg <> 0 and not exists (select 1 from replay_morning_fit where trip_id = v.trip_id and season = v_season and mg = v_mmg) then v_mmg := 0; end if;' || E'\n' ||
       '  select jsonb_object_agg(model, ps) into v_fit from (' || E'\n' ||
       '    select model, jsonb_agg(p order by bin) ps from replay_hidden_fit' || E'\n' ||
       '     where trip_id = v.trip_id and season = v_season and mg = v_mg group by model having count(*) = 5) f;');
  o := '       where f.trip_id = v.trip_id and f.season = v_season' || E'\n';
  if position(o in d) = 0 then raise exception 'build learn not found'; end if;
  d := replace(d, o, '       where f.trip_id = v.trip_id and f.season = v_season and f.mg = v_mg' || E'\n');
  o := '         where trip_id = v.trip_id and season = v_season group by model, m8) a group by model) f;';
  if position(o in d) = 0 then raise exception 'build morning not found'; end if;
  d := replace(d, o, '         where trip_id = v.trip_id and season = v_season and mg = v_mmg group by model, m8) a group by model) f;');
  execute d;
end $$;
