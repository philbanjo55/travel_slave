-- Linked stops share one photo pool: repeat visits to the same place show
-- every photo taken for any of them. Each photo stays on the stop it was
-- added to; only the stops are marked with the same photo_group. Unlink by
-- setting photo_group back to null.
alter table public.stops add column if not exists photo_group text;

with g(prefix, grp) as (values
  ('dcd33b48', 'bour'),        -- Day 1 Bøur — West Viewpoint
  ('274d7ebd', 'bour'),        -- Day 1 Bøur — Panoramic Viewpoint
  ('c6f628df', 'bour'),        -- Day 3 Bøur — Evening
  ('3c04d72e', 'drangarnir'),  -- Day 2 Drangarnir - Golden Hour Landing
  ('3624a6dd', 'drangarnir'),  -- Day 4 Drangarnir — Guided
  ('f50d1a93', 'mulafossur'),  -- Day 1 Múlafossur
  ('62033a57', 'mulafossur')   -- Day 4 Vágar — Evening
)
update public.stops s set photo_group = g.grp
  from g
 where s.trip_id = 'e04fbc9d-86b1-42b2-bf08-fc65a18e665d' and left(s.id::text, 8) = g.prefix;

-- One running order per group and photo type: the earliest stop's photos
-- first, each stop's own order kept.
with ordered as (
  select ph.id, row_number() over (
           partition by s.photo_group, coalesce(ph.photo_type, 'reference')
           order by d.day_number, s.position, ph.position, ph.created_at) - 1 as pos
    from public.stop_photos ph
    join public.stops s on s.id = ph.stop_id
    join public.days d on d.id = s.day_id
   where s.trip_id = 'e04fbc9d-86b1-42b2-bf08-fc65a18e665d' and s.photo_group is not null
)
update public.stop_photos ph set position = o.pos from ordered o where o.id = ph.id;
