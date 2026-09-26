// Sun and moon for the stop planner, computed on the phone so it works with
// no signal. Same maths as the database (public.sun_position) and the
// planner mockups: NOAA/Meeus sun with refraction, Meeus ch.47 moon with
// topocentric parallax. Checked against JPL ephemerides: sun azimuth within
// 0.06°, moon within 0.33°, rise/set within about a minute.

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

export type LatLng = { lat: number; lng: number };
export type SkyPos = { az: number; alt: number; geo: number };
export type MoonPos = SkyPos & { illum: number; waxing: boolean };

// Geometric altitude at which the sun's upper limb touches a sea horizon
// (refraction + semi-diameter). Below this there is no direct sun.
export const SUN_UP_GEO = -0.833;
export const TOP_LIGHT_ALT = 35;

function refraction(el: number): number {
  if (el > 85) return 0;
  const te = Math.tan(el * D2R);
  let r: number;
  if (el > 5) r = 58.1 / te - 0.07 / Math.pow(te, 3) + 0.000086 / Math.pow(te, 5);
  else if (el > -0.575) r = 1735 + el * (-518.2 + el * (103.4 + el * (-12.79 + el * 0.711)));
  else r = -20.774 / te;
  return r / 3600;
}

function gmst(jd: number): number {
  const t = (jd - 2451545) / 36525;
  const g = 280.46061837 + 360.98564736629 * (jd - 2451545) + t * t * (0.000387933 - t / 38710000);
  return ((g % 360) + 360) % 360;
}

export function sunPosition(ms: number, lat: number, lng: number): SkyPos {
  const ep = ms / 1000;
  const t = (ep / 86400 + 2440587.5 - 2451545) / 36525;
  let l0 = 280.46646 + t * (36000.76983 + t * 0.0003032);
  l0 -= 360 * Math.floor(l0 / 360);
  const m = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const c = Math.sin(m * D2R) * (1.914602 - t * (0.004817 + 0.000014 * t))
    + Math.sin(2 * m * D2R) * (0.019993 - 0.000101 * t) + Math.sin(3 * m * D2R) * 0.000289;
  const om = 125.04 - 1934.136 * t;
  const lam = l0 + c - 0.00569 - 0.00478 * Math.sin(om * D2R);
  const eps = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60 + 0.00256 * Math.cos(om * D2R);
  const decl = Math.asin(Math.sin(eps * D2R) * Math.sin(lam * D2R));
  const y = Math.pow(Math.tan((eps / 2) * D2R), 2);
  const eot = 4 * R2D * (y * Math.sin(2 * l0 * D2R) - 2 * e * Math.sin(m * D2R)
    + 4 * e * y * Math.sin(m * D2R) * Math.cos(2 * l0 * D2R)
    - 0.5 * y * y * Math.sin(4 * l0 * D2R) - 1.25 * e * e * Math.sin(2 * m * D2R));
  let tst = (ep - 86400 * Math.floor(ep / 86400)) / 60 + eot + 4 * lng;
  tst -= 1440 * Math.floor(tst / 1440);
  const ha = (tst / 4 - 180) * D2R;
  const phi = lat * D2R;
  const geo = R2D * Math.asin(Math.max(-1, Math.min(1,
    Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.cos(ha))));
  const az = R2D * Math.atan2(Math.sin(ha), Math.cos(ha) * Math.sin(phi) - Math.tan(decl) * Math.cos(phi)) + 180;
  return { az: az - 360 * Math.floor(az / 360), alt: geo + refraction(geo), geo };
}

