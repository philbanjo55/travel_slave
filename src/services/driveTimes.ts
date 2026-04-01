/**
 * Drive time calculator using Google Maps Directions API
 * Fetches real road times between stops and caches in Supabase
 */

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;

interface LatLng {
  lat: number;
  lng: number;
}

interface DriveResult {
  duration_minutes: number;
  distance_km: number;
}

/**
 * Fetch real drive time between two points from Google Maps
 */
export async function getDriveTime(
  origin: LatLng,
  destination: LatLng
): Promise<DriveResult | null> {
  if (!GOOGLE_MAPS_API_KEY) {
    console.warn('No Google Maps API key — using straight-line estimate');
    return null;
  }

  try {
    const url = `https://maps.googleapis.com/maps/api/directions/json?` +
      `origin=${origin.lat},${origin.lng}` +
      `&destination=${destination.lat},${destination.lng}` +
      `&mode=driving` +
      `&key=${GOOGLE_MAPS_API_KEY}`;

    const response = await fetch(url);
    const data = await response.json();

    if (data.status !== 'OK' || !data.routes.length) return null;

    const leg = data.routes[0].legs[0];
    return {
      duration_minutes: Math.round(leg.duration.value / 60),
      distance_km: Math.round(leg.distance.value / 100) / 10,
    };
  } catch (err) {
    console.error('Drive time fetch failed:', err);
    return null;
  }
}

/**
 * Calculate and cache drive times for all stops in a day
 */
export async function calculateDayDriveTimes(
  stops: any[],
  supabase: any
): Promise<void> {
  const stopsWithLocation = stops.filter(s => s.lat && s.lng);

  for (let i = 0; i < stopsWithLocation.length - 1; i++) {
    const from = stopsWithLocation[i];
    const to = stopsWithLocation[i + 1];

    // Check if already cached
    const { data: cached } = await supabase
      .from('drive_times')
      .select('*')
      .eq('from_stop_id', from.id)
      .eq('to_stop_id', to.id)
      .single();

    if (cached) continue; // Already have it

    const result = await getDriveTime(
      { lat: from.lat, lng: from.lng },
      { lat: to.lat, lng: to.lng }
    );

    if (result) {
      await supabase.from('drive_times').insert({
        from_stop_id: from.id,
        to_stop_id: to.id,
        duration_minutes: result.duration_minutes,
        distance_km: result.distance_km,
      });
    }
  }
}

/**
 * Haversine fallback — straight line estimate
 * Used when no API key or request fails
 */
export function haversineDriveEstimate(from: LatLng, to: LatLng): number {
  const R = 6371;
  const dLat = (to.lat - from.lat) * Math.PI / 180;
  const dLng = (to.lng - from.lng) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(from.lat * Math.PI / 180) *
    Math.cos(to.lat * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  const distKm = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  // Assume 50 km/h average on winding Highland/Irish roads
  return Math.round((distKm / 50) * 60);
}
