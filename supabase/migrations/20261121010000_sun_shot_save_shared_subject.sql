-- "Same subject as ..." refused shots whose subject row belongs to another trip
-- (13 Nov 2026 pin fixes pointed real-trip shots at summit subjects owned by
-- Teton Live, e.g. Cunningham C1 -> Mount Moran). A subject is now accepted
-- when it is this trip's own or is already aimed at by a shot on this trip.
create or replace function public.sun_shot_save(p_stop_id uuid, p_vantage_id uuid, p_name text, p_v_lat double precision, p_v_lng double precision, p_s_lat double precision, p_s_lng double precision, p_s_height double precision, p_subject_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_trip uuid;
  v_subject uuid;
  v_vantage uuid := p_vantage_id;
  v_name text := nullif(btrim(p_name), '');
begin
  select trip_id into v_trip from public.stops where id = p_stop_id;
  if v_trip is null then raise exception 'Stop not found'; end if;
  if v_name is null then raise exception 'The shot needs a name'; end if;
  if length(v_name) > 120 then raise exception 'The name is too long'; end if;
  if p_v_lat is null or p_v_lng is null or p_s_lat is null or p_s_lng is null
     or abs(p_v_lat) > 90 or abs(p_s_lat) > 90 or abs(p_v_lng) > 180 or abs(p_s_lng) > 180 then
    raise exception 'Coordinates are missing or out of range';
  end if;
  if p_s_height is not null and (p_s_height < 0 or p_s_height > 3000) then raise exception 'Height must be 0 to 3000 m'; end if;

  if v_vantage is not null then
    if not exists (select 1 from public.stop_sun_pairs where stop_id = p_stop_id and vantage_id = v_vantage) then
      raise exception 'That shot is not on this stop';
    end if;
    select subject_id into v_subject from public.scout_vantages where id = v_vantage;
    update public.scout_subjects
       set lat = p_s_lat, lng = p_s_lng, height_m = p_s_height, updated_at = now(),
           name = case when (select count(*) from public.scout_vantages where subject_id = v_subject) = 1 then v_name else name end
     where id = v_subject;
    update public.scout_vantages
       set shot_name = v_name, lat = p_v_lat, lng = p_v_lng, updated_at = now(),
           code = coalesce(code, public.sun_next_code(p_stop_id))
     where id = v_vantage;
  else
    if p_subject_id is not null then
      select s.id into v_subject from public.scout_subjects s
       where s.id = p_subject_id
         and (s.trip_id = v_trip
              or exists (select 1 from public.scout_vantages v
                           join public.stop_sun_pairs sp on sp.vantage_id = v.id
                           join public.stops st on st.id = sp.stop_id
                          where v.subject_id = s.id and st.trip_id = v_trip));
      if v_subject is null then raise exception 'That subject is not in this trip'; end if;
      update public.scout_subjects
         set lat = p_s_lat, lng = p_s_lng, height_m = coalesce(p_s_height, height_m), updated_at = now()
       where id = v_subject;
    else
      insert into public.scout_subjects (trip_id, name, lat, lng, height_m)
      values (v_trip, v_name, p_s_lat, p_s_lng, p_s_height) returning id into v_subject;
    end if;
    insert into public.scout_vantages (subject_id, code, name, shot_name, lat, lng)
    values (v_subject, public.sun_next_code(p_stop_id), v_name, v_name, p_v_lat, p_v_lng)
    returning id into v_vantage;
    insert into public.stop_sun_pairs (stop_id, vantage_id, position)
    values (p_stop_id, v_vantage,
            coalesce((select max(position) + 1 from public.stop_sun_pairs where stop_id = p_stop_id), 0));
  end if;

  return public.sun_pair_check(v_vantage);
end $function$;
