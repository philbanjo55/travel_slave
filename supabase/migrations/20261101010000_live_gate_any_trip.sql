-- The bench tick told the Faroes from Wyoming by the real Faroes trip's id (points north of 55 deg
-- belong to trip e04fbc9d...). The 🧪 Faroes Live copy (and any later Faroes copy) is also north,
-- so its live T run (app_T, 1-4 Nov) never passed the "forecast downloaded" gate and made no
-- evening plan on 31 Oct. Now each check asks where the trip itself is (its stops' mean latitude).
create or replace function public.replay_trip_north(p_trip uuid)
returns boolean language sql stable set search_path to 'public' as $$
  select coalesce(avg(s.lat), 0) > 55 from stops s where s.trip_id = p_trip and s.lat is not null
$$;
revoke all on function public.replay_trip_north(uuid) from public, anon, authenticated;

do $$
declare d text; k int;
begin
  d := pg_get_functiondef('public.replay_run_tick()'::regprocedure);
  k := (length(d) - length(replace(d, $o$(r.trip_id = 'e04fbc9d-86b1-42b2-bf08-fc65a18e665d')$o$, ''))) / length($o$(r.trip_id = 'e04fbc9d-86b1-42b2-bf08-fc65a18e665d')$o$);
  if k <> 3 then raise exception 'r.trip_id checks: found %', k; end if;
  d := replace(d, $o$(r.trip_id = 'e04fbc9d-86b1-42b2-bf08-fc65a18e665d')$o$, $n$(select replay_trip_north(r.trip_id))$n$);
  k := (length(d) - length(replace(d, $o$(pl.trip_id = 'e04fbc9d-86b1-42b2-bf08-fc65a18e665d')$o$, ''))) / length($o$(pl.trip_id = 'e04fbc9d-86b1-42b2-bf08-fc65a18e665d')$o$);
  if k <> 2 then raise exception 'pl.trip_id checks: found %', k; end if;
  d := replace(d, $o$(pl.trip_id = 'e04fbc9d-86b1-42b2-bf08-fc65a18e665d')$o$, $n$replay_trip_north(pl.trip_id)$n$);
  execute d;
end $$;
