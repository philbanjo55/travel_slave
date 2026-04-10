import Constants from 'expo-constants';
import { supabase } from './supabase';

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
