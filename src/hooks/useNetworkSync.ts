import { useEffect, useRef } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { useTripStore } from '../store/tripStore';
import { fetchWithTimeout } from '../services/weather';

/**
 * Monitors network connectivity and app foreground state.
 * Triggers sync when app comes back to foreground with a connection.
 */
export function useNetworkSync() {
  const { refreshCurrentTrip, setOffline } = useTripStore();
  const appState = useRef(AppState.currentState);

  useEffect(() => {
    // Check connectivity by attempting a small Supabase ping
    const checkAndSync = async () => {
      try {
        const response = await fetchWithTimeout('https://www.google.com', {
          method: 'HEAD',
          cache: 'no-cache',
        }, 6000);
        const isOnline = response.ok;
        setOffline(!isOnline);
        if (isOnline) {
          await refreshCurrentTrip();
        }
      } catch {
        setOffline(true);
      }
    };

    // Sync when app comes to foreground
    const subscription = AppState.addEventListener(
      'change',
      (nextState: AppStateStatus) => {
        if (
          appState.current.match(/inactive|background/) &&
          nextState === 'active'
        ) {
          checkAndSync();
        }
        appState.current = nextState;
      }
    );

    return () => subscription.remove();
  }, []);
}
