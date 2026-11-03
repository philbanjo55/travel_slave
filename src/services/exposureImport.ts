import { supabase } from './supabase';

const SUPABASE_URL = 'https://ohshrzlvvxyovcjmdajc.supabase.co';

export type ParsedExposure = {
  captured_at: string;       // ISO with the UTC offset of where it was shot (see applyShotTimeZones)
  local_time: string;        // the meter's wall-clock time, no zone: "2026-12-30T07:12:00"
  tz: string | null;         // time zone used for captured_at (null = the phone's own)
  lat: number | null;
  lng: number | null;
  ev: number | null;
  iso: number | null;
  aperture: number | null;
  shutter_seconds: number | null;
  shutter_display: string | null;
  adjust_ev: number | null;
  nd_ev: number | null;
  meter_name: string | null;
  filter: string | null;
  film_stock: string | null;
  notes: string | null;
  raw_text: string;
  imageIndex: number | null; // which media image pairs with this (sequential)
};

const KNOWN_STOCKS: [string, string][] = [
  ['delta 100', 'Delta 100'],
  ['t-max 100', 'T-Max 100'],
  ['tmax 100', 'T-Max 100'],
  ['t-max 400', 'T-Max 400'],
  ['tmax 400', 'T-Max 400'],
  ['pan f', 'Pan F+'],
  ['tri-x', 'Tri-X 400'],
  ['trix', 'Tri-X 400'],
  ['hp5', 'HP5+'],
  ['fp4', 'FP4+'],
];

function detectFilm(notes: string): string | null {
  const low = notes.toLowerCase();
  for (const [needle, name] of KNOWN_STOCKS) {
    if (low.includes(needle)) return name;
  }
  return null;
}

// Notes minus the film line becomes the "filter / technique" line.
function splitNotes(notes: string): { filter: string | null; film: string | null } {
  const film = detectFilm(notes);
  const lines = notes.split('\n').map(l => l.trim()).filter(Boolean);
  const filterLines = lines.filter(l => {
    const low = l.toLowerCase();
    return !KNOWN_STOCKS.some(([needle]) => low === needle || low.includes(needle));
  });
  return { filter: filterLines.join(' ') || null, film };
}

// Clean trailing binary junk that can bleed into the last text field.
function cleanLine(ln: string): string {
  // strip a trailing ALLCAPS junk run glued to digits: "100MQ" -> "100"
  return ln.replace(/(\d)([A-Z]{2,}.*)$/, '$1').trim();
}

function parseShutter(raw: string): number | null {
  raw = raw.trim();
  if (!raw) return null;
  if (raw.includes('/')) {
    const m = raw.replace('s', '').split('/');
    const num = parseFloat(m[0]);
    const den = parseFloat(m[1]);
    if (den) return num / den;
    return null;
  }
  const v = parseFloat(raw.replace('s', ''));
  return isNaN(v) ? null : v;
}

function grab(label: string, block: string): string | null {
  const re = new RegExp(label + ':\\s*([^\\n]+)');
  const m = block.match(re);
  return m ? m[1].trim() : null;
}

