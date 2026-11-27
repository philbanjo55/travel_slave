// Which app code is running, and a way to fetch a new instant update now.
//
// The TEST app shows this on the trip list, and every launch writes one line
// to app_logs ('App launch'), so we can tell from the database whether a phone
// took an instant update or is still on an older one (12 Nov 2026: Phil's
// phone stopped showing new updates while Expo listed them as published).
import * as Updates from 'expo-updates';
import { supabase } from './supabase';
import { IS_TEST_APP } from '../utils/variant';

export function runningCode() {
  let created: string | null = null;
  try { created = Updates.createdAt ? new Date(Updates.createdAt).toISOString() : null; } catch {}
  return {
    updateId: Updates.updateId ?? null,
    created,
    embedded: Updates.isEmbeddedLaunch,
    emergency: Updates.isEmergencyLaunch,
    emergencyReason: Updates.emergencyLaunchReason ?? null,
    channel: Updates.channel ?? null,
    runtime: Updates.runtimeVersion ?? null,
    test: IS_TEST_APP,
  };
}

let logged = false;
export function logLaunch(): void {
  if (logged) return;
  logged = true;
  try {
    supabase.from('app_logs').insert({
      level: 'info', message: 'App launch', data: runningCode(),
    }).then(() => {}, () => {});
  } catch {}
}

export type CheckResult =
  | { kind: 'none' }
  | { kind: 'ready' }
  | { kind: 'error'; message: string };

// Ask Expo for a newer update and download it. 'ready' = call restartNow().
export async function checkAndFetch(): Promise<CheckResult> {
  try {
    const check = await Updates.checkForUpdateAsync();
    if (!check.isAvailable) return { kind: 'none' };
    const got = await Updates.fetchUpdateAsync();
    if (!got.isNew) return { kind: 'none' };
    try {
      supabase.from('app_logs').insert({
        level: 'info', message: 'Update fetched', data: { from: runningCode() },
      }).then(() => {}, () => {});
    } catch {}
    return { kind: 'ready' };
  } catch (e: any) {
    const message = String(e?.message ?? e);
    try {
      supabase.from('app_logs').insert({
        level: 'warn', message: 'Update check failed', data: { error: message.slice(0, 500), running: runningCode() },
      }).then(() => {}, () => {});
    } catch {}
    return { kind: 'error', message };
  }
}

export async function restartNow(): Promise<void> {
  await Updates.reloadAsync();
}