export function moonPosition(ms: number, lat: number, lng: number): MoonPos {
  const jd = ms / 86400000 + 2440587.5;
  const T = (jd - 2451545) / 36525;
  const Lp = 218.3164477 + 481267.88123421 * T;
  const D = 297.8501921 + 445267.1114034 * T;
  const M = 357.5291092 + 35999.0502909 * T;
  const Mp = 134.9633964 + 477198.8675055 * T;
  const F = 93.272095 + 483202.0175233 * T;
  const E = 1 - 0.002516 * T;
  const s = (x: number) => Math.sin(x * D2R);
  const co = (x: number) => Math.cos(x * D2R);
  const sl = 6288774 * s(Mp) + 1274027 * s(2 * D - Mp) + 658314 * s(2 * D) + 213618 * s(2 * Mp) - 185116 * E * s(M) - 114332 * s(2 * F)
    + 58793 * s(2 * D - 2 * Mp) + 57066 * E * s(2 * D - M - Mp) + 53322 * s(2 * D + Mp) + 45758 * E * s(2 * D - M) - 40923 * E * s(M - Mp)
    - 34720 * s(D) - 30383 * E * s(M + Mp) + 15327 * s(2 * D - 2 * F) - 12528 * s(Mp + 2 * F) + 10980 * s(Mp - 2 * F) + 10675 * s(4 * D - Mp)
    + 10034 * s(3 * Mp) + 8548 * s(4 * D - 2 * Mp) - 7888 * E * s(2 * D + M - Mp) - 6766 * E * s(2 * D + M) - 5163 * s(D - Mp) + 4987 * E * s(D + M)
    + 4036 * E * s(2 * D - M + Mp) + 3994 * s(2 * D + 2 * Mp) + 3861 * s(4 * D) + 3665 * s(2 * D - 3 * Mp) - 2689 * E * s(M - 2 * Mp);
  const sb = 5128122 * s(F) + 280602 * s(Mp + F) + 277693 * s(Mp - F) + 173237 * s(2 * D - F) + 55413 * s(2 * D - Mp + F) + 46271 * s(2 * D - Mp - F)
    + 32573 * s(2 * D + F) + 17198 * s(2 * Mp + F) + 9266 * s(2 * D + Mp - F) + 8822 * s(2 * Mp - F) + 8216 * E * s(2 * D - M - F) + 4324 * s(2 * D - 2 * Mp - F);
  const sr = -20905355 * co(Mp) - 3699111 * co(2 * D - Mp) - 2955968 * co(2 * D) - 569925 * co(2 * Mp) + 48888 * E * co(M) - 3149 * co(2 * F)
    + 246158 * co(2 * D - 2 * Mp) - 152138 * E * co(2 * D - M - Mp) - 170733 * co(2 * D + Mp) - 204586 * E * co(2 * D - M) - 129620 * E * co(M - Mp)
    + 108743 * co(D) + 104755 * E * co(M + Mp) + 10321 * co(2 * D - 2 * F) + 79661 * co(Mp - 2 * F) - 34782 * co(4 * D - Mp) - 23210 * co(3 * Mp);
  let lon = Lp + sl / 1e6;
  const bet = sb / 1e6;
  const dist = 385000.56 + sr / 1000;
  const om = 125.04452 - 1934.136261 * T;
  const eps = 23.4392911 - 0.0130042 * T + (9.2 / 3600) * co(om);
  lon += (-17.2 / 3600) * s(om);
  const ra = Math.atan2(s(lon) * co(eps) - Math.tan(bet * D2R) * s(eps), co(lon)) * R2D;
  const dec = Math.asin(s(bet) * co(eps) + co(bet) * s(eps) * s(lon));
  const ha = (gmst(jd) + lng - ra) * D2R;
  const phi = lat * D2R;
  const alt = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(ha)) * R2D;
  const az = Math.atan2(Math.sin(ha), Math.cos(ha) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi)) * R2D + 180;
  const par = Math.asin(6378.14 / dist) * R2D;
  const topo = alt - par * Math.cos(alt * D2R);
  const sunL = 280.46646 + 36000.76983 * T;
  const sunM = 357.52911 + 35999.05029 * T;
  const sunLon = sunL + 1.914602 * s(sunM) + 0.019993 * s(2 * sunM);
  const el = (((lon - sunLon) % 360) + 360) % 360;
  return {
    az: ((az % 360) + 360) % 360, alt: topo + refraction(topo), geo: topo,
    illum: (1 - co(bet) * co(lon - sunLon)) / 2, waxing: el < 180,
  };
}

