// Round trip: a placement made in full screen, shown in the small view and back, for every lens and both orientations.
// Checks (1) full -> small -> full returns the same points, (2) a photo point lands on the same scene direction in both
// views (offset / focal px equal), using the page's own camera maths (lensFov in app_view.js).
const LENSES = [{ id: '75', f: 75, long: 120, short: 96 }, { id: '90', f: 90, long: 120, short: 96 }, { id: '135', f: 135, long: 120, short: 96 }, { id: '300', f: 300, long: 120, short: 96 }, { id: 'gw690', f: 90, long: 82.6, short: 56 }];
function unitPx(w, h, l) { const a = w / h, th = l.fw / (2 * l.f), tv = l.fh / (2 * l.f), k = Math.max(th / (a * 0.9), tv / 0.9); return h / (2 * k); }
const fitW = (w, h, s) => Math.min(w, h * s);
const toSc = (xf, w, h, l, s) => { const u = unitPx(w, h, l); return { x: xf.x / u, y: xf.y / u, wd: xf.s * fitW(w, h, s) / u }; };
const fromSc = (sc, w, h, l, s) => { const u = unitPx(w, h, l); return { s: sc.wd * u / fitW(w, h, s), x: sc.x * u, y: sc.y * u }; };
// page camera: a view direction (tan from the axis) -> screen offset from the middle, in px
function pageProject(w, h, l, tx, ty) { const a = w / h, th = l.fw / (2 * l.f), tv = l.fh / (2 * l.f), k = Math.max(th / (a * 0.9), tv / 0.9); const fov = 2 * Math.atan(k); const fpx = (h / 2) / Math.tan(fov / 2); return [tx * fpx, ty * fpx]; }
const FULL = { w: 411.4, h: 355.2 }, SMALL = { w: 378.2, h: 206 };
let worst = 0, worstRT = 0, n = 0;
for (const L of LENSES) for (const orient of ['landscape', 'portrait']) for (const shape of [1.25, 0.8, 1.5, 1.0]) {
  const l = { f: L.f, fw: orient === 'portrait' ? L.short : L.long, fh: orient === 'portrait' ? L.long : L.short };
  const xf = { s: 2.26, x: -3.9, y: 45.1 };
  const sc = toSc(xf, FULL.w, FULL.h, l, shape), small = fromSc(sc, SMALL.w, SMALL.h, l, shape);
  const back = fromSc(toSc(small, SMALL.w, SMALL.h, l, shape), FULL.w, FULL.h, l, shape);
  worstRT = Math.max(worstRT, Math.abs(back.s - xf.s), Math.abs(back.x - xf.x), Math.abs(back.y - xf.y));
  // a photo corner: where it sits on screen in each view, then which scene direction that is
  for (const [cx, cy] of [[-0.5, -0.5], [0.5, 0.5], [0.3, -0.2]]) {
    const place = (v, t) => { const pw = fitW(v.w, v.h, shape) * t.s, ph = pw / shape; return [t.x + cx * pw, t.y + cy * ph]; };
    const [fx, fy] = place(FULL, xf), [sx, sy] = place(SMALL, small);
    const [ufx, ufy] = pageProject(FULL.w, FULL.h, l, 1, 1), [usx, usy] = pageProject(SMALL.w, SMALL.h, l, 1, 1);
    const d = Math.hypot(fx / ufx - sx / usx, fy / ufy - sy / usy) * ufx;   // difference in full-screen points
    worst = Math.max(worst, d); n++;
  }
}
console.log(`${n} photo points: worst scene mismatch ${worst.toExponential(2)} pt; full->small->full worst ${worstRT.toExponential(2)}`);
