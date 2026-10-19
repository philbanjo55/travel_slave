-- Link existing shots to another stop (no copies): a shot is one vantage row;
-- stop_sun_pairs says which stops show it. The sun is worked out for each
-- stop's own date and time, the terrain is shared.

-- Every shot in the stop's trip, for the "Add shots from other stops" list.
create or replace function public.sun_trip_shots(p_stop_id uuid)
returns jsonb
language sql
stable security definer
set search_path to 'public'
as $function$
  with me as (select trip_id from public.stops where id = p_stop_id),
  links as (
    select sp.vantage_id, sp.stop_id, st.name as stop_name, d.day_number, st.position as stop_pos, sp.position as pair_pos
      from public.stop_sun_pairs sp
      join public.stops st on st.id = sp.stop_id
      join public.days d on d.id = st.day_id
     where st.trip_id = (select trip_id from me)
  ),
  shots as (
    select l.vantage_id,
           bool_or(l.stop_id = p_stop_id) as on_this_stop,
           min(array[l.day_number, l.stop_pos, l.pair_pos]) as sort_key,
           jsonb_agg(distinct jsonb_build_object('stop_id', l.stop_id, 'name', l.stop_name, 'day', l.day_number)) as stops
      from links l group by l.vantage_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'vantage_id', v.id, 'code', v.code, 'shot_name', coalesce(v.shot_name, s.name),
           'photo_id', ph.id, 'photo_url', ph.storage_url,
           'on_this_stop', sh.on_this_stop, 'stops', sh.stops)
         order by sh.sort_key), '[]'::jsonb)
    from shots sh
    join public.scout_vantages v on v.id = sh.vantage_id
    join public.scout_subjects s on s.id = v.subject_id
    left join public.stop_photos ph on ph.id = v.photo_id;
$function$;

-- Link shots of the same trip to a stop, after the ones it already has.
create or replace function public.sun_pair_link(p_stop_id uuid, p_vantage_ids uuid[])
returns int
language plpgsql
volatile security definer
set search_path to 'public'
as $$
declare
  v_trip uuid;
  n int;
begin
  select trip_id into v_trip from public.stops where id = p_stop_id;
  if v_trip is null then raise exception 'Stop not found'; end if;
  with wanted as (
    select v.id, u.ord
      from unnest(p_vantage_ids) with ordinality u(id, ord)
      join public.scout_vantages v on v.id = u.id
     where exists (select 1 from public.stop_sun_pairs sp join public.stops st on st.id = sp.stop_id
                    where sp.vantage_id = v.id and st.trip_id = v_trip)
       and not exists (select 1 from public.stop_sun_pairs sp where sp.stop_id = p_stop_id and sp.vantage_id = v.id)
  ), base as (
    select coalesce(max(position) + 1, 0) as b from public.stop_sun_pairs where stop_id = p_stop_id
  )
  insert into public.stop_sun_pairs (stop_id, vantage_id, position)
  select p_stop_id, w.id, base.b + row_number() over (order by w.ord) - 1 from wanted w, base;
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.sun_trip_shots(uuid) from public;
revoke all on function public.sun_pair_link(uuid, uuid[]) from public;
grant execute on function public.sun_trip_shots(uuid) to anon, authenticated;
grant execute on function public.sun_pair_link(uuid, uuid[]) to anon, authenticated;

-- Prefill Vágar — Evening (day 4 catch-up) with every shot from the Bøur,
-- Múlafossur and Drangarnir stops, in trip order.
select public.sun_pair_link(
  (select id from public.stops where trip_id = 'e04fbc9d-86b1-42b2-bf08-fc65a18e665d' and left(id::text, 8) = '62033a57'),
  (select array_agg(vantage_id order by k) from (
     select sp.vantage_id, min(array[d.day_number, st.position, sp.position]) as k
       from public.stop_sun_pairs sp
       join public.stops st on st.id = sp.stop_id
       join public.days d on d.id = st.day_id
      where st.trip_id = 'e04fbc9d-86b1-42b2-bf08-fc65a18e665d'
        and st.photo_group in ('bour', 'mulafossur', 'drangarnir')
        and left(st.id::text, 8) <> '62033a57'
      group by sp.vantage_id) x));
