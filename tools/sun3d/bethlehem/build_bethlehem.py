#!/usr/bin/env python3
"""3D sun view for a one-stop day shoot: Bethlehem Steel Stacks (Bethlehem PA, 25 Nov 2026), the whole NEW_TRIP_SOP 4b stack.

  build_bethlehem.py despike <png>                    terrarium glitches out of a wide / fine file (in place)
  (more steps below, one subcommand each; see README.md in this folder)

Sources: wide + fine (near) files = terrarium tiles (tools/sun3d/build_trip_terrain.py --wide-km 29.5 --pad 3000),
range = USGS 3DEP 1 m DEM (project PA_Northcentral_2019_B19, UTM 18N), detail / houses / trees = USGS 3DEP lidar
PA_Northcentral_B5_2019 (Entwine EPT on AWS; in this survey everything above the ground is class 1, so buildings,
the furnaces and trees are told apart by the returns, the shape and the NAIP summer photo's near infrared),
colour = USDA NAIP (PA, imagery.nationalmap.gov). Teton / Faroes rows and files are never touched: ids and files 'bth*'.
"""
import argparse, json, math, os, sys
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__)); SUN3D = os.path.dirname(HERE)
sys.dont_write_bytecode = True
sys.path.insert(0, SUN3D); sys.path.insert(0, os.path.join(SUN3D, 'lidar'))
from build_trip_terrain import read_png, at   # noqa: E402

# the shoot
STOP = (40.614136, -75.370045); STAND = (40.614787, -75.367304); SUBJECT = (40.615177, -75.367175)
REGION = dict(id='bethlehem', north=40.89, south=40.34, west=-75.72, east=-75.01, n=2048, base=0.0, step=0.5, path='bethlehem_z12.png')
NEAR = dict(id='bth_bethlehem_steel_stacks', north=40.642, south=40.5875, west=-75.403, east=-75.3315, n=896, base=0.0, step=0.5, path='bth_bethlehem_steel_stacks_z14.png')
KZ = 111132.0
def KX(lat): return 111320 * math.cos(math.radians(lat))


def despike(a):
    """Single-cell / single-column glitches in terrarium files (Bethlehem wide: a 720 m spike at 40.48 N -75.551, a 0 m
    cell at 40.697 N -75.488): a cell (or a one-cell-wide line of them) standing more than 50 m above or below all six
    neighbours across the line is set to the median of its 5 x 5 neighbours. Quarries, the river cut and ridges are
    wide and keep their heights."""
    from build_detail import write_heights   # noqa
    h = read_png(a.png, 0.0, 0.5); n = h.shape[0]
    p = np.pad(h, 2, mode='edge'); sh = lambda i, j: p[2 + i:2 + i + n, 2 + j:2 + j + n]
    bad = np.zeros_like(h, bool)
    for side in ([(i, j) for i in (-1, 0, 1) for j in (-1, 1)], [(i, j) for i in (-1, 1) for j in (-1, 0, 1)]):
        nb = np.stack([sh(i, j) for i, j in side]); bad |= (h - nb.max(0) > 50) | (nb.min(0) - h > 50)
    stack = np.stack([p[i:i + n, j:j + n] for i in range(5) for j in range(5)]); med = np.median(stack, axis=0)
    # the tile-source seam SW of Allentown (a dashed wall along a stair-step line, 40.53-40.57 N, -75.68..-75.59): cells
    # more than 10 m off the 5 x 5 median where the median ground is gentle (natural ground that steep is a quarry or a ridge)
    gy, gx = np.gradient(med, a.cell); gentle = np.hypot(gx, gy) < 0.12
    seam = gentle & (np.abs(h - med) > 10.0)
    seam = seam | (np.pad(seam, 1)[2:, 1:-1] | np.pad(seam, 1)[:-2, 1:-1] | np.pad(seam, 1)[1:-1, 2:] | np.pad(seam, 1)[1:-1, :-2]) & gentle & (np.abs(h - med) > 4.0)
    # the seam is a wall a cell or two wide: its cells and their neighbours across it are filled from the good ground beside
    for _ in range(2): seam = seam | (np.pad(seam, 1)[2:, 1:-1] | np.pad(seam, 1)[:-2, 1:-1] | np.pad(seam, 1)[1:-1, 2:] | np.pad(seam, 1)[1:-1, :-2]) & gentle
    from build_detail import fill   # noqa
    print(f"{os.path.basename(a.png)}: {int(bad.sum())} spike cells (heights {h[bad].round().tolist()[:8]}) -> median, {int(seam.sum())} seam cells -> filled from beside")
    h = np.where(bad, med, h); h = np.where(seam, fill(h, ~seam), h)
    if a.cop_work:   # a wall 2-4 cells wide is left where the two tile sources meet: there, Copernicus GLO-30 moved to the file's level
        from build_trip_terrain import cop_grid   # noqa
        north, south, west, east = a.box; la = north - (np.arange(n) + .5) * (north - south) / n; lo = west + (np.arange(n) + .5) * (east - west) / n
        C = cop_grid(a.cop_work, la, lo).astype(np.float64)
        band = seam | bad
        for _ in range(4): band = band | np.pad(band, 1)[2:, 1:-1] | np.pad(band, 1)[:-2, 1:-1] | np.pad(band, 1)[1:-1, 2:] | np.pad(band, 1)[1:-1, :-2]
        big = np.zeros_like(band); big[np.ix_(la < a.seam_box[0], (lo < a.seam_box[1]))] = True; band &= big
        ring = band.copy()
        for _ in range(6): ring = ring | np.pad(ring, 1)[2:, 1:-1] | np.pad(ring, 1)[:-2, 1:-1] | np.pad(ring, 1)[1:-1, 2:] | np.pad(ring, 1)[1:-1, :-2]
        ring &= ~band
        off = fill(np.where(ring, h - C, 0.0), ring)    # the file's level against Copernicus, spread from the ring into the band
        h = np.where(band, C + off, h); print(f"  Copernicus over the seam: {int(band.sum())} cells, offset middle {np.median((h - C)[ring]):+.1f} m")
    write_heights(a.png, h, 0.0, 0.5)


