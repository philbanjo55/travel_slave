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

// What deleting a day would take with it. Deleting a day deletes its stops,
// and deleting a stop deletes its photos, sun/moon pin links and weather
// (all ON DELETE CASCADE). Exposures survive, unlinked (SET NULL). Counted
// from the server, not the cached screen, so a stale offline copy can't
// hide a photo.
export type DayDeleteCheck = { stops: number; photos: number; sunPairs: number; exposures: number };

export async function checkDayForDelete(dayId: string): Promise<DayDeleteCheck> {
  const { data: stops, error } = await supabase.from('stops').select('id').eq('day_id', dayId);
  if (error) throw error;
  const ids = (stops ?? []).map((s: any) => s.id);
  if (!ids.length) return { stops: 0, photos: 0, sunPairs: 0, exposures: 0 };
  const count = async (table: string) => {
    const { count: n, error: e } = await supabase
      .from(table).select('*', { count: 'exact', head: true }).in('stop_id', ids);
    if (e) throw e;
    return n ?? 0;
  };
  const [photos, sunPairs, exposures] = await Promise.all([
    count('stop_photos'), count('stop_sun_pairs'), count('exposures'),
  ]);
  return { stops: ids.length, photos, sunPairs, exposures };
}

// Delete a day, then close the gap in day numbers. Refuses outright if any
// of its stops still has photos: a cascade would destroy them with no way
// back (it has happened once already). Move those stops to another day first.
export async function deleteDay(dayId: string, tripId: string) {
  const chk = await checkDayForDelete(dayId);
  if (chk.photos > 0) {
    throw new Error(`This day's stops still have ${chk.photos} photo${chk.photos === 1 ? '' : 's'}. Move those stops to another day first.`);
  }
  const { error } = await supabase.from('days').delete().eq('id', dayId);
  if (error) throw error;

  // day_number is unique per trip. Walking the remaining days in order and
  // giving each the next number never collides: every day's number is at
  // least its new one, and any lower number is already taken by an earlier
  // day that has just been renumbered.
  const { data: rest, error: e2 } = await supabase
    .from('days').select('id,day_number').eq('trip_id', tripId).order('day_number', { ascending: true });
  if (e2) throw e2;
  let n = 1;
  for (const d of rest ?? []) {
    if (d.day_number !== n) {
      const { error: e3 } = await supabase
        .from('days').update({ day_number: n, updated_at: new Date().toISOString() }).eq('id', d.id);
      if (e3) throw e3;
    }
    n++;
  }
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
