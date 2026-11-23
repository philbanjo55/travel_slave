# Bethlehem Steel Stacks: 3D for a one-stop day shoot (22 Nov 2026)

Trip `138477e5-0c0c-44b6-8958-25a31660eef7`, 25 Nov 2026, Bethlehem PA. Stand pin 40.614787, -75.367304, subject (blast
furnaces) 40.615177, -75.367175, parking 40.614136, -75.370045. Built, checked in the harness, NOT uploaded or applied
(migration `supabase/migrations/20261122030000_terrain_bethlehem.sql`).

## Steps (work dir W; `TRIP_Q` = a read-only SQL helper)

    python3 tools/sun3d/build_trip_terrain.py build W/wide --region bethlehem --prefix bth --trip <trip> --ground green --wide-km 29.5 --pad 3000
    python3 build_bethlehem.py despike W/files/bethlehem_z12.png --cop-work W/wide --seam-box 40.60 -75.48
    python3 build_bethlehem.py grid W        # survey -> 1 m grid of the 3 km box (37 M points, ~200 MB of LAZ, cached)
    python3 build_bethlehem.py range W       # 3DEP 1 m DEM -> 5 m range box over the site + South Mountain
    python3 build_bethlehem.py naip W        # NAIP 1 m over the box (4 x 4 pieces)
    python3 build_bethlehem.py colour W      # Sentinel-2 wide colour, NAIP near / close-up colour
    python3 build_bethlehem.py houses W      # buildings and structures -> bthb_* tiles (needs W/wide_water.npz from `detail`)
    python3 build_bethlehem.py detail W --cell 2   # the close-up box (run once before `houses` for the water layer, again after)
    python3 build_bethlehem.py trees W       # tree tiles over the near box
    python3 build_bethlehem.py sql W --cell 2      # W/upload: files, upload.txt (name, bytes, sha256), rows, migration

Render check: `node rv_bth.js <page dir with index.html> W/upload <out> <jobs.json>` (index.html = the string in
`src/components/sun/sun3dHtml.ts`); feeds the page as `Sun3DPanel` does and reports times, browser memory and moments.

## Sources

| Layer | Source |
|---|---|
| Wide (60 km, 29 m) | terrarium tiles z12; a 720 m spike column and the stair-step source seam SW of Allentown replaced (median / Copernicus GLO-30). Colour: Sentinel-2 L2A 16 Nov 2023 (18TVK / 18TVL, cloud 0-4 %), 30 Nov 2024 fill |
| Near (6 km, ~7 m) | terrarium z14. Colour: NAIP 29 Apr 2022 |
| Range (10.24 km, 5 m) | USGS 3DEP 1 m DEM `PA_Northcentral_2019_B19` (100 % covered), South Mountain to the SW (late-autumn sunset ~236 deg) |
| Close-up (3 km, 2 m) | USGS lidar EPT `PA_Northcentral_B5_2019` (QL2, 4.1 points a m2 in the box): bare ground, water (Lehigh River, canal; speckle and bridge gaps closed), mask v6 trees |
| Buildings | same survey. It sorts nothing above the ground (class 1 for roofs, trees and steel alike; 17 bridge decks), so: solid = one return per pulse, or no plant in NAIP (NDVI < 0); trees taken out by roughness + NDVI; bridges and anything over the river left out. Ordinary buildings: walls + fitted roof (`build_buildings.parts`) or an up-to-80-corner outline; structures of many heights (furnaces, trestle, casino): 3 m columns at the laser's 90th-percentile height |
| Trees | close-up box: mask v6 (bare / evergreen from Sentinel-2 16 Nov 2023 + NAIP April NDVI); beyond: 7 m tiles over the near box (depth 9) with the bare bit |

## Why 2 m cells for the 3 km box

Measured in the harness (headless Chromium, software graphics, stand pin view, 1000 x 800): plain view 718 MB browser RSS;
with the close-up box alone n 1504 (2 m, the same arrays as a 1.5 km 1 m box) 929 MB (+211), n 3008 (1 m) 1110 MB (+392,
1.9x); page heap 91 vs 226 MB; the page's own foreground build 0.76 s vs 2.39 s. 1 m is over the 1.5x aim, and the survey
has ~4 points a m2, so 1 m cells add little real detail: 2 m.
