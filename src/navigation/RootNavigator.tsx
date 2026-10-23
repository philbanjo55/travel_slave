import React, { useEffect } from 'react';
import { NavigationContainer, DarkTheme, createNavigationContainerRef } from '@react-navigation/native';
import * as Notifications from 'expo-notifications';
import { IS_TEST_APP } from '../utils/variant';
import { refreshNightly, setupPlannerNotifications } from '../services/plannerNotify';
import { createStackNavigator } from '@react-navigation/stack';
import TripsScreen from '../screens/TripsScreen';
import TripScreen from '../screens/TripScreen';
import DayScreen from '../screens/DayScreen';
import StopDetailScreen from '../screens/StopDetailScreen';
import ReciprocityScreen from '../screens/ReciprocityScreen';
import FocusSpreadScreen from '../screens/FocusSpreadScreen';
import ExposuresScreen from '../screens/ExposuresScreen';
import ExposureDetailScreen from '../screens/ExposureDetailScreen';
import ExposureImportScreen from '../screens/ExposureImportScreen';
import DayCompareScreen from '../screens/DayCompareScreen';
import PlannerScreen from '../screens/PlannerScreen';
import PlanScreen from '../screens/PlanScreen';
import TrainingScreen from '../screens/TrainingScreen';
import { colors } from '../theme';

export type RootStackParamList = {
  Trips: undefined;
  Trip: { tripId: string };
  Day: { tripId: string; dayIndex: number };
  StopDetail: { stopId: string; dayId: string };
  Reciprocity: undefined;
  FocusSpread: undefined;
  Exposures: undefined;
  ExposureDetail: { id: string };
  ExposureImport: undefined;
  // Solver Planner, TEST app only (see utils/variant).
  Planner: { tripId: string; tab?: 'overview' | 'plans' | 'subjects' | 'map' | 'setup'; date?: string };
  Plan: { tripId: string; tripDate: string; dayNumber?: number };
  // Live training trips (trips.training_of), TEST app only.
  Training: undefined;
};

const Stack = createStackNavigator<RootStackParamList>();

const navigationTheme = {
  ...DarkTheme,
  dark: true,
  colors: {
    ...DarkTheme.colors,
    primary: colors.accent,
    background: colors.background,
    card: colors.surface,
    text: colors.textPrimary,
    border: colors.border,
    notification: colors.accent,
  },
};

const navigationRef = createNavigationContainerRef<RootStackParamList>();

// TEST app: tapping the nightly brief opens that trip's Planner (through the
// trip page, which loads the trip).
function usePlannerNotificationTaps() {
  const last = Notifications.useLastNotificationResponse();
  useEffect(() => { if (IS_TEST_APP) { setupPlannerNotifications(); refreshNightly().catch(() => {}); } }, []);
  useEffect(() => {
    const data: any = last?.notification.request.content.data;
    if (!IS_TEST_APP || data?.kind !== 'planner_brief' || !data.tripId) return;
    const go = () => {
      if (!navigationRef.isReady()) { setTimeout(go, 300); return; }
      navigationRef.navigate('Trip', { tripId: data.tripId });
      navigationRef.navigate('Planner', { tripId: data.tripId, tab: 'overview' });
    };
    go();
  }, [last?.notification.request.identifier, last?.actionIdentifier]);
}

export default function RootNavigator() {
  usePlannerNotificationTaps();
  return (
    <NavigationContainer theme={navigationTheme} ref={navigationRef}>
      <Stack.Navigator
        screenOptions={{
          headerShown: false,
          cardStyle: { backgroundColor: colors.background },
          gestureEnabled: true,
          cardStyleInterpolator: ({ current, layouts }) => ({
            cardStyle: {
              transform: [{
                translateX: current.progress.interpolate({
                  inputRange: [0, 1],
                  outputRange: [layouts.screen.width, 0],
                }),
              }],
            },
          }),
        }}
      >
        <Stack.Screen name="Trips" component={TripsScreen} />
        <Stack.Screen name="Trip" component={TripScreen} options={{ gestureEnabled: false }} />
        <Stack.Screen name="Day" component={DayScreen} />
        <Stack.Screen name="StopDetail" component={StopDetailScreen} options={{ gestureEnabled: false }} />
        <Stack.Screen name="Reciprocity" component={ReciprocityScreen} />
        <Stack.Screen name="FocusSpread" component={FocusSpreadScreen} />
        <Stack.Screen name="Exposures" component={ExposuresScreen} />
        <Stack.Screen name="ExposureDetail" component={ExposureDetailScreen} />
        <Stack.Screen name="ExposureImport" component={ExposureImportScreen} />
        <Stack.Screen name="DayCompare" component={DayCompareScreen} />
        {/* No swipe-back: it grabbed sideways swipes on the camera strip and moved the whole screen. */}
        <Stack.Screen name="Planner" component={PlannerScreen} options={{ gestureEnabled: false }} />
        <Stack.Screen name="Plan" component={PlanScreen} options={{ gestureEnabled: false }} />
        <Stack.Screen name="Training" component={TrainingScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
