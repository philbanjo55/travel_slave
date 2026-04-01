import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import TripsScreen from '../screens/TripsScreen';
import TripScreen from '../screens/TripScreen';
import DayScreen from '../screens/DayScreen';
import StopDetailScreen from '../screens/StopDetailScreen';
import { colors } from '../theme';

export type RootStackParamList = {
  Trips: undefined;
  Trip: { tripId: string };
  Day: { tripId: string; dayIndex: number };
  StopDetail: { stopId: string; dayId: string };
};

const Stack = createStackNavigator<RootStackParamList>();

const navigationTheme = {
  dark: true,
  colors: {
    primary: colors.accent,
    background: colors.background,
    card: colors.surface,
    text: colors.textPrimary,
    border: colors.border,
    notification: colors.accent,
  },
};

export default function RootNavigator() {
  return (
    <NavigationContainer theme={navigationTheme}>
      <Stack.Navigator
        screenOptions={{
          headerShown: false,
          cardStyle: { backgroundColor: colors.background },
          gestureEnabled: true,
          gestureResponseDistance: 25,
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
        <Stack.Screen name="Trip" component={TripScreen} />
        <Stack.Screen name="Day" component={DayScreen} />
        <Stack.Screen name="StopDetail" component={StopDetailScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
