import AsyncStorage from '@react-native-async-storage/async-storage';

// When Phil last opened a trip's Planner brief, so the trip page can show a
// dot when there is a newer one (TEST app only).
const key = (tripId: string) => `planner_brief_seen:${tripId}`;

export async function markBriefSeen(tripId: string, runAt: string) {
  try { await AsyncStorage.setItem(key(tripId), runAt); } catch { /* a dot too many is harmless */ }
}

export async function briefSeenAt(tripId: string): Promise<string | null> {
  try { return await AsyncStorage.getItem(key(tripId)); } catch { return null; }
}
