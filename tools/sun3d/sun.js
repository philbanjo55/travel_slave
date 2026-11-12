// Sun position for a fixed date at a fixed place (NOAA solar equations). mins = local MST minutes.
function sunPos(mins, lat, lng) {
  const R = Math.PI / 180;
  const JD = Date.UTC(2026, 11, 30) / 86400000 + 2440587.5 + (mins / 60 + 7) / 24;
  const T = (JD - 2451545) / 36525;
  const L0 = (280.46646 + T * (36000.76983 + 0.0003032 * T)) % 360;
  const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
  const C = Math.sin(M * R) * (1.914602 - T * (0.004817 + 0.000014 * T)) + Math.sin(2 * M * R) * (0.019993 - 0.000101 * T) + Math.sin(3 * M * R) * 0.000289;
  const om = 125.04 - 1934.136 * T;
  const lam = L0 + C - 0.00569 - 0.00478 * Math.sin(om * R);
  const eps = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60 + 0.00256 * Math.cos(om * R);
  const decl = Math.asin(Math.sin(eps * R) * Math.sin(lam * R));
  const y = Math.tan(eps * R / 2) ** 2;
  const eot = 4 / R * (y * Math.sin(2 * L0 * R) - 2 * e * Math.sin(M * R) + 4 * e * y * Math.sin(M * R) * Math.cos(2 * L0 * R) - 0.5 * y * y * Math.sin(4 * L0 * R) - 1.25 * e * e * Math.sin(2 * M * R));
  const tst = (((mins + 420) + eot + 4 * lng) % 1440 + 1440) % 1440;
  const ha = (tst / 4 - 180) * R;
  const cz = Math.sin(lat * R) * Math.sin(decl) + Math.cos(lat * R) * Math.cos(decl) * Math.cos(ha);
  const zen = Math.acos(Math.max(-1, Math.min(1, cz)));
  let alt = 90 - zen / R;
  let a = Math.acos(Math.max(-1, Math.min(1, (Math.sin(lat * R) * Math.cos(zen) - Math.sin(decl)) / (Math.cos(lat * R) * Math.sin(zen))))) / R;
  const az = ha > 0 ? (a + 180) % 360 : (540 - a) % 360;
  if (alt > -0.575) alt += 1.02 / Math.tan((alt + 10.3 / (alt + 5.11)) * R) / 60;
  return { alt, az };
}
