-- Walk mode has no distance limit now (Phil, 18 Nov 2026: "as far as I want"): saving a walked-to spot is allowed up to
-- 50 km from the old stand spot (was 1 km; 50 km only guards against a wrong-coordinates mistake).
CREATE OR REPLACE FUNCTION public.sun_vantage_move(p_stop_id uuid, p_vantage_id uuid, p_lat double precision, p_lng double precision)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  if v_m > 50000 then
    raise exception 'That is % m from the stand spot: walk mode moves it 50 km at most. Use Edit vantages for a bigger move.', round(v_m);
  end if;
  update public.scout_vantages set lat = p_lat, lng = p_lng, updated_at = now() where id = p_vantage_id;
  return public.sun_pair_check(p_vantage_id);
end $function$
;
