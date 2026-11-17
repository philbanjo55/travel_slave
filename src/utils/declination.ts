// Magnetic declination (degrees, east positive) from the World Magnetic Model 2025, worked out on the phone with no
// signal (Walk to shot, 17 Nov 2026). Android's own "true heading" uses the declination at the phone's last known fix,
// which can be from home (Washington DC is about 10 deg W, Jackson about 10 deg E): a 20 deg wrong arrow. So the app
// turns the compass's magnetic heading to true north itself, at where the phone is now.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Model = require('../vendor/geomagnetism/lib/model.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const WMM2025 = require('../vendor/geomagnetism/data/wmm-2025.json');

let model: any = null;
let cache: { key: string; dec: number } | null = null;

export function declinationDeg(lat: number, lng: number, when: Date = new Date()): number | null {
  try {
    const key = `${lat.toFixed(1)},${lng.toFixed(1)},${when.getUTCFullYear()}-${when.getUTCMonth()}`;
    if (cache && cache.key === key) return cache.dec;
    if (!model) model = new Model(WMM2025);
    const dec = model.getTimedModel(when, false).point([lat, lng]).decl as number;
    if (!Number.isFinite(dec)) return null;
    cache = { key, dec };
    return dec;
  } catch {
    return null;
  }
}
