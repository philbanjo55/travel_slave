-- Shane cabins (Wright homestead, 43.64389 -110.60472): the 2022 laser survey has the long collapsed log cabin
-- (8 x 11 m, ~16 m NW of the 'barn to teton' stand spot) and two roofless ruins (~6 x 7 m, 60-65 m north), but the
-- building finder skips structures without a roof. Added by hand (ids 990001-990003) to the park-wide house tile;
-- new file name so phones and the CDN fetch it fresh. Old file gtb2_6_4.json (133 buildings) left in the bucket.
update public.terrain_house_tiles
   set path = 'gtb2_6_4_v2.json', bytes = 25441, count = 136,
       note = coalesce(note || ' · ', '') || 'Shane cabins added by hand 22 Nov 2026 (roofless ruins the finder skipped)'
 where id = 'gtb2_6_4';
