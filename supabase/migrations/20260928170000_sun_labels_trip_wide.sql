-- Shot labels are unique across the whole trip, not just per stop: the
-- stop's first letter and the next free number for that letter anywhere in
-- the trip (three Bøur stops give B1, B2, B3... never three B1s), so a shot
-- linked into another stop can never clash with the shots already there.
-- Only shots shown on some stop count; old unused scouting pins don't.

create or replace function public.sun_code_letter(p_name text)
returns text language sql immutable as $function$
  select coalesce(upper((regexp_match(p_name, '[[:alpha:]]'))[1]), 'V');
$function$;

create or replace function public.sun_next_code(p_stop_id uuid)
returns text
language sql
stable security definer
set search_path to 'public'
as $function$
  with me as (select trip_id, public.sun_code_letter(name) as p from public.stops where id = p_stop_id),
  codes as (
    select distinct v.code
      from public.stop_sun_pairs sp
      join public.stops st on st.id = sp.stop_id
      join public.scout_vantages v on v.id = sp.vantage_id
     where st.trip_id = (select trip_id from me)
  )
  select me.p || (coalesce(max(substr(c.code, 2)::int) filter (
           where upper(left(c.code, 1)) = me.p and substr(c.code, 2) ~ '^[0-9]{1,6}$'), 0) + 1)
    from me left join codes c on true
   group by me.p;
$function$;
revoke all on function public.sun_next_code(uuid) from public, anon, authenticated;

-- Relabel a trip so every shot has a valid, trip-unique label. In trip order
-- (by the first stop that shows each shot) the first holder of a valid label
-- keeps it; the rest get their letter's next free number.
create or replace function public.sun_relabel_trip(p_trip_id uuid)
returns jsonb
language plpgsql
volatile security definer
set search_path to 'public'
as $$
declare
  r record;
  keep text[] := '{}';
  nxt jsonb := '{}';
  changes jsonb := '[]';
  n int;
  newc text;
begin
  create temp table _shots on commit drop as
    select distinct on (sp.vantage_id) sp.vantage_id, v.code, public.sun_code_letter(st.name) as letter,
           d.day_number, st.position as sp1, sp.position as sp2
      from public.stop_sun_pairs sp
      join public.stops st on st.id = sp.stop_id
      join public.days d on d.id = st.day_id
      join public.scout_vantages v on v.id = sp.vantage_id
     where st.trip_id = p_trip_id
     order by sp.vantage_id, d.day_number, st.position, sp.position;

  -- pass 1: keepers
  for r in select * from _shots order by day_number, sp1, sp2 loop
    if r.code is not null and upper(left(r.code, 1)) = r.letter and substr(r.code, 2) ~ '^[0-9]{1,6}$'
       and not (upper(r.code) = any(keep)) then
      keep := keep || upper(r.code);
    end if;
  end loop;
  -- next free number per letter, after the keepers
  for r in select letter, max(substr(k, 2)::int) as m
             from _shots s, unnest(keep) k where upper(left(k, 1)) = s.letter group by letter loop
    nxt := nxt || jsonb_build_object(r.letter, r.m + 1);
  end loop;
  -- pass 2: everyone else
  for r in select * from _shots order by day_number, sp1, sp2 loop
    if r.code is not null and upper(r.code) = any(keep) then
      keep := array_remove(keep, upper(r.code));   -- this shot is the keeper; later duplicates get new labels
      continue;
    end if;
    n := coalesce((nxt ->> r.letter)::int, 1);
    newc := r.letter || n;
    nxt := nxt || jsonb_build_object(r.letter, n + 1);
    update public.scout_vantages set code = newc where id = r.vantage_id;
    changes := changes || jsonb_build_object('vantage_id', r.vantage_id, 'from', r.code, 'to', newc);
  end loop;
  drop table _shots;
  return changes;
end $$;
revoke all on function public.sun_relabel_trip(uuid) from public, anon, authenticated;

select public.sun_relabel_trip('e04fbc9d-86b1-42b2-bf08-fc65a18e665d');
select public.sun_relabel_trip('7e57bed0-0000-4000-8000-000000000001');
