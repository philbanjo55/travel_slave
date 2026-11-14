#!/usr/bin/env python3
"""Proof picture, step 3: out/<name>_before.png + _after.png for every view -> _faroes_round1.png and a small copy."""
import json, os, sys
from PIL import Image, ImageDraw, ImageFont
HERE = os.path.dirname(os.path.abspath(__file__))
views = json.load(open(f"{HERE}/views.json"))
def font(sz, bold=False):
    for p in (f"/usr/share/fonts/truetype/dejavu/DejaVuSans{'-Bold' if bold else ''}.ttf", "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf"):
        if os.path.exists(p): return ImageFont.truetype(p, sz)
    return ImageFont.load_default()
W, H, G, LB, HD = 1200, 960, 16, 92, 150
rows = [v for v in views if os.path.exists(f"{HERE}/out/{v['name']}_after.png")]
sheet = Image.new('RGB', (2 * W + 3 * G, HD + len(rows) * (H + LB + G) + 70), (250, 250, 248)); d = ImageDraw.Draw(sheet)
d.text((G, 14), "Faroes 3D sun view: real foreground, round 1 (data test, drawn by a stand-alone renderer, not the app)", font=font(34, True), fill=(20, 20, 20))
d.text((G, 62), "BEFORE (left): what the app has today = the 4 m height grid, plain colours, no houses.     AFTER (right): 1-2 m ground + building outlines as blocks + mapped water + an aerial photo as colour.", font=font(22), fill=(60, 60, 60))
d.text((G, 96), "Mid-May sun, calculated, with cast shadows. 4x5 film (120 x 96 mm). House heights and wall colours are assumed: the public data has outlines only.", font=font(22), fill=(60, 60, 60))
y = HD
for v in rows:
    m = json.load(open(f"{HERE}/data/{v['name']}/meta.json"))
    hh, mm = divmod(v['mins'], 60)
    d.text((G, y + 8), v['title'], font=font(30, True), fill=(20, 20, 20))
    d.text((G, y + 50), f"{v['date'][2]} May {v['date'][0]}, {hh:02d}:{mm:02d} Faroe time, sun {m['sun']['alt']:.0f}° up in the {['N','NE','E','SE','S','SW','W','NW'][int((m['sun']['az'] + 22.5) // 45) % 8]} ({m['sun']['az']:.0f}°)   ·   {v['lens']} mm lens on 4x5   ·   detail box {v['box']} ({m['cell']:g} m cells)", font=font(22), fill=(70, 70, 70))
    for k, mode in enumerate(('before', 'after')):
        im = Image.open(f"{HERE}/out/{v['name']}_{mode}.png").convert('RGB').resize((W, H), Image.LANCZOS); x = G + k * (W + G)
        sheet.paste(im, (x, y + LB)); tag = 'BEFORE' if k == 0 else 'AFTER'
        d.rectangle([x, y + LB, x + 150, y + LB + 40], fill=(0, 0, 0)); d.text((x + 12, y + LB + 6), tag, font=font(24, True), fill=(255, 255, 255))
    y += H + LB + G
d.text((G, y + 8), "Data: Faroese Environment Agency, Umhvørvisstovan: Myndakort, Bygningar, Lendiskort, Topo (webservice, November 2026). Heights: ArcticDEM v4.1, Polar Geospatial Center.", font=font(20), fill=(90, 90, 90))
sheet.save(f"{HERE}/_faroes_round1.png", optimize=True)
best = None
for w in (1800, 1600, 1500, 1400, 1300, 1200, 1100, 1000):   # the widest that stays under 1.5 MB: 256 colours, dithered (no banding in the skies)
    r = sheet.resize((w, round(sheet.height * w / sheet.width)), Image.LANCZOS)
    s = r.quantize(palette=r.quantize(256, method=Image.Quantize.MEDIANCUT), dither=Image.Dither.FLOYDSTEINBERG)
    s.save(f"{HERE}/_faroes_round1_small.png", optimize=True)
    if os.path.getsize(f"{HERE}/_faroes_round1_small.png") < 1_500_000: break
print(sheet.size, os.path.getsize(f"{HERE}/_faroes_round1.png"), s.size, os.path.getsize(f"{HERE}/_faroes_round1_small.png"))