export function bearingDeg(a: LatLng, b: LatLng): number {
  const p1 = a.lat * D2R, p2 = b.lat * D2R, dl = (b.lng - a.lng) * D2R;
  const br = Math.atan2(Math.sin(dl) * Math.cos(p2),
    Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl)) * R2D;
  return (br + 360) % 360;
}

export function distanceM(a: LatLng, b: LatLng): number {
  const p1 = a.lat * D2R, p2 = b.lat * D2R, dp = p2 - p1, dl = (b.lng - a.lng) * D2R;
  return 2 * 6371008.8 * Math.asin(Math.sqrt(Math.pow(Math.sin(dp / 2), 2)
    + Math.cos(p1) * Math.cos(p2) * Math.pow(Math.sin(dl / 2), 2)));
}

// The point `m` metres from `p` along compass bearing `az`.
export function destination(p: LatLng, az: number, m: number): LatLng {
  const d = m / 6371008.8, br = az * D2R, p1 = p.lat * D2R, l1 = p.lng * D2R;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(br));
  const l2 = l1 + Math.atan2(Math.sin(br) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return { lat: p2 * R2D, lng: ((l2 * R2D + 540) % 360) - 180 };
}

// Terrain skyline (180 values, 2° steps from north) at any azimuth.
export function skylineAt(sky: number[] | null | undefined, az: number): number | null {
  if (!sky || sky.length !== 180) return null;
  const a = ((az % 360) + 360) % 360;
  const x = a / 2, i = Math.floor(x) % 180, f = x - Math.floor(x);
  return sky[i] * (1 - f) + sky[(i + 1) % 180] * f;
}

// Signed angle from `b` to `az`, -180..180 (positive = clockwise / to the right).
export function relAngle(az: number, b: number): number {
  return ((az - b + 540) % 360) - 180;
}

export type LightLabel = 'front' | 'side' | 'backlit' | 'top' | 'in shadow' | 'no sun' | 'no direction';

export type Pair = {
  vantage_id: string;
  code: string | null;
  vantage_name: string | null;
  subject_id: string;
  subject_name: string;
  v: LatLng;
  s: LatLng;
  bearing: number | null;
  dist_m: number;
  v_sky: number[] | null;
  s_sky: number[] | null;
};

export type Light = {
  sun: SkyPos;
  delta: number | null;        // sun vs the vantage->subject line, 0..180
  label: LightLabel;
  sunOnSubject: boolean | null;  // null when there is no skyline for the subject
  sunVisibleFromYou: boolean | null;
};

// Same rules as public.vantage_light: no sun -> shade (a ridge between the sun
// and the subject) -> top light (35°+) -> backlit / side / front by the angle
// between the sun and the line from you to the subject.
export function lightAt(pair: Pair, ms: number): Light {
  const sun = sunPosition(ms, pair.v.lat, pair.v.lng);
  const up = sun.geo >= SUN_UP_GEO;
  const hs = skylineAt(pair.s_sky, sun.az);
  const hv = skylineAt(pair.v_sky, sun.az);
  const delta = pair.bearing == null ? null : Math.abs(relAngle(sun.az, pair.bearing));
  const label: LightLabel = !up ? 'no sun'
    : hs !== null && sun.alt <= hs ? 'in shadow'
    : sun.alt >= TOP_LIGHT_ALT ? 'top'
    : delta == null ? 'no direction'
    : delta <= 45 ? 'backlit' : delta <= 135 ? 'side' : 'front';
  return {
    sun, delta, label,
    sunOnSubject: hs === null ? null : up && sun.alt > hs,
    sunVisibleFromYou: hv === null ? null : up && sun.alt > hv,
  };
}

// ── Local day handling ───────────────────────────────────────────────────
// Minutes 0..1439 of the stop's local day. The offset comes from the server
// (the stop's time zone on that date), so the device's own zone never matters.