PROJECT = 'PA_Northcentral_B5_2019'     # USGS 3DEP lidar over Bethlehem (QL2, ~2.6 points a m2; classes 1 unsorted, 2 ground, 9 water)
SIDE = 3008.0                            # the close-up box, metres a side: centred between the parking and the stand pin
MID = ((STOP[0] + STAND[0]) / 2, (STOP[1] + STAND[1]) / 2)
def detail_box():
    hy = SIDE / 2 / KZ; hx = SIDE / 2 / KX(MID[0])
    return tuple(round(v, 6) for v in (MID[0] + hy, MID[0] - hy, MID[1] - hx, MID[1] + hx))


def grid(a):
    """The survey's points on the close-up box at 1 m (n 3008): per cell the highest return and its class, the ground
    returns' sum and count, the lowest water return, the return count and how many came from pulses with several
    returns. Saved as <work>/grid1.npz; the 2 m files are made from it by 2 x 2 cells."""
    import build_detail as bd
    box = detail_box(); n = int(round(SIDE)); sv = bd.Survey(PROJECT, f"{a.work}/cache")
    print(f"close-up box {box}, {n} x {n} at 1 m", flush=True)
    g = bd.grid_box(sv, box, n, lambda s: print('  ' + s, flush=True), keep=False, maxd=99)
    np.savez_compressed(f"{a.work}/grid1.npz", box=np.array(box), top=g['top'], cls=g['cls'], gsum=g['gsum'].astype(np.float32), gcnt=g['gcnt'],
                        wmin=g['wmin'], cnt=g['cnt'], multi=g['multi'], total=g['total'])


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0]); sub = ap.add_subparsers(dest='cmd', required=True)
    d = sub.add_parser('despike'); d.add_argument('png'); d.add_argument('--cell', type=float, default=29.3, help='metres a point')
    d.add_argument('--box', type=float, nargs=4, default=[REGION['north'], REGION['south'], REGION['west'], REGION['east']])
    d.add_argument('--cop-work', help="build_trip_terrain.py's work dir (its cop/ tiles): Copernicus over the source seam")
    d.add_argument('--seam-box', type=float, nargs=2, default=[40.60, -75.57], help='the seam lies south of this lat and west of this lng')
    g = sub.add_parser('grid'); g.add_argument('work')
    a = ap.parse_args()
    {'despike': despike, 'grid': grid}[a.cmd](a)


if __name__ == '__main__': main()
