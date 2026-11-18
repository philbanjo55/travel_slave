-- DRAFT, NOT APPLIED. Faroes 3D: sea-stack tops (14 Nov 2026), after 20261114050000_terrain_faroes_2015.
-- The 2 m DSM shaves thin tops; tools/sun3d/faroes/stack_tops.py raises each stack's own top (cells above half its height,
-- connected to the top; shore and lower cliffs untouched) to: Stóri Drangur 72 m (2009 contour ring 72 m (published ~70)), Risin 71 m (published 71 m (2009 contour 68)), Kellingin 68 m (published 68 m (2009 contour 62)), Tindhólmur 262 m (published 262 m).
-- Lítli Drangur stays at 28 m. The arch through Stóri Drangur cannot be drawn (height field).
-- Before applying: upload the 10 files of stack_tops_upload.txt to the public bucket `terrain` (new names).

update public.terrain_regions set path = 'faroes_dsm15_wide_st.png', bytes = 862949 where id = 'faroes' and path = 'faroes_dsm15_wide.png';
update public.terrain_range_regions set path = 'for15_bour_viewpoint_st.png', bytes = 1010088 where id = 'for15_bour_viewpoint' and path = 'for15_bour_viewpoint.png';
update public.terrain_range_regions set path = 'for15_drangarnir_guided_st.png', bytes = 1064635 where id = 'for15_drangarnir_guided' and path = 'for15_drangarnir_guided.png';
update public.terrain_range_regions set path = 'for15_eidiskollur_summit_above_st.png', bytes = 634883 where id = 'for15_eidiskollur_summit_above' and path = 'for15_eidiskollur_summit_above.png';
update public.terrain_near_regions set path = 'fo_vagar_west_dsm15_st.png', bytes = 2314109 where id = 'fo_vagar_west' and path = 'fo_vagar_west_dsm15.png';
update public.terrain_near_regions set path = 'fo_streymoy_north_dsm15_st.png', bytes = 2538022 where id = 'fo_streymoy_north' and path = 'fo_streymoy_north_dsm15.png';
update public.terrain_detail_regions_v4 set path = 'fod15_tindholmur_landing_on_ground_st.png', bytes = 180933 where id = 'fod15_tindholmur_landing_on' and path = 'fod15_tindholmur_landing_on_ground.png';
update public.terrain_detail_regions_v4 set path = 'fod15_drangarnir_guided_ground_st.png', bytes = 404729 where id = 'fod15_drangarnir_guided' and path = 'fod15_drangarnir_guided_ground.png';
update public.terrain_detail_regions_v4 set path = 'fod15_drangarnir_golden_hour_ground_st.png', bytes = 214876 where id = 'fod15_drangarnir_golden_hour' and path = 'fod15_drangarnir_golden_hour_ground.png';
update public.terrain_detail_regions_v4 set path = 'fod15_eidiskollur_summit_above_ground_st.png', bytes = 330851 where id = 'fod15_eidiskollur_summit_above' and path = 'fod15_eidiskollur_summit_above_ground.png';