// Parse the shared/exported text (one block per "Meter:" occurrence).
// Works for a single exposure or many concatenated in one note.
export function parseExposureText(text: string): ParsedExposure[] {
  // normalize: drop non-printable except newline
  const clean = Array.from(text)
    .map(c => (c === '\n' || (c.charCodeAt(0) >= 32 && c.charCodeAt(0) < 127) ? c : ''))
    .join('');

  const starts: number[] = [];
  const re = /Meter:/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(clean)) !== null) starts.push(m.index);
  if (starts.length === 0) return [];

  const out: ParsedExposure[] = [];
  for (let i = 0; i < starts.length; i++) {
    const block = clean.slice(starts[i], i + 1 < starts.length ? starts[i + 1] : clean.length);

    // time: DD/MM/YYYY HH:MM:SS AM/PM  (app exports day/month/year)
    const traw = grab('Time', block) || '';
    let captured = '';
    let local = '';
    const tm = traw.match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})\s*([AP]M)/);
    if (tm) {
      let [, d, mo, y, h, mi, sec, ap] = tm;
      let hh = parseInt(h, 10);
      if (ap === 'PM' && hh !== 12) hh += 12;
      if (ap === 'AM' && hh === 12) hh = 0;
      // The meter app writes the phone's local time, so use the phone's UTC
      // offset at that moment (was a fixed -04:00, US Eastern summer, which
      // put every frame shot elsewhere at the wrong time).
      // applyShotTimeZones() then swaps in the zone of where the frame was shot, when the
      // frame has a location near a trip stop (importing Teton frames at home in Eastern time
      // would otherwise move them 2 hours).
      local = `${y}-${mo}-${d}T${String(hh).padStart(2, '0')}:${mi}:${sec}`;
      captured = local + offsetText(-new Date(+y, +mo - 1, +d, hh, +mi, +sec).getTimezoneOffset());
    }

    const loc = grab('Location', block) || '';
    let lat: number | null = null, lng: number | null = null;
    const lm = loc.match(/(-?\d+\.\d+),\s*(-?\d+\.\d+)/);
    if (lm) { lat = parseFloat(lm[1]); lng = parseFloat(lm[2]); }

    // notes: everything after "Notes:" to end of block, cleaned line-by-line
    let notes = '';
    const nm = block.match(/Notes:\s*([\s\S]+)/);
    if (nm) {
      const lines = nm[1].split('\n');
      const kept: string[] = [];
      for (let ln of lines) {
        ln = ln.replace(/\r/g, '').trimEnd();
        if (!ln) { if (kept.length) break; else continue; }
        const alnum = Array.from(ln).filter(c => /[a-zA-Z0-9 ]/.test(c)).length;
        if (ln.includes('@') || alnum / Math.max(ln.length, 1) < 0.6) break;
        kept.push(cleanLine(ln));
      }
      notes = kept.join('\n');
    }

    const { filter, film } = splitNotes(notes);
    const apRaw = grab('Aperture', block);
    const evRaw = grab('EV', block);
    const isoRaw = grab('ISO', block);
    const adjRaw = grab('Adjust EV', block);
    const ndRaw = grab('ND EV', block);
    const ss = grab('Shutter Speed', block) || '';

    out.push({
      captured_at: captured,
      local_time: local,
      tz: null,
      lat, lng,
      ev: evRaw ? parseFloat(evRaw) : null,
      iso: isoRaw ? parseInt(isoRaw, 10) : null,
      aperture: apRaw ? parseFloat(apRaw) : null,
      shutter_seconds: parseShutter(ss),
      shutter_display: ss.trim() || null,
      adjust_ev: adjRaw !== null ? parseFloat(adjRaw) : null,
      nd_ev: ndRaw !== null ? parseFloat(ndRaw) : null,
      meter_name: grab('Meter Name', block),
      filter,
      film_stock: film,
      notes: notes || null,
      raw_text: block.trim(),
      imageIndex: i, // sequential pairing
    });
  }
  return out;
}

function offsetText(minutes: number): string {
  const sign = minutes < 0 ? '-' : '+', a = Math.abs(minutes);
  return `${sign}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`;
}

// UTC offset (minutes) of an IANA zone at a wall-clock time there.
export function zoneOffsetAt(tz: string, local: string): number | null {
  const m = local.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/);
  if (!m) return null;
  const wall = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  const offsetOf = (utc: number) => {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(new Date(utc));
    const g = (t: string) => Number(parts.find(p => p.type === t)?.value);
    return (Date.UTC(g('year'), g('month') - 1, g('day'), g('hour') % 24, g('minute'), g('second')) - utc) / 60000;
  };
  try {
    const first = offsetOf(wall);
    return offsetOf(wall - first * 60000);
  } catch { return null; }
}

