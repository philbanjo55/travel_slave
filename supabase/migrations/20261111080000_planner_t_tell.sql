-- Tell T: is the note box switched on for this trip? (planner_t_trips.config.tell; off everywhere until Phil says go.)
-- The TEST app asks before it shows the box; the notes function refuses to store a note for a trip where it is off.
create or replace function public.planner_t_tell(p_trip uuid)
 returns boolean language sql stable security definer set search_path to 'public' as $function$
  select coalesce((select (config ->> 'tell')::boolean from planner_t_trips where trip_id = p_trip), false)
$function$;
grant execute on function public.planner_t_tell(uuid) to anon, authenticated;
