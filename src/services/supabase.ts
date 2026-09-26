import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Replace these with your actual Supabase credentials
const SUPABASE_URL = 'https://ohshrzlvvxyovcjmdajc.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_T0_nU1MSX1HaW3EOVZ4y_Q_07yC-Jb2';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

// ─────────────────────────────────────────
// TRIPS
// ─────────────────────────────────────────
export async function fetchTrips() {
  const { data, error } = await supabase
    .from('trips')
    .select('*')
    .order('start_date', { ascending: true });
  if (error) throw error;
  return data;
}

export async function fetchTrip(tripId: string) {
  const { data, error } = await supabase
    .from('trips')
    .select('*')
    .eq('id', tripId)
    .single();
  if (error) throw error;
  return data;
}

// ─────────────────────────────────────────
// DAYS
// ─────────────────────────────────────────
export async function fetchDays(tripId: string) {
  const { data, error } = await supabase
    .from('days')
    .select('*')
    .eq('trip_id', tripId)
    .order('day_number', { ascending: true });
  if (error) throw error;
  return data;
}

// ─────────────────────────────────────────
// STOPS
// ─────────────────────────────────────────
export async function fetchStops(dayId: string) {
  const { data, error } = await supabase
    .from('stops')
    .select(`
      *,
      stop_photos (*)
    `)
    .eq('day_id', dayId)
    .order('position', { ascending: true });
  if (error) throw error;
  return data;
}

export async function fetchAllStopsForTrip(tripId: string) {
  const { data, error } = await supabase
    .from('stops')
    .select(`
      *,
      stop_photos (*)
    `)
    .eq('trip_id', tripId)
    .order('position', { ascending: true });
  if (error) throw error;
  return data;
}

export async function updateStop(stopId: string, updates: any) {
  const { data, error } = await supabase
    .from('stops')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', stopId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function insertStop(stop: any) {
  const { data, error } = await supabase
    .from('stops')
    .insert(stop)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteStop(stopId: string) {
  const { error } = await supabase
    .from('stops')
    .delete()
    .eq('id', stopId);
  if (error) throw error;
}

// ─────────────────────────────────────────
// PHOTOS
// ─────────────────────────────────────────
export async function uploadPhoto(
  stopId: string,
  base64Data: string,
  position: number
) {
  const { data, error } = await supabase
    .from('stop_photos')
    .insert({ stop_id: stopId, base64_data: base64Data, position })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deletePhoto(photoId: string) {
  const { error } = await supabase
    .from('stop_photos')
    .delete()
    .eq('id', photoId);
  if (error) throw error;
}

// ─────────────────────────────────────────
// FULL TRIP SYNC (for offline cache)
// ─────────────────────────────────────────
export async function fetchFullTrip(tripId: string) {
  const [trip, days] = await Promise.all([
    fetchTrip(tripId),
    fetchDays(tripId),
  ]);

  const stopsData = await fetchAllStopsForTrip(tripId);

  // Group stops by day
  const stopsByDay: Record<string, any[]> = {};
  for (const stop of stopsData) {
    if (!stopsByDay[stop.day_id]) stopsByDay[stop.day_id] = [];
    stopsByDay[stop.day_id].push(stop);
  }

  return {
    trip,
    days: days.map(day => ({
      ...day,
      stops: stopsByDay[day.id] || [],
    })),
  };
}

export async function calculateDriveTimes(tripId: string): Promise<any> {
  const res = await fetch(
    `${SUPABASE_URL}/functions/v1/calculate-drive-times`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({ trip_id: tripId }),
    }
  );
  return res.json();
}
