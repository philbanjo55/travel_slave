"""Small numpy picture of our terrain from a pose (for checking a solve by eye): every pixel's ray is marched over
the height grids; land is shaded by distance haze and a fixed afternoon light, buildings brown, sky blue."""
import math
import numpy as np
from terrain import stack_at, kx, KZ, R7
import camera as C


def render(grids, lat, lng, eyeh, q, W, H, out_w=360, dmax=40000.0, nd=700, house=None):
    w = out_w; h = max(2, int(round(out_w * H / W)))
    xs = (np.arange(w) + 0.5) * W / w; ys = (np.arange(h) + 0.5) * H / h
    X, Y = np.meshgrid(xs, ys)
    f, r, u = C.axes(q[0], q[1], q[2]); fp = C.fpx(q[3], W)
    D = f[None] * fp + r[None] * (X.ravel()[:, None] - W / 2) - u[None] * (Y.ravel()[:, None] - H / 2)
    D /= np.linalg.norm(D, axis=1)[:, None]
    t = np.geomspace(3.0, dmax, nd); k = kx(lat)
    hit = np.full(len(D), np.nan); hx = np.zeros(len(D)); hy = np.zeros(len(D)); isb = np.zeros(len(D), bool)
    G = ([house] if house is not None else []) + grids
    for s in range(0, len(D), 3000):
        d = D[s:s + 3000]
        E = d[:, 0:1] * t[None]; N = d[:, 1:2] * t[None]; U = eyeh + d[:, 2:3] * t[None] - (E * E + N * N) / (2 * R7)
        la = lat + N / KZ; lo = lng + E / k
        g = stack_at(G, la.ravel(), lo.ravel()).reshape(la.shape)
        below = U < g; anyb = below.any(1); j = np.argmax(below, 1)
        idx = np.nonzero(anyb)[0]; jj = j[idx]
        hit[s + idx] = t[jj]; hx[s + idx] = la[idx, jj]; hy[s + idx] = lo[idx, jj]
        if house is not None:
            hb = house.at(la[idx, jj], lo[idx, jj]); isb[s + idx] = np.isfinite(hb) & (np.abs(hb - g[idx, jj]) < 0.5)
    img = np.zeros((len(D), 3), np.float32)
    sky = np.isnan(hit)
    elev = np.degrees(np.arcsin(np.clip(D[:, 2], -1, 1)))
    img[sky] = np.stack([0.55 + 0.002 * elev[sky], 0.70 + 0.002 * elev[sky], 0.92 + 0 * elev[sky]], 1)
    L = ~sky
    if L.any():
        la = hx[L]; lo = hy[L]; e = 3.0
        gx = (stack_at(grids, la, lo + e / k) - stack_at(grids, la, lo - e / k)) / (2 * e)
        gy = (stack_at(grids, la + e / KZ, lo) - stack_at(grids, la - e / KZ, lo)) / (2 * e)
        nrm = np.stack([-np.nan_to_num(gx), -np.nan_to_num(gy), np.ones(L.sum())], 1); nrm /= np.linalg.norm(nrm, axis=1)[:, None]
        sun = np.array([math.sin(math.radians(225)) * 0.6, math.cos(math.radians(225)) * 0.6, 0.8]); sun /= np.linalg.norm(sun)
        lit = np.clip(nrm @ sun, 0, 1) * 0.75 + 0.25
        base = np.where(isb[L, None], np.array([0.45, 0.30, 0.20]), np.array([0.82, 0.84, 0.86]))
        haze = 1 - np.exp(-hit[L] / 25000.0)
        col = base * lit[:, None]
        col = col * (1 - haze[:, None]) + np.array([0.70, 0.76, 0.86]) * haze[:, None]
        img[L] = col
    return (np.clip(img.reshape(h, w, 3), 0, 1) * 255).astype(np.uint8)
