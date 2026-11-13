#!/usr/bin/env python3
"""Real winter colour for the Grand Teton 3D view (13 Nov 2026).

  python3 build_teton_colour.py wide   <work dir>          the wide file: a Sentinel-2 winter picture of the whole grid
  python3 build_teton_colour.py boxes  <work dir>          the 8 fine (near) boxes and the 19 laser (detail) boxes:
                                                           summer aerial photos (NAIP) turned to winter
  python3 build_teton_colour.py sql    <work dir>          upload.txt + the migration's rows
  python3 build_teton_colour.py all    <work dir>

Needs: pip install pyproj tifffile imagecodecs numpy scipy pillow requests. Everything downloaded is cached under
<work dir>/cache, so a rerun costs nothing. Rows come from the database through TRIP_Q (a script that takes one SQL
string and prints JSON rows, e.g. scratchpad q.sh); the laser files from LIDAR_DIRS (colon separated) or else the
public bucket.

Sources (both public):
  Copernicus Sentinel-2 L2A (ESA), tile 12TWP, 30 Dec 2025 18:32 UTC (11:32 AM MST, sun 22 deg up, cloud 2 %), with
  11 Jan 2026 18:22 UTC filling what the 30 Dec pass did not cover (the swath edge cuts the south-east corner) or saw
  as cloud. COGs on AWS (sentinel-cogs), read with HTTP range requests, tile by tile.
  USDA NAIP via USGS The National Map ImageServer, 0.6 m, 19 Jul 2022 (summer, leaf-on).

Output files are the page's colour files: JPEG, north up, on the box's own lat / lng grid (row 0 = north), values as
seen (the page takes albedo = value^1.613, the same scale as its own snow). Light is NOT in them as far as can be
helped: the page lights them with its own sun.

How snow is decided (the summer photos):
  1. Winter truth at 10-20 m: Sentinel-2's snow index NDSI = (green - swir) / (green + swir) on 30 Dec 2025 (11 Jan 2026
     where 30 Dec has no data). NDSI over ~0.4 is snow whether lit or in shade; forest with snow under it is in between.
  2. Inside a laser box the survey's class mask says what each 0.5 m cell is: water and buildings are drawn by the page
     itself (open water / ice, boards and snowy roofs), trees are drawn by the page as points.
  3. Every other cell is snow, unless the winter picture says that 10-20 m around it is bare (NDSI low: a ploughed
     road, a wind-blown bank, open water the mask missed): there the summer photo shows through, greyed (no green in
     late December). Under a tree crown the snow is shaded (bluer, darker); a dark crown in the photo where the winter
     picture says forest stays dark green (conifer).
  4. Snow keeps a faint trace of the photo's own pattern (sage, ruts, tracks): +-6 % brightness, never green.
"""
import io, json, math, os, subprocess, sys, zlib, struct
import numpy as np, requests, tifffile
from PIL import Image
from pyproj import Transformer
from scipy import ndimage

REGION = dict(id='grand_teton', north=43.95, south=43.45, west=-110.92, east=-110.24, n=2048, base=1500.0, step=0.5)
S2 = 'https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/12/T/WP/'
SCENES = [   # (id, folder, sun azimuth, sun elevation); first = main, then fills
    ('S2B_12TWP_20251230_0_L2A', S2 + '2025/12/S2B_12TWP_20251230_0_L2A/', 167.1, 22.1),
    ('S2C_12TWP_20260111_0_L2A', S2 + '2026/1/S2C_12TWP_20260111_0_L2A/', 163.1, 22.7),
]
X0, Y0 = 499980.0, 4900020.0   # tile 12TWP's upper-left corner, EPSG:32612
NAIP = 'https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer/exportImage'
FILES_URL = 'https://ohshrzlvvxyovcjmdajc.supabase.co/storage/v1/object/public/terrain/'
WIDE_PX = int(os.environ.get('WIDE_PX', 4096))
SNOW = np.array([244, 247, 252], float) / 255   # the page's own snow (albedo .93 .95 .98) as seen
TO_UTM = Transformer.from_crs('EPSG:4326', 'EPSG:32612', always_xy=True)


def log(*a): print(*a, flush=True)


