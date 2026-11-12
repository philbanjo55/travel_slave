-- 3D sun view: first Faroes elevation file (Phil, 12 Nov 2026: "start doing that section but for faroes").
-- One point every ~35 m over the main and northern islands: fine for wide views, soft for close subjects
-- (sea stacks, waterfalls). Sharper close-up areas are the Faroes step of the 3D story.
insert into public.terrain_regions (id, north, south, west, east, n, width_m, depth_m, base_m, step_m, path, bytes, ground, note)
values ('faroes', 62.42, 61.78, -7.72, -6.25, 2048, 76572, 71124, 0, 0.5, 'faroes_z12.png', 1092685, 'green',
        'Public terrarium tiles, zoom 12 (~35 m), sea floor flattened to 0. Spring trip: grass, rock, sea.')
on conflict (id) do nothing;
