// The "look": Claude names what is in the photo, with pixel spots, so the terrain search (job.py) knows which
// mountain is which. Without names the search goes wrong on every test scan (heading 25-160 deg off).
import gazetteer from './gazetteer.json' with { type: 'json' };

export const MODEL = 'claude-opus-5-5';
export const PRICE_IN = 4, PRICE_OUT = 20;   // $ per million tokens
export const LOOK_W = 1280;                    // the picture is sent this wide (no resize inside the API)

export type Named = { name: string; type: 'peak' | 'building' | 'point'; lat: number; lng: number; bearing: number; km: number; from: 'gazetteer' | 'subject' };

const KZ = 111132.0;
const kx = (lat: number) => 111320.0 * Math.cos(lat * Math.PI / 180);

export function bearingKm(lat0: number, lng0: number, lat: number, lng: number) {
  const e = (lng - lng0) * kx(lat0), n = (lat - lat0) * KZ;
  return { bearing: (Math.atan2(e, n) * 180 / Math.PI + 360) % 360, km: Math.hypot(e, n) / 1000 };
}

// Named things within `km` of the stop: the prototype gazetteer of the region plus the trip's own subjects.
export function namedNear(region: string, lat: number, lng: number, subjects: any[], km = 25): Named[] {
  const out = new Map<string, Named>();
  const gz = (gazetteer as any)[region] ?? {};
  for (const [name, g] of Object.entries<any>(gz)) {
    const b = bearingKm(lat, lng, g.lat, g.lng);
    if (b.km <= km) out.set(name, { name, type: g.type === 'building' ? 'building' : g.type === 'peak' ? 'peak' : 'point', lat: g.lat, lng: g.lng, ...b, from: 'gazetteer' });
  }
  for (const s of subjects) {
    if (s.lat == null || s.lng == null || !s.name || out.has(s.name)) continue;
    const b = bearingKm(lat, lng, s.lat, s.lng);
    if (b.km > km) continue;
    const kind = String(s.subject_kind ?? '');
    const type = /peak|mountain|summit|ridge/i.test(kind + ' ' + s.name) ? 'peak' : /barn|cabin|church|chapel|building|house/i.test(kind + ' ' + s.name) ? 'building' : 'point';
    out.set(s.name, { name: s.name, type, lat: s.lat, lng: s.lng, ...b, from: 'subject' });
  }
  return [...out.values()].sort((a, b) => a.km - b.km).slice(0, 80);
}

export const SYSTEM = `You help a landscape photographer find where a photo was taken. You see one photo, the trip stop it is filed under, and a list of named places near that stop (with compass bearing and distance from the stop). A terrain search uses your answer to fit the photo to a 3D model of the land, so a wrong name is worse than no name.

Name only things you can actually recognise in the photo, using names from the list exactly as written:
- peak: a named summit or sea stack. x, y = the very top of it in the photo.
- building: a named building (barn, cabin, church). x, y = its centre; x0, x1 = its leftmost and rightmost visible pixel columns.
- point: a named waterfall, village or other small thing. x, y = where it is.
- span: a named hill or ridge that fills part of the sky line without a clear top. x0, x1 = the columns it covers; x, y null.
Pixel coordinates are in the photo as given (x from the left edge, y from the top edge). Use the bearings to check yourself: from one spot, a place with a larger bearing sits further right in the photo. Peaks far away look small; the highest point in the picture is often not the highest mountain. If you are not sure which peak is which, leave it out. Usually 1-4 landmarks are enough.

kind: ground = taken by a person standing on the ground; drone = from the air; close_up = a detail with no land sky line; screenshot = a phone screenshot, map or collage; no_sky = the sky line is hidden (fog, cloud, trees, indoors).`;

export function schema(names: string[]) {
  const NULLNUM = { type: ['number', 'null'] };
  return {
    type: 'object', additionalProperties: false, required: ['kind', 'skyline', 'landmarks', 'note'],
    properties: {
      kind: { type: 'string', enum: ['ground', 'drone', 'close_up', 'screenshot', 'no_sky'] },
      skyline: { type: 'string', description: 'a few words: what forms the sky line' },
      landmarks: { type: 'array', items: { type: 'object', additionalProperties: false,
        required: ['name', 'type', 'x', 'y', 'x0', 'x1', 'confidence'],
        properties: {
          name: names.length ? { type: 'string', enum: names } : { type: 'string' },
          type: { type: 'string', enum: ['peak', 'building', 'point', 'span'] },
          x: NULLNUM, y: NULLNUM, x0: NULLNUM, x1: NULLNUM,
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
        } } },
      note: { type: 'string', description: 'one short line' },
    },
  };
}

export function userText(stop: { name: string; lat: number; lng: number }, named: Named[], w: number, h: number) {
  const lines = named.map(n => `- ${n.name} (${n.type}): bearing ${Math.round(n.bearing)} deg, ${n.km < 1 ? Math.round(n.km * 1000) + ' m' : n.km.toFixed(1) + ' km'}`);
  return `The photo is ${w} x ${h} pixels. It is filed under the stop "${stop.name}" (${stop.lat.toFixed(5)}, ${stop.lng.toFixed(5)}); it was most likely taken within about 2 km of it.

Named places near the stop:
${lines.join('\n') || '(none)'}`;
}

// Size of a JPEG or PNG from its header (the picture Claude sees and the one the worker reads are the same file).
export function imageSize(b: Uint8Array): { w: number; h: number; type: string } | null {
  if (b[0] === 0x89 && b[1] === 0x50) {
    const dv = new DataView(b.buffer, b.byteOffset);
    return { w: dv.getUint32(16), h: dv.getUint32(20), type: 'image/png' };
  }
  if (b[0] !== 0xff || b[1] !== 0xd8) return null;
  let o = 2;
  while (o + 9 < b.length) {
    if (b[o] !== 0xff) { o++; continue; }
    const m = b[o + 1];
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { o += 2; continue; }
    const len = (b[o + 2] << 8) | b[o + 3];
    if ((m >= 0xc0 && m <= 0xc3) || (m >= 0xc5 && m <= 0xc7) || (m >= 0xc9 && m <= 0xcb) || (m >= 0xcd && m <= 0xcf)) {
      return { h: (b[o + 5] << 8) | b[o + 6], w: (b[o + 7] << 8) | b[o + 8], type: 'image/jpeg' };
    }
    o += 2 + len;
  }
  return null;
}

// Claude's landmarks -> what the search reads: pixel spots in the look picture, plus where each named place is.
export function toLook(parsed: any, named: Named[], w: number, h: number) {
  const by = new Map(named.map(n => [n.name, n]));
  const lms = (parsed.landmarks ?? []).filter((L: any) => by.has(L.name)).map((L: any) => {
    const n = by.get(L.name)!;
    const type = L.type === 'span' ? 'span' : n.type === 'building' ? 'building' : L.type === 'peak' || n.type === 'peak' ? 'peak' : 'point';
    const o: any = { name: L.name, type, conf: L.confidence, lat: n.lat, lng: n.lng, gtype: n.type, from: n.from };
    if (type !== 'span') { o.x = L.x; o.y = L.y; }
    if (L.x0 != null && L.x1 != null) { o.x0 = Math.min(L.x0, L.x1); o.x1 = Math.max(L.x0, L.x1); }
    if (type === 'span' && o.x0 == null) return null;
    if (type !== 'span' && (o.x == null || o.y == null)) return null;
    return o;
  }).filter(Boolean);
  return { kind: parsed.kind, skyline: parsed.skyline, note: parsed.note, size: [w, h], landmarks: lms };
}
