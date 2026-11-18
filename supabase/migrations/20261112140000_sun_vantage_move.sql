-- Walk mode in the 3D sun view (Phil, 12 Nov 2026): moves only the stand pin of a shot that is on the stop.
-- sun_shot_save would also rewrite the name and the subject's height (a null height wipes it), so walk mode gets
-- its own narrow door. At most 1 km per move. Applied live as sun_vantage_move.
create or replace function public.sun_vantage_move(p_stop_id uuid, p_vantage_id uuid, p_lat double precision, p_lng double precision)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_lat double precision;
  v_lng double precision;
  v_m double precision;
begin
  if p_lat is null or p_lng is null or abs(p_lat) > 90 or abs(p_lng) > 180 then
    raise exception 'Coordinates are missing or out of range';
  end if;
  if not exists (select 1 from public.stop_sun_pairs where stop_id = p_stop_id and vantage_id = p_vantage_id) then
    raise exception 'That shot is not on this stop';
  end if;
  select lat, lng into v_lat, v_lng from public.scout_vantages where id = p_vantage_id;
  v_m := sqrt(power((p_lat - v_lat) * 111132, 2) + power((p_lng - v_lng) * 111320 * cos(radians(v_lat)), 2));
  if v_m > 1000 then
    raise exception 'That is % m from the stand spot: walk mode moves it 1 km at most. Use Edit vantages for a bigger move.', round(v_m);
  end if;
  update public.scout_vantages set lat = p_lat, lng = p_lng, updated_at = now() where id = p_vantage_id;
  return public.sun_pair_check(p_vantage_id);
end $$;
revoke all on function public.sun_vantage_move(uuid, uuid, double precision, double precision) from public;
grant execute on function public.sun_vantage_move(uuid, uuid, double precision, double precision) to anon, authenticated, service_role;
