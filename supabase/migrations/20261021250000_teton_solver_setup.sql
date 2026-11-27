-- Grand Teton Winter 2026 (trip 5e247891-...): shots and suggested solver
-- settings, so the nightly solver can plan it. Phil asked for this to be set
-- up without him and confirmed afterwards (source = 'suggested').
--
-- Shots: 8 stops already had one. The other 21 get a shot standing at the
-- stop's coordinates (coord_confidence 'approximate') aimed at a shared
-- subject: Grand Teton summit, or Mount Moran for Oxbow Bend, Willow Flats,
-- Jackson Lake Dam and Colter Bay. Terrain profiles attach by trigger from
-- the grand_teton region grid.
--
-- Tiers and light are first guesses from time of day and planned minutes:
-- sunrise alpenglow stops want front light (sun behind the camera on the
-- peaks), historic buildings and wildlife take soft light too.

do $do$
declare
  v_trip uuid := '5e247891-d800-4d07-b5e0-8ad748ae2754';
  v_gt uuid; v_moran uuid;
  r record; v_vid uuid;
begin
  insert into scout_subjects (trip_id, name, lat, lng, coord_confidence, subject_kind, notes)
  values (v_trip, 'Grand Teton (summit)', 43.74108, -110.80239, 'confirmed', 'mountain', 'Shared aim point for Teton Range shots')
  returning id into v_gt;
  insert into scout_subjects (trip_id, name, lat, lng, coord_confidence, subject_kind, notes)
  values (v_trip, 'Mount Moran (summit)', 43.83500, -110.77630, 'confirmed', 'mountain', 'Shared aim point for Oxbow / Jackson Lake shots')
  returning id into v_moran;

  for r in
    select s.id, s.name, s.lat, s.lng from stops s
     where s.trip_id = v_trip and coalesce(s.shot_type, '') <> 'logistics' and s.lat is not null
       and not exists (select 1 from stop_sun_pairs p where p.stop_id = s.id)
  loop
    insert into scout_vantages (subject_id, name, shot_name, lat, lng, coord_confidence, verdict, notes)
    values (case when r.name ~ '^(Oxbow Bend|Willow Flats|Jackson Lake Dam|Colter Bay)' then v_moran else v_gt end,
            'main', 'main', r.lat, r.lng, 'approximate', 'pending', 'Stand spot = stop location (suggested by Claude)')
    returning id into v_vid;
    insert into stop_sun_pairs (stop_id, vantage_id, position) values (r.id, v_vid, 0);
  end loop;

  insert into solver_stop_settings (stop_id, tier, light_wanted, time_locked, source, note)
  select s.id, x.tier, x.light, false, 'suggested', 'Suggested by Claude from time of day and planned minutes; confirm or change'
    from stops s
    join (values
      ('Snake River Overlook — Sunrise',      'GOD', '{front}'::text[]),
      ('T.A. Moulton Barn',                   'GOD', '{front}'),
      ('Oxbow Bend — Sunrise',                'GOD', '{front}'),
      ('Taggart Lake',                        'S',   '{front}'),
      ('John Moulton Barn + Pink House',      'S',   '{front,side,soft}'),
      ('Chapel of the Transfiguration',       'S',   '{front,side,soft}'),
      ('Driggs — ID-33 Farm Pullouts',        'S',   '{front}'),
      ('Colter Bay — Jackson Lake',           'S',   '{side,back}'),
      ('Teton Glacier Turnout',               'A',   '{front}'),
      ('South Jenny Lake — East Shore',       'A',   '{front,side}'),
      ('Oxbow Bend — Afternoon',              'A',   '{front,side}'),
      ('National Elk Refuge — Miller Butte',  'A',   '{front,side,soft}'),
      ('Cunningham Cabin — Window',           'A',   '{front,side,soft}'),
      ('Snake River Overlook — Reshoot',      'A',   '{front,side}'),
      ('Tetonia — ID-33 Overlook',            'A',   '{side,soft}'),
      ('Glacier View Turnout — Last Look',    'A',   '{front,side}'),
      ('Glacier View Turnout',                'B',   '{front,side}'),
      ('Teton Point Turnout',                 'B',   '{front,side}'),
      ('Teton Point Turnout — Reshoot',       'B',   '{front,side}'),
      ('Cunningham Cabin',                    'B',   '{front,side,soft}'),
      ('Elk Ranch Flats',                     'B',   '{front,side}'),
      ('Menor''s Ferry',                      'B',   '{front,side,soft}'),
      ('Shane Cabins + Gros Ventre River',    'B',   '{front,side,soft}'),
      ('Blacktail Ponds Overlook',            'B',   '{front,side}'),
      ('Oxbow Bend — Late Morning',           'B',   '{front,side}'),
      ('Willow Flats Overlook',               'B',   '{front,side}'),
      ('Jackson Lake Dam',                    'B',   '{front,side}'),
      ('Bates Bridge — Teton River',          'B',   '{front,side,soft}'),
      ('Snake River Overlook — Scout',        'C',   '{front,side,soft}')
    ) x(name, tier, light) on x.name = s.name
   where s.trip_id = v_trip
  on conflict (stop_id) do nothing;
end $do$;
