#!/bin/bash
# Builds every Faroes elevation file for the 3D sun view into <work dir>/files:
#   faroes_adem32.png          the wide grid (terrain_regions 'faroes'), ArcticDEM v4.1 32 m
#   <id>_4m.png                one fine box per group of close shots (terrain_near_regions), ArcticDEM v4.1 2 m at ~4 m
# usage: tools/sun3d/build_faroes.sh <work dir>     (downloads about 200 MB of source blocks into <work dir>/adem, kept for reruns)
# The boxes below are the rows of supabase/migrations/20261112070000_terrain_near_regions.sql: change both together.
set -e
here="$(cd "$(dirname "$0")" && pwd)"; work="$1"; mkdir -p "$work/files"
python3 "$here/build_dem_arctic.py" "$work" "$work/files/faroes_adem32.png" 62.42 61.78 -7.72 -6.25 2048
while read -r id north south west east n; do
  python3 "$here/build_dem_arctic.py" "$work" "$work/files/${id}_4m.png" "$north" "$south" "$west" "$east" "$n"
done <<'BOXES'
fo_vagar_west 62.135 62.058 -7.475 -7.330 2048
fo_vagar_south 62.062 62.008 -7.345 -7.200 2048
fo_sandavagur 62.092 62.036 -7.175 -7.070 1536
fo_kvivik 62.133 62.106 -7.095 -7.058 1024
fo_streymoy_north 62.335 62.235 -7.240 -7.065 2048
fo_eysturoy_north 62.348 62.278 -7.020 -6.925 2048
fo_kalsoy_north 62.380 62.328 -6.835 -6.745 1536
fo_torshavn_south 62.016 61.944 -6.900 -6.755 2048
fo_nordradalur 62.096 62.035 -7.000 -6.850 2048
fo_vidoy 62.380 62.338 -6.600 -6.520 1024
fo_sandoy 61.885 61.833 -6.940 -6.880 1536
BOXES
ls -la "$work/files"