# ---------------------------------------------------------------- COG range reading
class RangeFile(io.RawIOBase):
    B = 1 << 19

    def __init__(s, url, ses):
        s.url, s.ses, s.pos, s.cache = url, ses, 0, {}
        s.size = int(ses.head(url, timeout=60).headers['Content-Length'])

    def readable(s): return True
    def seekable(s): return True
    def tell(s): return s.pos

    def seek(s, o, w=0):
        s.pos = o if w == 0 else s.pos + o if w == 1 else s.size + o
        return s.pos

    def _blk(s, i):
        if i not in s.cache:
            a = i * s.B
            s.cache[i] = s.ses.get(s.url, headers={'Range': f'bytes={a}-{min(s.size, a + s.B) - 1}'}, timeout=120).content
        return s.cache[i]

    def read(s, n=-1):
        if n < 0: n = s.size - s.pos
        out, p, end = bytearray(), s.pos, min(s.size, s.pos + n)
        while p < end:
            i = p // s.B; blk = s._blk(i); o = p - i * s.B; t = blk[o:o + end - p]; out += t; p += len(t)
        s.pos = p
        return bytes(out)

    def readinto(s, b):
        d = s.read(len(b)); b[:len(d)] = d; return len(d)


def cog_window(cache, url, level, r0, r1, c0, c1):
    """Pixels [r0:r1, c0:c1] of overview `level` (0 = full) of a tiled GeoTIFF, tiles cached on disk."""
    ses = requests.Session(); rf = RangeFile(url, ses); tif = tifffile.TiffFile(rf); page = tif.pages[level]
    th, tw = page.tilelength, page.tilewidth; H, W = page.shape[:2]; ntx = -(-W // tw)
    r0, c0 = max(0, r0), max(0, c0); r1, c1 = min(H, r1), min(W, c1)
    spp = page.samplesperpixel
    out = np.zeros((r1 - r0, c1 - c0, spp), page.dtype)
    tag = url.split('/')[-2] + '_' + url.split('/')[-1].split('.')[0] + f'_{level}'
    os.makedirs(cache, exist_ok=True)
    for ty in range(r0 // th, (r1 - 1) // th + 1):
        for tx in range(c0 // tw, (c1 - 1) // tw + 1):
            idx = ty * ntx + tx; fn = os.path.join(cache, f'{tag}_{idx}.bin')
            if os.path.exists(fn): data = open(fn, 'rb').read()
            else:
                off, cnt = page.dataoffsets[idx], page.databytecounts[idx]
                data = ses.get(url, headers={'Range': f'bytes={off}-{off + cnt - 1}'}, timeout=120).content if cnt else b''
                open(fn, 'wb').write(data)
            if not data: continue
            seg = page.decode(data, idx)[0].reshape(th, tw, spp)
            ya, xa = ty * th, tx * tw
            sy0, sy1, sx0, sx1 = max(r0, ya), min(r1, ya + th), max(c0, xa), min(c1, xa + tw)
            out[sy0 - r0:sy1 - r0, sx0 - c0:sx1 - c0] = seg[sy0 - ya:sy1 - ya, sx0 - xa:sx1 - xa]
    tif.close()
    return out


def latlng_grid(box, w, h):
    """Pixel centres of a w x h image north up on the box's own lat / lng grid."""
    lat = box['north'] - (np.arange(h) + 0.5) / h * (box['north'] - box['south'])
    lng = box['west'] + (np.arange(w) + 0.5) / w * (box['east'] - box['west'])
    return np.meshgrid(lng, lat)


class Winter:
    """The Sentinel-2 winter picture of the region: colour, snow index and validity, sampled anywhere."""

    def __init__(s, work):
        s.cache = os.path.join(work, 'cache', 's2')
        g = latlng_grid(REGION, 64, 64); e, n = TO_UTM.transform(g[0], g[1])
        m = 400
        s.c0, s.c1 = int((e.min() - m - X0) // 10), int((e.max() + m - X0) // 10) + 1
        s.r0, s.r1 = int((Y0 - n.max() - m) // 10), int((Y0 - n.min() + m) // 10) + 1
        s.sc = []
        for sid, url, saz, sel in SCENES:
            log('scene', sid)
            tci = cog_window(s.cache, url + 'TCI.tif', 0, s.r0, s.r1, s.c0, s.c1)
            g20 = cog_window(s.cache, url + 'B03.tif', 1, s.r0 // 2, s.r1 // 2 + 1, s.c0 // 2, s.c1 // 2 + 1)[..., 0]
            w20 = cog_window(s.cache, url + 'B11.tif', 0, s.r0 // 2, s.r1 // 2 + 1, s.c0 // 2, s.c1 // 2 + 1)[..., 0]
            scl = cog_window(s.cache, url + 'SCL.tif', 0, s.r0 // 2, s.r1 // 2 + 1, s.c0 // 2, s.c1 // 2 + 1)[..., 0]
            s.sc.append(dict(id=sid, tci=tci, g=g20, w=w20, scl=scl, az=saz, el=sel))

    def sample(s, lng, lat):
        """Colour (0-1, TCI), NDSI, green reflectance (20 m, never saturated) and the scene used, at these points (any shape). Bilinear; 30 Dec first."""
        e, n = TO_UTM.transform(lng, lat)
        r10, c10 = (Y0 - n) / 10 - 0.5 - s.r0, (e - X0) / 10 - 0.5 - s.c0
        r20, c20 = (Y0 - n) / 20 - 0.5 - s.r0 // 2, (e - X0) / 20 - 0.5 - s.c0 // 2
        shape = np.shape(lng); col = np.zeros(shape + (3,)); ndsi = np.zeros(shape); green = np.zeros(shape); used = np.full(shape, -1, np.int8)
        for k, sc in enumerate(s.sc):
            rgb = np.stack([ndimage.map_coordinates(sc['tci'][..., i].astype(np.float32), [r10, c10], order=1, mode='nearest') for i in range(3)], -1) / 255
            g = ndimage.map_coordinates(sc['g'].astype(np.float32), [r20, c20], order=1, mode='nearest') * 1e-4
            w = ndimage.map_coordinates(sc['w'].astype(np.float32), [r20, c20], order=1, mode='nearest') * 1e-4
            cl = ndimage.map_coordinates(sc['scl'], [np.round(r20), np.round(c20)], order=0, mode='nearest')
            raw = ndimage.map_coordinates(sc['tci'][..., 1], [np.round(r10), np.round(c10)], order=0, mode='nearest')
            # no data (0), saturated / defective (1), cloud medium / high (8, 9), cirrus (10). Not 3 (cloud shadow):
            # in these mountains that is terrain shadow on snow, and the 30 Dec picture had no real clouds over the range.
            ok = (raw > 0) & ~np.isin(cl, [0, 1, 8, 9, 10]) & (used < 0)
            col[ok] = rgb[ok]; ndsi[ok] = ((g - w) / np.maximum(g + w, 1e-3))[ok]; green[ok] = g[ok]; used[ok] = k
        return col, ndsi, green, used


# ---------------------------------------------------------------- heights (the page's 16-bit delta-coded PNG)
def read_heights(path, base, step):
    a = np.array(Image.open(path)).astype(np.int64)
    v = np.cumsum(np.cumsum(a, 0), 1) & 65535
    return base + v * step


def illum(h, dx, dz, az, el):
    """Light on the ground at the picture's moment, 1 = flat open ground in the sun: sky light (by how much sky a
    slope sees) + sun (by its angle, 0 in the shadow of a ridge: a march toward the sun over the heights)."""
    gz, gx = np.gradient(h, dz, dx)   # rows go south: z grows southward
    n = np.stack([-gx, np.ones_like(h), -gz], -1); n /= np.linalg.norm(n, axis=-1, keepdims=True)
    a, e = math.radians(az), math.radians(el)
    s = np.array([math.sin(a) * math.cos(e), math.sin(e), -math.cos(a) * math.cos(e)])   # x east, y up, z south
    lam = np.clip(n @ s, 0, 1)
    vis = np.ones_like(h); tn = math.tan(e); ux, uz = math.sin(a) / dx, -math.cos(a) / dz   # cells per metre toward the sun
    H, W = h.shape; rr, cc = np.mgrid[0:H, 0:W].astype(np.float32)
    d = 0.0; step = 0.7 * min(dx, dz)
    while d < 14000:
        d += step; step *= 1.02
        hh = ndimage.map_coordinates(h, [rr + uz * d, cc + ux * d], order=1, mode='nearest')
        vis = np.minimum(vis, np.clip((h + 3 + tn * d - hh) / (0.02 * d) , 0, 1))
    sky, sun = 0.12, 0.30 / max(0.05, math.sin(e))   # winter clear sky, 22 deg sun: flat open ground = .12 + .30
    return (sky * (1 + n[..., 1]) / 2 + sun * lam * vis) / (sky + sun * math.sin(e))


def smooth(x, lo, hi): t = np.clip((x - lo) / (hi - lo), 0, 1); return t * t * (3 - 2 * t)


def save_jpeg(path, rgb01, q):
    Image.fromarray(np.clip(rgb01 * 255 + 0.5, 0, 255).astype(np.uint8)).save(path, quality=q, optimize=True, progressive=False, subsampling=0 if q >= 92 else 2)
    return os.path.getsize(path)


def snow_frac(col, ndsi, green, E):
    """How much of a 10-20 m spot of the winter picture is snow (0-1). TCI is linear reflectance x 1000 (255 = 0.255:
    snow in the sun is cut off there), green at 20 m never is. Divided by the light then (E), so snow in shade counts
    as snow; the snow index says snow at all (forest, rock, water: low), the brightness how much of the spot."""
    app_g = np.where(col[..., 1] < 0.96, col[..., 1] * 0.255, green)   # the sharper 10 m value where it is not cut off
    return smooth(ndsi, 0.15, 0.35) * smooth(app_g / E, 0.18, 0.62)


# ---------------------------------------------------------------- the wide file
def wide(work, win=None):
    win = win or Winter(work); out = os.path.join(work, 'files'); os.makedirs(out, exist_ok=True)
    n = WIDE_PX; lng, lat = latlng_grid(REGION, n, n)
    col, ndsi, green, used = win.sample(lng, lat)
    log('wide: 30 Dec %.1f %%, 11 Jan %.1f %%, none %.2f %%' % tuple(100 * np.mean(used == k) for k in (0, 1, -1)))
    # The light of 11:30 AM is in the picture (bright south faces, blue shade on north faces and below ridges). It is
    # taken out (the page lights the ground with its own sun): divide by the light then (illum, from our heights).
    dem = os.path.join(work, 'cache', 'grand_teton_z12.png')
    if not os.path.exists(dem): open(dem, 'wb').write(requests.get(FILES_URL + 'grand_teton_z12.png', timeout=120).content)
    h = read_heights(dem, REGION['base'], REGION['step'])
    kx = 111320 * math.cos(math.radians(43.7)) * (REGION['east'] - REGION['west']) / h.shape[1]; kz = 111132 * (REGION['north'] - REGION['south']) / h.shape[0]
    E = np.zeros((n, n)); 
    for k, sc in enumerate(win.sc):
        if not (used == k).any(): continue
        ek = ndimage.zoom(illum(h, kx, kz, sc['az'], sc['el']), n / h.shape[0], order=1)
        E[used == k] = ek[used == k]
    E = np.clip(E, 0.22, 1.6)
    refl = col * 0.255
    fs = snow_frac(col, ndsi, green, E)
    bare = np.clip(refl / E[..., None] * 1.25, 0, 1)         # forest, rock, water: their own colour, the light taken out (x1.25: a calm lift)
    g = bare @ np.array([0.3, 0.59, 0.11])
    bare = np.clip(g[..., None] + (bare - g[..., None]) * 0.75, 0, 1)   # less colour: a winter landscape, no acid greens
    alb = bare * (1 - fs[..., None]) + (SNOW ** 1.613) * fs[..., None]
    alb[used < 0] = SNOW ** 1.613
    seen = alb ** 0.62
    log('wide: snow %.0f %% of the area (mean), E 5/50/95 %%: %s' % (100 * fs.mean(), np.percentile(E, [5, 50, 95]).round(2)))
    p = os.path.join(out, 'grand_teton_s2_winter.jpg'); nb = save_jpeg(p, seen, int(os.environ.get('WIDE_Q', 72)))
    log('wide file', p, nb, 'bytes')
    np.save(os.path.join(work, 'cache', 'wide_E.npy'), E.astype(np.float16))
    return win


# ---------------------------------------------------------------- the boxes (NAIP, summer -> winter)
def rows(sql):
    q = os.environ.get('TRIP_Q')
    if not q: sys.exit('set TRIP_Q to a script that runs one SQL string and prints JSON rows')
    return json.loads(subprocess.run([q, sql], capture_output=True, text=True, check=True).stdout)


def bucket_file(work, name):
    for d in os.environ.get('LIDAR_DIRS', '').split(':'):
        if d and os.path.exists(os.path.join(d, name)): return os.path.join(d, name)
    p = os.path.join(work, 'cache', 'bucket', name)
    if not os.path.exists(p):
        os.makedirs(os.path.dirname(p), exist_ok=True)
        r = requests.get(FILES_URL + name, timeout=120); r.raise_for_status(); open(p, 'wb').write(r.content)
    return p


def naip(work, box, w, h):
    """NAIP RGB + near infrared over the box, w x h, north up on its lat / lng grid (0-1)."""
    p = os.path.join(work, 'cache', 'naip', f"{box['id']}_{w}x{h}.tif")
    if not os.path.exists(p):
        os.makedirs(os.path.dirname(p), exist_ok=True)
        q = dict(bbox=f"{box['west']},{box['south']},{box['east']},{box['north']}", bboxSR=4326, imageSR=4326, size=f'{w},{h}',
                 format='tiff', pixelType='U8', bandIds='0,1,2,3', interpolation='RSP_BilinearInterpolation', f='image')
        r = requests.get(NAIP, params=q, timeout=300); r.raise_for_status()
        if not r.content.startswith(b'II') and not r.content.startswith(b'MM'): raise RuntimeError('NAIP: ' + r.text[:200])
        open(p, 'wb').write(r.content)
    a = tifffile.imread(p).astype(np.float32) / 255
    assert a.shape == (h, w, 4), a.shape
    return a


def winter_at(win, E_wide, box, w, h):
    """The winter picture's snow fraction (10-20 m) on the box's pixels, and what the snow index says alone."""
    lng, lat = latlng_grid(box, w, h)
    col, ndsi, green, used = win.sample(lng, lat)
    R = REGION; n = E_wide.shape[0]
    r = (R['north'] - lat) / (R['north'] - R['south']) * n - 0.5; c = (lng - R['west']) / (R['east'] - R['west']) * n - 0.5
    E = np.clip(ndimage.map_coordinates(E_wide.astype(np.float32), [r, c], order=1, mode='nearest'), 0.22, 1.6)
    return snow_frac(col, ndsi, green, E), ndsi


def box_mean(a, k):
    return ndimage.uniform_filter(a, k, mode='nearest')


def winterize(nb, fs, ndsi, kind=None):
    """A summer photo (nb: r g b nir, 0-1, as seen) turned into late December, as seen. From the winter picture, at
    10-20 m: fs = how much of the spot is white (brightness), ndsi = its snow index (snow under trees and in shade
    still reads as snow). kind: the laser mask (0 ground, 2 building, 3 water, 4 stream, 8+ tree), None in a fine box."""
    rgb, nir = nb[..., :3], nb[..., 3]
    lum = rgb @ np.array([0.3, 0.59, 0.11]); ndvi = (nir - rgb[..., 0]) / np.maximum(nir + rgb[..., 0], 1e-3)
    sat = rgb.max(-1) - rgb.min(-1)
    snow = SNOW ** 1.613
    alb_ph = rgb ** 1.613
    gl = alb_ph @ np.array([0.3, 0.59, 0.11])
    # Is the ground under snow? The winter picture's snow index (snow in shade and under open forest counts). Not the
    # summer photo: in late December the valley and the forest floor are white wherever the satellite saw snow.
    sn = smooth(ndsi, 0.12, 0.30)
    # what shows where there is no snow: dormant grass and soil (tan-grey, from the photo's brightness), rock and
    # gravel (the photo's own colour, greyed), a paved road (darker, wet)
    paved = (1 - smooth(ndvi, 0.04, 0.12)) * (1 - smooth(sat, 0.08, 0.14))
    veg = smooth(ndvi, 0.05, 0.2)[..., None]
    dorm = np.array([0.36, 0.31, 0.25])[None, None] * (0.45 + 1.6 * gl[..., None])
    rock = gl[..., None] + (alb_ph - gl[..., None]) * 0.5
    bare = dorm * veg + rock * (1 - veg)
    bare = bare * (1 - paved[..., None]) + (gl * 0.55)[..., None] * paved[..., None]
    # snow keeps a faint trace of the photo's pattern (sage, ruts, tracks): +-6 % brightness, never its colour
    tex = np.clip(1 + (lum - box_mean(lum, 15)) * 0.5, 0.94, 1.06)[..., None]
    ground = bare * (1 - sn[..., None]) + snow * tex * sn[..., None]
    if kind is not None:
        # trees are drawn by the page as points above this ground (from the survey): under them the snow is a little
        # darker (shade, needles). The photo's own dark crowns are NOT painted: they sit a few metres off the survey's.
        crown = (kind >= 8)
        out = ground.copy(); out[crown] *= 0.9
        water = (kind == 3) | (kind == 4)
        out[water] = np.array([0.03, 0.05, 0.06])   # the page draws water and ice itself; this is only its colour at a blend edge
        st = dict(snow=float(sn[kind == 0].mean()), bare=float((sn[kind == 0] < 0.5).mean()))
    else:
        # conifers (spruce, fir, pine: green all winter): the photo's dark green spots (darker than the valley's
        # summer grass, ~0.42 in these photos, or the box's middle if brighter)
        # summer grass, ~0.42 in these photos, or the box's middle if brighter); readier where the winter picture is dark there too (forest), less
        # ready where it is open white (a dark summer meadow is not a tree)
        dark_w = 1 - smooth(fs, 0.5, 0.9)
        ref = max(0.42, float(np.median(lum)))   # a box of bright dry flats has brighter photos
        con = smooth(1 - lum / ref, 0.30 - 0.18 * dark_w, 0.42 - 0.14 * dark_w) * smooth(ndvi, 0.0, 0.12)
        ccol = (alb_ph * 0.8 + np.array([0.012, 0.018, 0.015])[None, None]) * 0.9 + snow * 0.1
        # leafy summer green that is not a conifer (willow, cottonwood, aspen along the water): bare twigs in winter,
        # a grey-brown haze over the snow
        dec = smooth(ndvi, 0.30, 0.45) * (1 - con) * sn
        ground = ground * (1 - 0.35 * dec[..., None]) + np.array([0.20, 0.155, 0.13])[None, None] * (0.35 * dec[..., None])
        out = ground * (1 - con[..., None]) + ccol * con[..., None]
        # water (summer: dark, no green): frozen and white where the winter picture is white, else open and dark
        wat = (1 - smooth(ndvi, -0.12, -0.02)) * (1 - smooth(lum, 0.30, 0.40))
        ice = smooth(fs, 0.5, 0.8)
        wcol = np.array([0.03, 0.055, 0.07])[None, None] * (1 - ice[..., None]) + snow * 0.92 * ice[..., None]
        out = out * (1 - wat[..., None]) + wcol * wat[..., None]
        st = dict(snow=float(sn.mean()), conifer=float(con.mean()), twigs=float(dec.mean()), water=float(wat.mean()))
    return np.clip(out, 0, 1) ** 0.62, st


def boxes(work, win=None):
    win = win or Winter(work); out = os.path.join(work, 'files'); os.makedirs(out, exist_ok=True)
    Ep = os.path.join(work, 'cache', 'wide_E.npy')
    if not os.path.exists(Ep): wide(work, win)
    E = np.load(Ep)
    made = {'near': [], 'detail': []}
    for r in rows("select id, north, south, west, east, n from terrain_near_regions where parent = 'grand_teton' order by id"):
        px = int(os.environ.get('NEAR_PX', 0)) or min(2048, r['n'])
        nb = naip(work, r, px, px); fs, nd = winter_at(win, E, r, px, px)
        seen, st = winterize(nb, fs, nd)
        p = os.path.join(out, f"{r['id']}_colour.jpg"); nbytes = save_jpeg(p, seen, 82)
        made['near'].append(dict(id=r['id'], path=os.path.basename(p), bytes=nbytes, px=px, **st)); log('near', r['id'], px, nbytes, st)
    for r in rows("select id, north, south, west, east, n, base_m, step_m, path, mask_path from terrain_detail_regions where parent = 'grand_teton' order by id"):
        n = r['n']; nb = naip(work, r, n, n); fs, nd = winter_at(win, E, r, n, n)
        kind = np.array(Image.open(bucket_file(work, r['mask_path'])))
        assert kind.shape == (n, n), (r['id'], kind.shape)
        seen, st = winterize(nb, fs, nd, kind)
        p = os.path.join(out, f"{r['id']}_colour.jpg"); nbytes = save_jpeg(p, seen, 82)
        made['detail'].append(dict(id=r['id'], path=os.path.basename(p), bytes=nbytes, px=n, **st)); log('detail', r['id'], n, nbytes, st)
    json.dump(made, open(os.path.join(work, 'boxes.json'), 'w'), indent=1)
    return win


if __name__ == '__main__':
    cmd, work = sys.argv[1], sys.argv[2]
    os.makedirs(work, exist_ok=True)
    W = None
    if cmd in ('wide', 'all'): W = wide(work)
    if cmd in ('boxes', 'all'): W = boxes(work, W)
