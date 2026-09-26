import { supabase } from './supabase';

const SUPABASE_URL = 'https://ohshrzlvvxyovcjmdajc.supabase.co';

export type ParsedExposure = {
  captured_at: string;       // ISO with -04:00 assumed local (see note)
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
    const tm = traw.match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})\s*([AP]M)/);
    if (tm) {
      let [, d, mo, y, h, mi, sec, ap] = tm;
      let hh = parseInt(h, 10);
      if (ap === 'PM' && hh !== 12) hh += 12;
      if (ap === 'AM' && hh === 12) hh = 0;
      // assume Eastern; store with explicit offset so UTC is correct
      captured = `${y}-${mo}-${d}T${String(hh).padStart(2, '0')}:${mi}:${sec}-04:00`;
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

// md5 is not built into RN; dedupe_key uses the captured_at string directly.
// (Stable + unique per frame to the second, which is what we need.)
function dedupeKey(capturedAt: string): string {
  return capturedAt;
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
    const key = dedupeKey(p.captured_at);
    const photo_url = opts.photoUrls?.[i] ?? null;

    // does it exist?
    const { data: existing } = await supabase
      .from('exposures')
      .select('id')
      .eq('dedupe_key', key)
      .maybeSingle();

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

    if (existing) {
      await supabase.from('exposures').update({ ...row, updated_at: new Date().toISOString() }).eq('id', existing.id);
      updated++;
    } else {
      await supabase.from('exposures').insert(row);
      inserted++;
    }
  }
  return { inserted, updated };
}
