-- terrain_horizon read p.samples[i] once per sample, and every subscript on
-- a TOASTed 25,560-element array detoasts the whole array: ~4.5 s per call,
-- ~9 s per vantage_light day. Unnesting once gives bit-identical skylines
-- (checked on 6 profiles at three observer heights) in ~40 ms.
create or replace function public.terrain_horizon(p_profile uuid, p_observer_m double precision)
returns double precision[] language sql stable set search_path = public as $$
  select array_agg(h order by a) from (
    select (u.i - 1) / 142 as a,
           max(degrees(atan2(
             u.v - p_observer_m
               - (dd.d[((u.i - 1) % 142) + 1] ^ 2) / (2 * 6371008.8) * (1 - 0.13),
             dd.d[((u.i - 1) % 142) + 1]))) as h
    from public.terrain_profiles p
    cross join lateral unnest(p.samples) with ordinality as u(v, i)
    cross join (select public.terrain_distances() as d) dd
    where p.id = p_profile and p.status = 'complete'
    group by 1) x
$$;
drop function if exists public._terrain_horizon_v2(uuid, double precision);
