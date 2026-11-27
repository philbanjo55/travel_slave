-- The trip's distinct spots, rounded exactly as solver_drive_matrix rounds
-- them (Postgres numeric rounding: half away from zero), so the edge
-- function and the view always agree on a spot's key. JS Math.round rounds
-- -6.9455 to -6.945, Postgres to -6.946.
create or replace function public.solver_trip_spots(p_trip_id uuid)
returns table(lat numeric, lng numeric)
language sql stable set search_path to 'public' as $$
  select distinct round(s.lat::numeric, 3), round(s.lng::numeric, 3)
    from public.stops s
   where s.trip_id = p_trip_id and s.lat is not null and s.lng is not null;
$$;
revoke execute on function public.solver_trip_spots(uuid) from public, anon, authenticated;