// The time zone of the trip with a stop within ~50 km of a frame, or null.
async function zoneNear(lat: number, lng: number): Promise<{ tz: string; trip: string } | null> {
  const { data, error } = await supabase.from('stops')
    .select('lat, lng, days!inner(trips!inner(title, timezone))')
    .gte('lat', lat - 0.5).lte('lat', lat + 0.5).gte('lng', lng - 0.7).lte('lng', lng + 0.7)
    .limit(20);
  if (error || !data?.length) return null;
  for (const r of data as any[]) {
    const t = r.days?.trips;
    if (t?.timezone) return { tz: t.timezone, trip: t.title };
  }
  return null;
}

// Re-time each frame in the zone where it was shot (from a trip stop near its location);
// frames with no location, or far from every trip, keep the phone's zone.
export async function applyShotTimeZones(parsed: ParsedExposure[]): Promise<ParsedExposure[]> {
  const seen = new Map<string, { tz: string; trip: string } | null>();
  const out: ParsedExposure[] = [];
  for (const p of parsed) {
    if (!p.local_time || p.lat == null || p.lng == null) { out.push(p); continue; }
    const k = `${p.lat.toFixed(1)},${p.lng.toFixed(1)}`;
    if (!seen.has(k)) seen.set(k, await zoneNear(p.lat, p.lng).catch(() => null));
    const z = seen.get(k);
    const off = z ? zoneOffsetAt(z.tz, p.local_time) : null;
    out.push(z && off != null ? { ...p, tz: z.tz, captured_at: p.local_time + offsetText(off) } : p);
  }
  return out;
}

// One frame = one meter reading to the second. The key is the meter's wall-clock time (no
// zone), so re-importing a frame with a corrected zone updates it instead of adding a copy.
function dedupeKey(p: ParsedExposure): string {
  return p.local_time || p.captured_at;
}

// Upload a photo (base64) to Storage via the edge function; returns public URL.
export async function uploadExposurePhoto(path: string, base64: string): Promise<string | null> {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/upload-exposure-photo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, base64 }),
    });
    const json = await res.json();
    return json.url || null;
  } catch (e) {
    console.warn('Photo upload failed:', e);
    return null;
  }
}

// Upsert parsed exposures into the DB (idempotent on dedupe_key).
export async function importExposures(
  parsed: ParsedExposure[],
  opts: { source: string; source_file?: string; photoUrls?: (string | null)[] } = { source: 'manual' }
): Promise<{ inserted: number; updated: number }> {
  let inserted = 0, updated = 0;
  for (let i = 0; i < parsed.length; i++) {
    const p = parsed[i];
    if (!p.captured_at) continue;
    const key = dedupeKey(p);
    const photo_url = opts.photoUrls?.[i] ?? null;

    // does it exist? (older imports keyed on the full time with its zone, so match the prefix)
    const { data: found, error: findErr } = await supabase
      .from('exposures')
      .select('id')
      .like('dedupe_key', `${key}%`)
      .limit(1);
    if (findErr) throw findErr;
    const existing = found?.[0] ?? null;

    const row: any = {
      captured_at: p.captured_at,
      lat: p.lat, lng: p.lng, ev: p.ev, iso: p.iso, aperture: p.aperture,
      shutter_seconds: p.shutter_seconds, shutter_display: p.shutter_display,
      adjust_ev: p.adjust_ev, nd_ev: p.nd_ev, meter_name: p.meter_name,
      filter: p.filter, film_stock: p.film_stock, notes: p.notes,
      raw_text: p.raw_text, source: opts.source, source_file: opts.source_file ?? null,
      dedupe_key: key,
    };
    if (photo_url) row.photo_url = photo_url;

    // Every write is checked: supabase returns an error instead of throwing, and an import
    // that says "Imported" when nothing was saved loses the pasted text (Nov 2 test).
    if (existing) {
      const { error } = await supabase.from('exposures').update({ ...row, updated_at: new Date().toISOString() }).eq('id', existing.id);
      if (error) throw error;
      updated++;
    } else {
      const { error } = await supabase.from('exposures').insert(row);
      if (error) throw error;
      inserted++;
    }
  }
  return { inserted, updated };
}
