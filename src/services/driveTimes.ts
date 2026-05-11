import Constants from 'expo-constants';
import { supabase } from './supabase';
import { addMinutesToTimeLabel } from '../utils/helpers';

const getApiKey = (): string => {
  return Constants.expoConfig?.extra?.googleMapsApiKey || '';
};

interface DirectionsResult {
  duration_minutes: number;
  distance_km: number;
}

async function getDirections(
  fromLat: number, fromLng: number,
  toLat: number, toLng: number
): Promise<DirectionsResult | null> {
  const apiKey = getApiKey();
  if (!apiKey) {
    console.warn('No Google Maps API key available');
    return null;
  }

  const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${fromLat},${fromLng}&destination=${toLat},${toLng}&key=${apiKey}`;

  try {
    const res = await fetch(url);
    const data = await res.json();

    if (data.status !== 'OK' || !data.routes?.length) {
      console.warn('Directions API error:', data.status);
      return null;
    }

    const leg = data.routes[0].legs[0];
    return {
      duration_minutes: Math.round(leg.duration.value / 60),
      distance_km: Math.round(leg.distance.value / 100) / 10,
    };
  } catch (err) {
    console.warn('Directions fetch failed:', err);
    return null;
  }
}

export async function calculateDriveTimesForTrip(tripId: string): Promise<{
  updated: number;
  skipped: number;
  failed: number;
}> {
  // Fetch all days and stops for the trip
  const { data: days, error: daysError } = await supabase
    .from('days')
    .select('id, day_number')
    .eq('trip_id', tripId)
    .order('day_number', { ascending: true });

  if (daysError || !days) throw new Error('Failed to fetch days');

  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (const day of days) {
    const { data: stops, error: stopsError } = await supabase
      .from('stops')
      .select('id, position, lat, lng, name')
      .eq('day_id', day.id)
      .order('position', { ascending: true });

    if (stopsError || !stops) continue;

    for (let i = 1; i < stops.length; i++) {
      const prev = stops[i - 1];
      const curr = stops[i];

      // Skip if either stop has no coords
      if (!prev.lat || !prev.lng || !curr.lat || !curr.lng) {
        skipped++;
        continue;
      }

      // Skip if same location (< 0.001 degree ~ 100m)
      if (Math.abs(prev.lat - curr.lat) < 0.001 && Math.abs(prev.lng - curr.lng) < 0.001) {
        // Same spot, set to 0
        await supabase
          .from('stops')
          .update({ drive_override_minutes: 0 })
          .eq('id', curr.id);
        updated++;
        continue;
      }

      const result = await getDirections(prev.lat, prev.lng, curr.lat, curr.lng);

      if (result) {
        await supabase
          .from('stops')
          .update({ drive_override_minutes: result.duration_minutes })
          .eq('id', curr.id);
        updated++;
      } else {
        failed++;
      }

      // Rate limit: small delay between API calls
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }

  return { updated, skipped, failed };
}

// ─────────────────────────────────────────
// TIME LABEL CASCADE
// ─────────────────────────────────────────

/**
 * Stops with these patterns are treated as anchors (their time_label is the
 * source of truth and is never overwritten). Used for flights or other
 * stops with externally-fixed times.
 */
function isAnchorStop(name: string): boolean {
  if (!name) return false;
  return name.includes('\u2192') || /\bflight\b/i.test(name);
}

/**
 * Cascade time_labels across each day of a trip.
 *
 * For each day:
 *   - Finds the first stop with a time_label (the anchor)
 *   - For every subsequent stop, computes the new time_label as
 *     prev_cursor + prev.duration_minutes + curr.drive_override_minutes
 *   - Skips flight/anchor stops (preserves their existing time_label, but
 *     re-anchors the cursor to that time)
 *   - Preserves the "~" prefix convention (approximate times stay ~)
 *
 * Only writes to the DB when the new label differs from the existing one.
 */
export async function recalculateTimeLabels(tripId: string): Promise<{
  stopsUpdated: number;
  daysProcessed: number;
}> {
  const { data: days, error: daysError } = await supabase
    .from('days')
    .select('id, day_number')
    .eq('trip_id', tripId)
    .order('day_number', { ascending: true });

  if (daysError || !days) throw new Error('Failed to fetch days');

  let stopsUpdated = 0;
  let daysProcessed = 0;

  for (const day of days) {
    const { data: stops, error: stopsError } = await supabase
      .from('stops')
      .select('id, position, name, time_label, duration_minutes, drive_override_minutes')
      .eq('day_id', day.id)
      .order('position', { ascending: true });

    if (stopsError || !stops || stops.length < 2) continue;

    // Find the first stop with a usable time_label — that's the anchor
    let cursor: string | null = null;
    let anchorIdx = -1;
    for (let i = 0; i < stops.length; i++) {
      if (stops[i].time_label) {
        cursor = stops[i].time_label;
        anchorIdx = i;
        break;
      }
    }

    if (cursor === null || anchorIdx === -1) continue;

    daysProcessed++;

    // Cascade forward from the anchor
    for (let i = anchorIdx + 1; i < stops.length; i++) {
      const prev = stops[i - 1];
      const curr = stops[i];

      const minutesToAdd =
        (prev.duration_minutes || 0) + (curr.drive_override_minutes || 0);

      // Strip "~" from cursor before passing to helper (helper expects clean)
      const cleanCursor = cursor!.replace(/^~\s*/, '');
      const computed = addMinutesToTimeLabel(cleanCursor, minutesToAdd);

      // Flight or other anchor stops: preserve existing label, but re-anchor cursor
      if (isAnchorStop(curr.name)) {
        if (curr.time_label) {
          cursor = curr.time_label;
        } else {
          cursor = computed;
        }
        continue;
      }

      // Preserve the "~" prefix convention
      const keepTilde = curr.time_label?.startsWith('~') ?? false;
      const finalLabel = keepTilde ? `~${computed}` : computed;

      if (finalLabel !== curr.time_label) {
        const { error } = await supabase
          .from('stops')
          .update({ time_label: finalLabel })
          .eq('id', curr.id);
        if (!error) stopsUpdated++;
      }

      cursor = computed;
    }
  }

  return { stopsUpdated, daysProcessed };
}
