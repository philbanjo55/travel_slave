#!/usr/bin/env python3
"""The sharp Grand Teton 3D view's files and migration (14 Nov 2026), from the three builders' outputs:

  build_sharp_sql.py <out dir> --range <build_range work> --detail <build_detail work> --colour <build_teton_colour work>
                     --houses <build_buildings work> --migration <supabase/migrations/....sql>

Copies every file to upload into <out dir> under its bucket name, writes <out dir>/upload.txt (name, bytes, sha256)
and the migration (NOT applied):
  - terrain_range_regions: the range boxes (tools/sun3d/build_range.py);
  - terrain_detail_regions_v4: the 1.5 km laser boxes (tools/sun3d/lidar/build_detail.py --side 1504 --cell 1
    --no-buildings), in a table of their own so the app already on the phone (which reads terrain_detail_regions and
    has no building files) keeps its 500 m boxes with the buildings in them;
  - terrain_house_tiles: the park-wide building tiles (tools/sun3d/lidar/build_buildings.py).
Every table: RLS on, an `app_read` select policy (the app reads with the public key), like the other terrain tables.
"""
import argparse, hashlib, json, os, shutil


def q(v):
    if v is None: return 'null'
    if isinstance(v, (int, float)): return repr(v)
    return "'" + str(v).replace("'", "''") + "'"


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('out'); ap.add_argument('--range'); ap.add_argument('--detail'); ap.add_argument('--colour'); ap.add_argument('--houses'); ap.add_argument('--migration')
    a = ap.parse_args(); os.makedirs(a.out, exist_ok=True); up = []
    def put(src, name):
        dst = os.path.join(a.out, name)
        if os.path.abspath(src) != os.path.abspath(dst): shutil.copyfile(src, dst)
        up.append((name, os.path.getsize(dst), hashlib.sha256(open(dst, 'rb').read()).hexdigest())); return os.path.getsize(dst)
    rng = json.load(open(f"{a.range}/range.json"))
    for r in rng: r['bytes'] = put(f"{a.range}/files/{r['path']}", r['path'])
    det = json.load(open(f"{a.detail}/detail.json"))
    col = {m['id']: m for m in json.load(open(f"{a.colour}/boxes.json"))['detail']} if a.colour else {}
    for d in det:
        d['id15'] = d['id'].replace('gtd_', 'gtd15_', 1)
        for k in ('path', 'mask_path', 'trees_path', 'water_path'):
            if d.get(k): d[k] = os.path.basename(d[k]); d[k.replace('path', 'bytes')] = put(f"{a.detail}/files_v4/{d[k]}", d[k])
        c = col.get(d['id'])
        if c:
            name = c['path'].replace('_colour.jpg', '_colour_v4.jpg'); d['color_path'] = name; d['color_bytes'] = put(f"{a.colour}/files/{c['path']}", name)
    tiles = json.load(open(f"{a.houses}/tiles.json"))
    for t in tiles: t['bytes'] = put(f"{a.houses}/files/{t['path']}", t['path'])
    with open(os.path.join(a.out, 'upload.txt'), 'w') as f:
        f.write('# name\tbytes\tsha256 (upload each to bucket terrain under its name)\n')
        for n, b, h in up: f.write(f"{n}\t{b}\t{h}\n")
    total = sum(b for _, b, _ in up)
    sql = f"""-- 3D sun view, Grand Teton sharp terrain (14 Nov 2026; NOT applied). Before applying: upload the {len(up)} files of
-- upload.txt ({total / 1e6:.1f} MB) to bucket `terrain` (public). Written by tools/sun3d/build_sharp_sql.py.
--
-- 1. terrain_range_regions: 2048 x 2048 grids at 5 m (10.24 km boxes) over the part of the range the shots look at, from the
--    USGS 3DEP 1 m lidar DEM (WY_GrandTetonNP_D22, 2022; bare earth, NAVD88), tools/sun3d/build_range.py. The page draws one
--    between the wide grid and the fine box and reads the sun times from it. Height = base_m + value * step_m.
-- 2. terrain_detail_regions_v4: the laser boxes made 1.5 km a side at 1 m (were 500 m at 0.5 m), buildings LEFT OUT of the
--    heights (they are drawn from terrain_house_tiles), same file formats as terrain_detail_regions. A table of its own: the
--    app build already on phones reads terrain_detail_regions and would lose its buildings if these rows were there.
-- 3. terrain_house_tiles: park-wide buildings from the same survey (walls, eave / ridge heights, ridge direction), one JSON
--    file per tile of the wide grid's 10 x 10 (the park-wide trees' tiles), tools/sun3d/lidar/build_buildings.py.
-- All three: RLS on, select for everyone (anon reads them with the public key, like the other terrain tables).

create table if not exists public.terrain_range_regions (
  id text primary key,
  parent text not null references public.terrain_regions(id),
  north double precision not null, south double precision not null, west double precision not null, east double precision not null,
  n integer not null, width_m double precision not null, depth_m double precision not null,
  base_m double precision not null, step_m double precision not null, cell_m double precision,
  path text not null, bytes integer, note text, created_at timestamptz not null default now()
);
alter table public.terrain_range_regions enable row level security;
do $$ begin if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'terrain_range_regions' and policyname = 'app_read') then create policy app_read on public.terrain_range_regions for select using (true); end if; end $$;

create table if not exists public.terrain_detail_regions_v4 (like public.terrain_detail_regions including defaults);
do $$ begin if not exists (select 1 from pg_constraint where conrelid = 'public.terrain_detail_regions_v4'::regclass and contype = 'p') then alter table public.terrain_detail_regions_v4 add primary key (id); end if; end $$;
alter table public.terrain_detail_regions_v4 add column if not exists bare boolean not null default true;   -- buildings left out of the heights
alter table public.terrain_detail_regions_v4 enable row level security;
do $$ begin if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'terrain_detail_regions_v4' and policyname = 'app_read') then create policy app_read on public.terrain_detail_regions_v4 for select using (true); end if; end $$;

create table if not exists public.terrain_house_tiles (
  id text primary key,
  parent text not null references public.terrain_regions(id),
  north double precision not null, south double precision not null, west double precision not null, east double precision not null,
  path text not null, bytes integer, count integer, note text, created_at timestamptz not null default now()
);
alter table public.terrain_house_tiles enable row level security;
do $$ begin if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'terrain_house_tiles' and policyname = 'app_read') then create policy app_read on public.terrain_house_tiles for select using (true); end if; end $$;

insert into public.terrain_range_regions (id, parent, north, south, west, east, n, width_m, depth_m, base_m, step_m, cell_m, path, bytes, note) values
""" + ',\n'.join(f"  ({q(r['id'])}, {q(r['parent'])}, {r['north']}, {r['south']}, {r['west']}, {r['east']}, {r['n']}, {r['width_m']}, {r['depth_m']}, {r['base_m']}, {r['step_m']}, {r['cell_m']}, {q(r['path'])}, {r['bytes']}, "
                 f"{q('USGS 3DEP 1 m lidar DEM, 2022 (' + ', '.join(f'{k} {v:.0%}' for k, v in r['sources'].items() if v) + '), 5 m.')})" for r in rng) + """
on conflict (id) do update set north = excluded.north, south = excluded.south, west = excluded.west, east = excluded.east, n = excluded.n,
  width_m = excluded.width_m, depth_m = excluded.depth_m, base_m = excluded.base_m, step_m = excluded.step_m, cell_m = excluded.cell_m, path = excluded.path, bytes = excluded.bytes, note = excluded.note;

insert into public.terrain_detail_regions_v4 (id, parent, north, south, west, east, n, width_m, depth_m, base_m, step_m, cell_m, path, bytes, mask_path, mask_bytes,
  trees_path, trees_bytes, trees_bins, trees_bin_m, water_path, water_bytes, water_n, water_north, water_south, water_west, water_east, color_path, color_bytes, note) values
""" + ',\n'.join(f"  ({q(d['id15'])}, {q(d['parent'])}, {d['north']}, {d['south']}, {d['west']}, {d['east']}, {d['n']}, {round(d['width_m'], 1)}, {round(d['depth_m'], 1)}, {d['base_m']}, {d['step_m']}, {d['cell_m']}, "
                 f"{q(d['path'])}, {d['bytes']}, {q(d['mask_path'])}, {d['mask_bytes']}, {q(d.get('trees_path'))}, {q(d.get('trees_bytes'))}, {q(d.get('trees_bins', 64))}, {q(d.get('trees_bin_m', 0.6))}, "
                 f"{q(d.get('water_path'))}, {q(d.get('water_bytes'))}, {q(d.get('water_n'))}, {q(d.get('water_north'))}, {q(d.get('water_south'))}, {q(d.get('water_west'))}, {q(d.get('water_east'))}, "
                 f"{q(d.get('color_path'))}, {q(d.get('color_bytes'))}, {q('USGS 3DEP lidar WY_GrandTetonNP_1_D22, 1.5 km at 1 m, ground only (buildings from terrain_house_tiles), tree canopy in the mask.')})" for d in det) + """
on conflict (id) do nothing;

insert into public.terrain_house_tiles (id, parent, north, south, west, east, path, bytes, count, note) values
""" + ',\n'.join(f"  ({q(t['id'])}, {q(t['parent'])}, {t['north']}, {t['south']}, {t['west']}, {t['east']}, {q(t['path'])}, {t['bytes']}, {t['count']}, {q('USGS 3DEP lidar WY_GrandTetonNP_1_D22 (2022): footprints, eave and ridge heights, ridge direction.')})" for t in tiles) + """
on conflict (id) do update set path = excluded.path, bytes = excluded.bytes, count = excluded.count, note = excluded.note;
"""
    if a.migration: open(a.migration, 'w').write(sql)
    json.dump(dict(range=rng, detail=[dict(d, id=d['id15']) for d in det], houses=tiles), open(os.path.join(a.out, 'rows.json'), 'w'), indent=1)
    print(f"{len(up)} files, {total / 1e6:.1f} MB: range {sum(r['bytes'] for r in rng) / 1e6:.1f}, detail {sum(b for n, b, _ in up if n.startswith('gtd_')) / 1e6:.1f}, houses {sum(t['bytes'] for t in tiles) / 1e6:.2f}")


if __name__ == '__main__':
    main()
