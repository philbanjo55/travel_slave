// Reads a coordinate pair from whatever gets pasted: Google Maps' copied
// "62.085177, -7.366927", a Google Maps link (…/@62.08,-7.36,15z or ?q=…),
// or degrees/minutes/seconds like 62°05'06.6"N 7°22'01.0"W.

export type Coords = { lat: number; lng: number };

function valid(lat: number, lng: number): Coords | null {
  if (!isFinite(lat) || !isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6 };
}

export function parseCoords(input: string | null | undefined): Coords | null {
  const s = String(input ?? '').trim();
  if (!s) return null;

  // Degrees, minutes, seconds with hemisphere letters.
  const dms = /(\d{1,3})\s*°\s*(\d{1,2})?\s*['′]?\s*(\d{1,2}(?:[.,]\d+)?)?\s*(?:["″]|'')?\s*([NSEW])/gi;
  const parts: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = dms.exec(s)) && parts.length < 2) {
    const v = Number(m[1]) + Number(m[2] || 0) / 60 + Number((m[3] || '0').replace(',', '.')) / 3600;
    const h = m[4].toUpperCase();
    parts.push(h === 'S' || h === 'W' ? -v : v);
  }
  if (parts.length === 2) return valid(parts[0], parts[1]);

  // Links: prefer an explicit place (q=, query=, ll=, !3d…!4d…) over the map centre (@).
  const place = s.match(/[?&](?:q|query|ll|destination)=(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/i)
    || s.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/)
    || s.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (place) return valid(Number(place[1]), Number(place[2]));

  // Plain "lat, lng" / "lat lng" / "lat;lng".
  const plain = s.match(/(-?\d{1,3}(?:\.\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:\.\d+)?)/);
  if (plain) return valid(Number(plain[1]), Number(plain[2]));
  return null;
}

export function formatCoords(c: Coords | null | undefined): string {
  return c ? `${c.lat.toFixed(6)}, ${c.lng.toFixed(6)}` : '';
}
