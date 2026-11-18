// Score candidate first/last-light rules against the point events read from pictures (windows from report.md).
const m = require('./model.js'); m.load();
const N = 2048, DXm = m.CFG.W / N, DZm = m.CFG.D / N, D2R = Math.PI / 180;
function vis(c, r, h, ux, uz, tanA) { let L = 30, d = 0, v = 1; for (let k = 0; k < 260; k++) { d += L; const cc = c + ux * d / DXm, rr = r + uz * d / DZm, hh = h + 3 + tanA * d; if (cc < 0 || rr < 0 || cc > N - 1 || rr > N - 1 || hh > 4300) break; const cl = hh - m.hB(cc, rr); if (cl <= 0) return 0; const s = cl / (d * 0.02); if (s < v) v = s; L *= 1.03; } return v; }
const RULES = { 'A old (whole sun, soft edge, no dip)': { off: 0, hard: false, dip: 0 }, 'C top edge + dip (now on the branch)': { off: 0.27, hard: true, dip: 0.95 }, 'D sun centre + dip': { off: 0, hard: true, dip: 0.95 }, 'E half-way (+0.135) + dip': { off: 0.135, hard: true, dip: 0.95 } };
function times(p, date, R) { let first = null, last = null; for (let t = 240; t < 1200; t++) { const s = m.sunPosition(m.msAt(date, t, -7), p.lat, p.lng); const a = s.alt + R.off, dip = R.dip * Math.sqrt(Math.max(0, p.h - 2012) / 1000); const lit = (R.hard ? a > -dip : s.alt > 0) && vis(p.c, p.r, p.h, Math.sin(s.az * D2R), -Math.cos(s.az * D2R), Math.tan(a * D2R)) > (R.hard ? 0 : 0.5); if (lit) { if (first == null) first = t; last = t; } } return { first, last }; }
const P = { S: m.pointAt(43.5972, -110.8707, 3), R: m.pointAt(43.6012, -110.8545, 0), G: m.pointAt(43.7411, -110.8024, 4) };
const hm = s => { const [h, mm] = s.split(':').map(Number); return h * 60 + mm; };
const EV = [ // [group, point, date, which, from, to]
  ['horizon', 'S', '2024-12-19', 'first', '07:40', '07:50'], ['horizon', 'S', '2025-01-27', 'first', '07:40', '07:50'], ['horizon', 'S', '2025-01-28', 'first', '07:40', '07:50'], ['horizon', 'S', '2025-12-14', 'first', '07:50', '08:00'],
  ['horizon', 'R', '2024-12-19', 'first', '07:50', '08:00'], ['horizon', 'R', '2025-01-27', 'first', '07:40', '07:50'],
  ['horizon', 'S', '2024-12-19', 'last', '16:40', '16:50'], ['horizon', 'S', '2025-12-14', 'last', '16:40', '16:50'], ['horizon', 'S', '2025-01-27', 'last', '17:30', '17:40'], ['horizon', 'S', '2025-01-28', 'last', '17:30', '17:40'],
  ['horizon', 'G', '2025-01-27', 'last', '17:30', '17:45'], ['horizon', 'G', '2025-01-28', 'last', '17:30', '17:45'],
  ['ridge', 'R', '2024-12-19', 'last', '15:30', '15:40'], ['ridge', 'R', '2025-01-27', 'last', '16:00', '16:10'], ['ridge', 'R', '2025-12-14', 'last', '15:30', '15:40'], ['ridge', 'R', '2026-01-18', 'last', '15:50', '16:00']];
const cache = {};
for (const [name, R] of Object.entries(RULES)) {
  const g = { horizon: { n: 0, in: 0, abs: 0, sum: 0, worst: 0 }, ridge: { n: 0, in: 0, abs: 0, sum: 0, worst: 0 } };
  for (const [grp, pt, date, which, a, b] of EV) { const k = name + pt + date; const t = cache[k] || (cache[k] = times(P[pt], date, R)); const mod = t[which], lo = hm(a), hi = hm(b), err = mod - (lo + hi) / 2; const x = g[grp]; x.n++; if (mod >= lo && mod <= hi) x.in++; x.abs += Math.abs(err); x.sum += err; x.worst = Math.max(x.worst, Math.abs(err)); }
  const f = x => `${x.in} of ${x.n} inside the picture window, average ${(x.sum / x.n >= 0 ? '+' : '') + (x.sum / x.n).toFixed(1)} min, typical ${(x.abs / x.n).toFixed(1)}, worst ${x.worst.toFixed(1)}`;
  console.log(name + '\n   sunrise/sunset on high points: ' + f(g.horizon) + '\n   ridge blocks the sun:          ' + f(g.ridge));
}
