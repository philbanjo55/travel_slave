-- Practice (training) trips show the main trip's stop photos, read only (Phil, 12 Nov 2026: "They're on the
-- normal itinerary just not on the live test trips"). For each stop of a practice copy: the photos of its twin
-- stop on the main trip (training_copy_map kind 'stop'). No rows are copied: the app's photo delete also
-- removes the file, so a copied row could have taken a real photo with it. Empty for a trip that is not a copy.
create or replace function public.training_stop_photos(p_trip uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'copy_stop_id', m.new_id, 'id', p.id, 'stop_id', p.stop_id, 'storage_url', p.storage_url,
           'position', p.position, 'photo_type', p.photo_type, 'caption', p.caption)
           order by m.new_id, p.position nulls last, p.created_at), '[]'::jsonb)
    from trips t
    join training_copy_map m on m.trip_id = t.id and m.kind = 'stop'
    join stops c on c.id = m.new_id and c.trip_id = t.id
    join stop_photos p on p.stop_id = m.old_id
   where t.id = p_trip and t.training_of is not null and p.storage_url is not null;
$$;
revoke all on function public.training_stop_photos(uuid) from public;
grant execute on function public.training_stop_photos(uuid) to anon, authenticated, service_role;
