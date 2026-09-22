// The error capture goes first, before anything else can throw.
import './src/earlyErrors';
import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { captureError, getCapturedErrors, subscribeCapturedErrors } from './src/earlyErrors';

// Everything else is required lazily inside a try/catch rather than imported
// at module scope. A static import that throws takes this whole module with
// it, App never registers as the root component, and the native side shows a
// blank screen with a reload arrow and no text — which is precisely the
// failure being diagnosed. Required this way, the same throw becomes a
// readable screen.
let M: any = null;
let loadError: any = null;
try {
  require('react-native-url-polyfill/auto');
  M = {
    StatusBar: require('expo-status-bar').StatusBar,
    SplashScreen: require('expo-splash-screen'),
    GestureHandlerRootView: require('react-native-gesture-handler').GestureHandlerRootView,
    SafeAreaProvider: require('react-native-safe-area-context').SafeAreaProvider,
    RootNavigator: require('./src/navigation/RootNavigator').default,
    initDatabase: require('./src/services/database').initDatabase,
    ErrorBoundary: require('./src/components/ErrorScreens').ErrorBoundary,
    useNetworkSync: require('./src/hooks/useNetworkSync').useNetworkSync,
  };
  M.SplashScreen.preventAutoHideAsync();
} catch (e) {
  loadError = e;
  captureError(e, 'module load');
}

// Plain react-native primitives only: no theme, no icon font, no navigation.
// Any of those could be the import that failed, and a diagnostic screen that
// depends on the thing it is diagnosing is no use.
function FatalScreen({ errors }: { errors: ReturnType<typeof getCapturedErrors> }) {
  return (
    <View style={{ flex: 1, backgroundColor: '#0a0a0a', paddingTop: 48 }}>
      <Text selectable style={{ color: '#ff6b6b', fontSize: 16, fontWeight: '700', padding: 16 }}>
        Startup error ({errors.length})
      </Text>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 48 }}>
        {errors.map((e, i) => (
          <View key={i} style={{ marginBottom: 24 }}>
            <Text selectable style={{ color: '#e0a82e', fontSize: 11, marginBottom: 4 }}>
              [{e.phase}]
            </Text>
            <Text selectable style={{ color: '#fff', fontSize: 13, marginBottom: 8 }}>
              {e.message}
            </Text>
            {e.stack ? (
              <Text selectable style={{ color: '#888', fontSize: 10, lineHeight: 14 }}>
                {e.stack.split('\n').slice(0, 14).join('\n')}
              </Text>
            ) : null}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

function AppInner() {
  M.useNetworkSync();
  return <M.RootNavigator />;
}

export default function App() {
  const [dbReady, setDbReady] = useState(false);
  const [, bump] = useState(0);

  // Re-render when something is captured, so an error thrown after mount
  // still reaches the screen rather than only the console.
  useEffect(() => subscribeCapturedErrors(() => bump(n => n + 1)), []);

  useEffect(() => {
    if (!M) { setDbReady(true); return; }
    async function prepare() {
      try {
        await M.initDatabase();
      } catch (e) {
        console.warn('DB init failed:', e);
        captureError(e, 'initDatabase');
      } finally {
        setDbReady(true);
        try { M.SplashScreen.hideAsync(); } catch {}
      }
    }
    prepare();
  }, []);

  const errors = getCapturedErrors();
  if (loadError || (!M && errors.length)) return <FatalScreen errors={errors} />;
  if (!M) return <FatalScreen errors={[{ message: 'Modules failed to load, with no error captured.', stack: null, phase: 'module load', at: Date.now() }]} />;
  if (!dbReady) return null;

  const { GestureHandlerRootView, SafeAreaProvider, StatusBar, ErrorBoundary } = M;
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        {errors.some((e: any) => e.phase === 'fatal') ? <FatalScreen errors={errors} /> : (
          <ErrorBoundary>
            <AppInner />
          </ErrorBoundary>
        )}
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