export function dayStartMs(date: string, utcOffsetMin: number): number {
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y, m - 1, d) - utcOffsetMin * 60000;
}

export function fmtMinute(min: number): string {
  const v = ((Math.round(min) % 1440) + 1440) % 1440;
  const h = Math.floor(v / 60), m = v % 60, h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m < 10 ? '0' : ''}${m} ${h < 12 ? 'AM' : 'PM'}`;
}

// "9:53 PM" / "21:53" -> minutes after midnight, or null.
export function parseTimeLabel(label: string | null | undefined): number | null {
  if (!label) return null;
  const m = String(label).trim().match(/^(\d{1,2}):(\d{2})\s*([AaPp][Mm])?/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2]);
  const ap = m[3]?.toUpperCase();
  if (ap === 'PM' && h < 12) h += 12;
  if (ap === 'AM' && h === 12) h = 0;
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

export type DayEvents = {
  rise: number | null; riseAz: number | null;
  set: number | null; setAz: number | null;
  goldenAm: number | null;   // sun climbs past 6° (end of morning golden hour)
  goldenPm: number | null;   // sun drops below 6° (start of evening golden hour)
  moonRise: number | null; moonSet: number | null;
  phases: { from: number; to: number; kind: 'night' | 'blue' | 'golden' | 'day' }[];
};

function phaseOf(sun: SkyPos): 'night' | 'blue' | 'golden' | 'day' {
  if (sun.alt < -6) return 'night';
  if (sun.geo < SUN_UP_GEO) return 'blue';
  if (sun.alt < 6) return 'golden';
  return 'day';
}

// One pass over the day, minute by minute (1,441 sun + moon positions, a few ms).
export function dayEvents(p: LatLng, day0: number): DayEvents {
  const out: DayEvents = {
    rise: null, riseAz: null, set: null, setAz: null, goldenAm: null, goldenPm: null,
    moonRise: null, moonSet: null, phases: [],
  };
  let prev = sunPosition(day0, p.lat, p.lng);
  let prevMoon = moonPosition(day0, p.lat, p.lng).geo + 0.833;
  let kind = phaseOf(prev), from = 0;
  // An event falls between minute i-1 and i; interpolate and round to the
  // nearest minute, as almanacs and PhotoPills do (not the minute after).
  const at = (i: number, a: number, b: number) => Math.round(i - 1 + a / (a - b));
  for (let i = 1; i <= 1440; i++) {
    const ms = day0 + i * 60000;
    const s = sunPosition(ms, p.lat, p.lng);
    const g0 = prev.geo - SUN_UP_GEO, g1 = s.geo - SUN_UP_GEO;
    if (g0 < 0 && g1 >= 0 && out.rise == null) { out.rise = at(i, g0, g1); out.riseAz = s.az; }
    if (g0 >= 0 && g1 < 0 && out.set == null) { out.set = at(i, g0, g1); out.setAz = s.az; }
    const a0 = prev.alt - 6, a1 = s.alt - 6;
    if (a0 < 0 && a1 >= 0 && out.goldenAm == null) out.goldenAm = at(i, a0, a1);
    if (a0 >= 0 && a1 < 0 && out.goldenPm == null) out.goldenPm = at(i, a0, a1);
    // Moon rise/set to the USNO convention (upper limb, standard refraction).
    const mv = moonPosition(ms, p.lat, p.lng).geo + 0.833;
    if (prevMoon < 0 && mv >= 0 && out.moonRise == null) out.moonRise = at(i, prevMoon, mv);
    if (prevMoon >= 0 && mv < 0 && out.moonSet == null) out.moonSet = at(i, prevMoon, mv);
    prevMoon = mv;
    const k = phaseOf(s);
    if (k !== kind || i === 1440) {
      out.phases.push({ from, to: i, kind });
      kind = k; from = i;
    }
    prev = s;
  }
  return out;
}
