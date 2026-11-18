import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';

// TEST app only: one local notification a day when T's plans from the 19:55 UTC run are in
// (forecast pulled at 19:17; the reminder fires at 20:15 UTC, shown in the phone's own time).
// That is evening in the Faroes but 1:15 PM in Jackson, so the words never say "tonight" and
// the switch says the trip's own time too (Nov 2 field review). Local, so it needs no push
// server or Firebase.
const KEY = 'planner_nightly';
const CHANNEL = 'planner';
export type Nightly = { id: string; tripId: string; hour: number; minute: number; title?: string; v?: number };
const WORDS_V = 2; // bump when the notification's words change, so a set reminder is rescheduled

export function readyTimeLocal(): { hour: number; minute: number } {
  const d = new Date();
  d.setUTCHours(20, 15, 0, 0);
  return { hour: d.getHours(), minute: d.getMinutes() };
}

// The same moment in the trip's time zone, e.g. "13:15" for Jackson.
export function readyTimeIn(tz?: string | null): string | null {
  if (!tz) return null;
  const d = new Date();
  d.setUTCHours(20, 15, 0, 0);
  try { return new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(d); } catch { return null; }
}

let handlerSet = false;
export function setupPlannerNotifications() {
  if (handlerSet) return;
  handlerSet = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
  });
}

export async function nightlyState(): Promise<Nightly | null> {
  try { const v = await AsyncStorage.getItem(KEY); return v ? JSON.parse(v) : null; } catch { return null; }
}

export async function disableNightly() {
  const cur = await nightlyState();
  if (cur) { try { await Notifications.cancelScheduledNotificationAsync(cur.id); } catch { /* already gone */ } }
  try { await AsyncStorage.removeItem(KEY); } catch { /* nothing to remove */ }
}

// Returns an error to show, or null when the reminder is set.
export async function enableNightly(tripId: string, tripTitle: string): Promise<string | null> {
  let perm = await Notifications.getPermissionsAsync();
  if (!perm.granted) perm = await Notifications.requestPermissionsAsync();
  if (!perm.granted) return 'Notifications are off for the TEST app. Turn them on in the phone settings.';
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CHANNEL, { name: 'Planner brief', importance: Notifications.AndroidImportance.DEFAULT });
  }
  await disableNightly();
  const { hour, minute } = readyTimeLocal();
  const id = await Notifications.scheduleNotificationAsync({
    content: { title: `Planner · ${tripTitle}`, body: "T's new plans are in. Tap for the brief.", data: { kind: 'planner_brief', tripId } },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour, minute, channelId: CHANNEL },
  });
  try { await AsyncStorage.setItem(KEY, JSON.stringify({ id, tripId, hour, minute, title: tripTitle, v: WORDS_V })); } catch { /* still scheduled */ }
  return null;
}

// After a time-zone change (travel, clocks going back) or a new ready time,
// the same UTC time is a different phone time: move the reminder. Also run
// at app start, so an update that moves the time takes effect at once.
export async function refreshNightly(tripTitle?: string) {
  const cur = await nightlyState();
  if (!cur) return;
  const t = readyTimeLocal();
  if (t.hour !== cur.hour || t.minute !== cur.minute || cur.v !== WORDS_V) await enableNightly(cur.tripId, tripTitle ?? cur.title ?? 'Trip');
}
