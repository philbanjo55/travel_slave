import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { format, parseISO } from 'date-fns';
import { colors, spacing, typography } from '../theme';
import { DayPlanView } from '../components/planner/PlanView';
import { dayBadge } from '../components/planner/dayBadge';

// One trip day's plans, full screen (from the day page's planner banner).
export default function PlanScreen() {
  const navigation = useNavigation<any>();
  const { tripId, tripDate, dayNumber } = useRoute<any>().params;
  const badge = dayBadge(tripDate);
  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.iconBtn} accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{dayNumber != null ? `Day ${dayNumber} · ` : ''}{format(parseISO(tripDate), 'EEE d MMM')}</Text>
          <Text style={[styles.badge, { color: badge.color }]}>{badge.text}</Text>
        </View>
      </View>
      <ScrollView contentContainerStyle={styles.body}>
        <DayPlanView tripId={tripId} tripDate={tripDate} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
  },
  iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  title: { ...typography.headlineLarge },
  badge: { fontSize: 9, fontWeight: '800', letterSpacing: 0.8, marginTop: 2 },
  body: { padding: spacing.lg, paddingBottom: spacing.xxxl },
});
