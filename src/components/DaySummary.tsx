import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing } from '../theme';
import { minutesToHoursMin } from '../utils/helpers';

interface Props {
  stops: any[];
}

export default function DaySummary({ stops }: Props) {
  if (!stops?.length) return null;

  const drive = stops.reduce(
    (s: number, x: any) => s + (x.drive_override_minutes || 0),
    0
  );
  const onSite = stops.reduce(
    (s: number, x: any) => s + (x.duration_minutes || 0),
    0
  );
  const total = drive + onSite;

  // Skip days with no real data (transit-only, no durations recorded)
  if (total === 0) return null;

  return (
    <View style={styles.row}>
      <Stat icon="car-outline" label="DRIVE" value={minutesToHoursMin(drive)} />
      <View style={styles.divider} />
      <Stat icon="camera-outline" label="ON SITE" value={minutesToHoursMin(onSite)} />
      <View style={styles.divider} />
      <Stat icon="time-outline" label="TOTAL" value={minutesToHoursMin(total)} />
    </View>
  );
}

function Stat({
  icon,
  label,
  value,
}: {
  icon: any;
  label: string;
  value: string;
}) {
  return (
    <View style={styles.stat}>
      <Ionicons name={icon} size={12} color={colors.textTertiary} />
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  stat: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  divider: {
    width: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
  },
  label: {
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1,
    color: colors.textTertiary,
  },
  value: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textPrimary,
    marginLeft: 2,
  },
});
