import 'react-native-url-polyfill/auto';
import React, { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import RootNavigator from './src/navigation/RootNavigator';
import { initDatabase } from './src/services/database';
import { ErrorBoundary } from './src/components/ErrorScreens';
import { useNetworkSync } from './src/hooks/useNetworkSync';

SplashScreen.preventAutoHideAsync();

function AppInner() {
  useNetworkSync();
  return <RootNavigator />;
}

export default function App() {
  const [dbReady, setDbReady] = useState(false);

  useEffect(() => {
    async function prepare() {
      try {
        await initDatabase();
      } catch (e) {
        console.warn('DB init failed:', e);
      } finally {
        setDbReady(true);
        SplashScreen.hideAsync();
      }
    }
    prepare();
  }, []);

  if (!dbReady) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        <ErrorBoundary>
          <AppInner />
        </ErrorBoundary>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
