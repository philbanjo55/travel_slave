"""Sky line of a landscape photo, found automatically (no hand picks).

For every column the boundary between the sky (top) and the land is chosen by one dynamic-programming pass:
score = colour step across the boundary (strong edge) + how sky-like everything above it is (smooth, close to the
top rows' colour), with a penalty for jumps between neighbouring columns. Each column also gets a strength
(the colour step there, relative to the photo's typical step) so weak columns can be left out of the fit.
Returns full-resolution image coordinates.
"""
import numpy as np
import cv2


def _load(path, work_w=720):
    im = cv2.imread(path, cv2.IMREAD_COLOR)
    if im is None:
        raise ValueError('cannot read ' + path)
    H0, W0 = im.shape[:2]
    s = work_w / W0
    im = cv2.resize(im, (work_w, max(8, int(round(H0 * s)))), interpolation=cv2.INTER_AREA)
    return im[:, :, ::-1].astype(np.float32) / 255.0, s, (W0, H0)


def extract(path, work_w=720, jump=0.06, lam_above=0.6, lam_below=0.25):
    """-> dict(x, y, strength (per column, full-res pixels), size=(W, H), good=bool mask)"""
    rgb, s, (W0, H0) = _load(path, work_w)
    h, w = rgb.shape[:2]
    lab = cv2.cvtColor(rgb, cv2.COLOR_RGB2Lab)          # L 0-100, a/b about +-100
    lab = cv2.GaussianBlur(lab, (0, 0), 1.0)
    L = lab[:, :, 0]
    # texture: local gradient size
    gx = cv2.Sobel(L, cv2.CV_32F, 1, 0, ksize=3); gy = cv2.Sobel(L, cv2.CV_32F, 0, 1, ksize=3)
    T = cv2.GaussianBlur(np.hypot(gx, gy), (0, 0), 2.0)
    # vertical colour step at each row: mean of k rows above vs k rows below (cumulative sums per column)
    k = 3
    C = np.concatenate([np.zeros((1, w, 3), np.float32), np.cumsum(lab, axis=0)], 0)
    ys = np.arange(h)
    a0 = np.clip(ys - k, 0, h); a1 = np.clip(ys, 0, h)
    b0 = np.clip(ys + 1, 0, h); b1 = np.clip(ys + 1 + k, 0, h)
    na = np.maximum(a1 - a0, 1)[:, None, None]; nb = np.maximum(b1 - b0, 1)[:, None, None]
    above = (C[a1] - C[a0]) / na; below = (C[b1] - C[b0]) / nb
    d = above - below
    E = np.sqrt((d[:, :, 0]) ** 2 + 0.5 * d[:, :, 1] ** 2 + 0.5 * d[:, :, 2] ** 2)
    # how much of what lies above the row is NOT sky: textured, or far from the top rows' colour (count of pixels)
    top = lab[: max(2, h // 25)].reshape(-1, 3); c0 = np.median(top, 0)
    Ttop = np.percentile(T[: max(2, h // 25)], 75)
    dist = np.sqrt(((lab[:, :, 1:] - c0[1:]) ** 2).sum(-1))              # colour (not brightness) distance
    nonsky = ((T > max(3.0 * Ttop, np.percentile(T, 40))) | (dist > 12)).astype(np.float32)
    cb = np.concatenate([np.zeros((1, w), np.float32), np.cumsum(nonsky, axis=0)], 0)
    A = cb[ys] / (h * 0.02)                                          # 1 = 2 % of the height of non-sky above
    # and how much sky-like ground lies just below it (a cloud edge has smooth sky under it, land does not)
    wb = max(4, int(h * 0.06))
    yb1 = np.clip(ys + 2 + wb, 0, h); yb0 = np.clip(ys + 2, 0, h)
    Bl = (wb - (cb[yb1] - cb[yb0])) / (h * 0.02)                       # sky-like pixels in the window below
    En = E / (np.percentile(E, 90) + 1e-3)
    score = np.minimum(En, 3.0) - lam_above * A - lam_below * Bl
    # rows that cannot be the sky line: the very top and the bottom 3%
    score[: max(2, h // 50)] = -9; score[int(h * 0.97):] = -9
    # dynamic programming with a linear (L1) jump cost, vectorised per column
    g = jump * 1.0                                                   # cost per row of jump
    V = score[:, 0].copy(); back = np.zeros((h, w), np.int32)
    ar = np.arange(h, dtype=np.float32)
    for x in range(1, w):
        up = V + g * ar                       # from k <= y: V(k) - g(y - k)
        cm = np.maximum.accumulate(up); im_up = _argmax_acc(up)
        dn = V - g * ar                       # from k >= y: V(k) - g(k - y)
        cm2 = np.maximum.accumulate(dn[::-1])[::-1]; im_dn = _argmax_acc(dn[::-1])[::-1]; im_dn = h - 1 - im_dn
        c1 = cm - g * ar; c2 = cm2 + g * ar
        use1 = c1 >= c2
        back[:, x] = np.where(use1, im_up, im_dn)
        V = np.where(use1, c1, c2) + score[:, x]
    yb = np.zeros(w, np.int32); yb[-1] = int(np.argmax(V))
    for x in range(w - 1, 0, -1):
        yb[x - 1] = back[yb[x], x]
    st = En[yb, np.arange(w)]
    # sub-pixel: refine on the step strength around the chosen row
    yr = yb.astype(np.float32)
    for x in range(w):
        y0 = yb[x]
        if 1 <= y0 < h - 1:
            e0, e1, e2 = E[y0 - 1, x], E[y0, x], E[y0 + 1, x]
            den = e0 - 2 * e1 + e2
            if den < 0: yr[x] = y0 + 0.5 * (e0 - e2) / den
    X = (np.arange(w) + 0.5) / s - 0.5
    Y = (yr + 0.5) / s - 0.5
    # a column is usable when its step is clear and what lies above it is sky-like
    Aat = A[yb, np.arange(w)]
    good = (st > 0.35) & (Aat < 1.0) & (yb > h * 0.03) & (yb < h * 0.95)
    # every clear colour step in each column (the sky line may be any of them: clouds, snow, a roof): up to K per column,
    # kept at least `sep` rows apart, strongest first. The terrain decides which one is the sky line.
    K, sep = 5, max(3, int(h * 0.012))
    # texture just above each row (a sky line has smooth sky right above it; rock, trees and snow texture do not)
    tex = (T > np.percentile(T, 55)).astype(np.float32)
    ct = np.concatenate([np.zeros((1, w), np.float32), np.cumsum(tex, axis=0)], 0)
    wa = max(3, int(h * 0.025))
    r1 = np.clip(ys - 1, 0, h); r0 = np.clip(ys - 1 - wa, 0, h)
    texab = (ct[r1] - ct[r0]) / np.maximum(r1 - r0, 1)[:, None]
    cand_y = np.full((w, K), np.nan, np.float32); cand_w = np.zeros((w, K), np.float32)
    lo, hi = max(2, h // 50), int(h * 0.97)
    for x in range(w):
        col = En[lo:hi, x]
        pk = np.nonzero((col[1:-1] >= col[:-2]) & (col[1:-1] > col[2:]) & (col[1:-1] > 0.15))[0] + 1
        sc = col[pk] * np.maximum(0.1, 1 - 0.6 * texab[pk + lo, x])
        pk = pk[np.argsort(-sc)]; kept = []
        for p in pk:
            if all(abs(p - q) >= sep for q in kept): kept.append(p)
            if len(kept) == K: break
        for j, p in enumerate(kept):
            cand_y[x, j] = (p + lo + 0.5) / s - 0.5; cand_w[x, j] = min(col[p], 2.0) / 2 * max(0.1, 1 - 0.6 * texab[p + lo, x])
    return dict(x=X, y=Y, strength=st, above=Aat, good=good, size=(W0, H0), work=(w, h), cand_y=cand_y, cand_w=cand_w, texab=texab)


def _argmax_acc(a):
    """index of the running maximum (first occurrence) along axis 0"""
    n = len(a); idx = np.arange(n)
    m = np.maximum.accumulate(a)
    is_new = np.r_[True, a[1:] > m[:-1]]
    return np.maximum.accumulate(np.where(is_new, idx, 0))


if __name__ == '__main__':
    import sys
    r = extract(sys.argv[1])
    print(r['size'], r['good'].mean())
    if len(sys.argv) > 2:
        im = cv2.imread(sys.argv[1])
        for x, y, g in zip(r['x'], r['y'], r['good']):
            cv2.circle(im, (int(x), int(y)), 2, (0, 255, 0) if g else (0, 0, 255), -1)
        cv2.imwrite(sys.argv[2], im)
