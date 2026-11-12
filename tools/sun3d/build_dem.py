# Build the demo's elevation file from public terrarium tiles (zoom 12) on a regular lat/lng grid.
# Output: a 16-bit greyscale PNG whose "pixels" are prediction residuals (left + up - upleft), filter 0,
# so the page can decode it exactly with DecompressionStream, no canvas.
import math, struct, sys, zlib
import numpy as np
from PIL import Image
S = sys.argv[1]
Z, X0, X1, Y0, Y1 = 12, 785, 793, 1490, 1498
NORTH, SOUTH, WEST, EAST, N = 43.95, 43.45, -110.92, -110.24, 2048
mos = np.zeros(((Y1 - Y0 + 1) * 256, (X1 - X0 + 1) * 256), dtype=np.float64)
for x in range(X0, X1 + 1):
    for y in range(Y0, Y1 + 1):
        a = np.asarray(Image.open(f"{S}/tiles/{Z}_{x}_{y}.png").convert("RGB"), dtype=np.float64)
        mos[(y - Y0) * 256:(y - Y0 + 1) * 256, (x - X0) * 256:(x - X0 + 1) * 256] = a[:, :, 0] * 256 + a[:, :, 1] + a[:, :, 2] / 256 - 32768
lat = NORTH - (np.arange(N) + 0.5) * (NORTH - SOUTH) / N
lng = WEST + (np.arange(N) + 0.5) * (EAST - WEST) / N
px = ((lng + 180) / 360 * 2 ** Z - X0) * 256 - 0.5
py = ((1 - np.arcsinh(np.tan(np.radians(lat))) / math.pi) / 2 * 2 ** Z - Y0) * 256 - 0.5
x0 = np.floor(px).astype(int); fx = px - x0; y0 = np.floor(py).astype(int); fy = py - y0
A = mos[np.ix_(y0, x0)]; B = mos[np.ix_(y0, x0 + 1)]; C = mos[np.ix_(y0 + 1, x0)]; D = mos[np.ix_(y0 + 1, x0 + 1)]
h = (A * (1 - fx) + B * fx) * (1 - fy)[:, None] + (C * (1 - fx) + D * fx) * fy[:, None]
def at(la, ln): return h[int((NORTH - la) / (NORTH - SOUTH) * N), int((ln - WEST) / (EAST - WEST) * N)]
print("min %.0f max %.0f  grand %.0f moran %.0f oxbow %.0f sro %.0f" % (h.min(), h.max(), h[840:880, 330:380].max(), at(43.8350, -110.7765), at(43.8662, -110.5477), at(43.7537, -110.6241)))
iy, ix = np.unravel_index(np.argmax(h), h.shape); print("highest at", NORTH - (iy + .5) * .5 / N, WEST + (ix + .5) * .68 / N)
q = np.clip(np.round((h - 1500) * 2), 0, 65535).astype(np.int64)
p = np.zeros((N + 1, N + 1), dtype=np.int64); p[1:, 1:] = q
res = ((p[1:, 1:] - p[1:, :-1] - p[:-1, 1:] + p[:-1, :-1]) % 65536).astype('>u2')
raw = b''.join(b'\x00' + res[i].tobytes() for i in range(N))
def chunk(t, d): return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', N, N, 16, 0, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b'')
open(f"{S}/site/teton-dem.png", 'wb').write(png)
print("png bytes", len(png))
