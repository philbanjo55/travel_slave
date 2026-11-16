#!/bin/sh
# usage: fetch_rows.sh <q.sh> <out rows.json>   (q.sh: a script that takes one SELECT and prints JSON rows)
Q=$1; OUT=$2
r() { $Q "$1"; }
printf '{"regions":%s,"range":%s,"near":%s,"houses":%s,"detail":%s,"trees":%s}\n' \
  "$(r 'select id,path,base_m,step_m,n,north,south,west,east from terrain_regions')" \
  "$(r 'select id,parent,path,base_m,step_m,n,north,south,west,east from terrain_range_regions')" \
  "$(r 'select id,parent,path,base_m,step_m,n,north,south,west,east from terrain_near_regions')" \
  "$(r 'select id,parent,north,south,west,east,path from terrain_house_tiles')" \
  "$(r 'select id,parent,path,leaf_mask_path,base_m,step_m,n,north,south,west,east from terrain_detail_regions_v4 where leaf_mask_path is not null')" \
  "$(r 'select id,parent,path,step_m,north,south,west,east from terrain_tree_tiles where lod = 0')" > "$OUT"
