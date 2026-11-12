#!/usr/bin/env python3
"""Proof picture, round 2: per view out/<name>_before.png (the app today), _after.png (round 1), _r2.png (round 2)
-> _faroes_round2.png and a small copy under 1.5 MB."""
import json, os
from PIL import Image, ImageDraw, ImageFont
HERE = os.path.dirname(os.path.abspath(__file__))
views = json.load(open(f"{HERE}/views.json"))
def font(sz, bold=False):
    p = f"/usr/share/fonts/truetype/dejavu/DejaVuSans{'-Bold' if bold else ''}.ttf"
    return ImageFont.truetype(p, sz) if os.path.exists(p) else ImageFont.load_default()
W, H, G, LB, HD = 800, 640, 16, 92, 150
rows = [v for v in views if os.path.exists(f"{HERE}/out/{v['name']}_r2.png")]
sheet = Image.new('RGB', (3 * W + 4 * G, HD + len(rows) * (H + LB + G) + 70), (250, 250, 248)); d = ImageDraw.Draw(sheet)
d.text((G, 14), "Faroes 3D sun view: real foreground, round 2 (data test, drawn by a stand-alone renderer, not the app)", font=font(34, True), fill=(20, 20, 20))
d.text((G, 62), "Left: the app today (4 m grid, plain colours).  Middle: round 1.  Right: round 2 = houses from their outlines with pitched roofs, photo colour on the far ground too,", font=font(22), fill=(60, 60, 60))
d.text((G, 96), "rock on steep faces, one calm photo tone, streams and falls. Same camera and sun in a row. House heights are assumed; houses change no sun time.", font=font(22), fill=(60, 60, 60))
y = HD
for v in rows:
    m = json.load(open(f"{HERE}/data2/{v['name']}/meta.json")); hh, mm = divmod(v['mins'], 60)
    d.text((G, y + 8), v['title'], font=font(30, True), fill=(20, 20, 20))
    d.text((G, y + 50), f"{v['date'][2]} May {v['date'][0]}, {hh:02d}:{mm:02d} Faroe time, sun {m['sun']['alt']:.0f}° up in the {['N','NE','E','SE','S','SW','W','NW'][int((m['sun']['az'] + 22.5) // 45) % 8]} ({m['sun']['az']:.0f}°)   ·   {v['lens']} mm lens on 4x5   ·   detail box {v['box']} ({m['cell']:g} m cells)", font=font(22), fill=(70, 70, 70))
    for k, (mode, tag) in enumerate((('before', 'APP TODAY'), ('after', 'ROUND 1'), ('r2', 'ROUND 2'))):
        im = Image.open(f"{HERE}/out/{v['name']}_{mode}.png").convert('RGB').resize((W, H), Image.LANCZOS); x = G + k * (W + G)
        sheet.paste(im, (x, y + LB)); d.rectangle([x, y + LB, x + 170, y + LB + 38], fill=(0, 0, 0)); d.text((x + 12, y + LB + 6), tag, font=font(22, True), fill=(255, 255, 255))
    y += H + LB + G
d.text((G, y + 8), "Data: Faroese Environment Agency, Umhvørvisstovan: Myndakort, Bygningar, Lendiskort, Topo (webservice, November 2026). Heights: ArcticDEM v4.1, Polar Geospatial Center.", font=font(20), fill=(90, 90, 90))
sheet.save(f"{HERE}/_faroes_round2.png", optimize=True)
for w in (1800, 1600, 1500, 1400, 1300, 1200, 1100, 1000):   # the widest that stays under 1.5 MB: 256 colours, dithered
    r = sheet.resize((w, round(sheet.height * w / sheet.width)), Image.LANCZOS)
    s = r.quantize(palette=r.quantize(256, method=Image.Quantize.MEDIANCUT), dither=Image.Dither.FLOYDSTEINBERG); s.save(f"{HERE}/_faroes_round2_small.png", optimize=True)
    if os.path.getsize(f"{HERE}/_faroes_round2_small.png") < 1_500_000: break
print(sheet.size, os.path.getsize(f"{HERE}/_faroes_round2.png"), s.size, os.path.getsize(f"{HERE}/_faroes_round2_small.png"))
