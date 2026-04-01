import React from 'react';
import {
  View, Text, TouchableOpacity, ActivityIndicator,
  StyleSheet, ViewStyle, TextStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, typography, spacing, radius } from '../theme';

// ─────────────────────────────────────────
// SYNC INDICATOR
// ─────────────────────────────────────────
export function SyncIndicator({ syncing, offline }: { syncing: boolean; offline: boolean }) {
  if (syncing) {
    return (
      <View style={syncStyles.container}>
        <ActivityIndicator size="small" color={colors.accent} />
        <Text style={syncStyles.text}>SYNCING</Text>
      </View>
    );
  }
  if (offline) {
    return (
      <View style={[syncStyles.container, { borderColor: colors.signalNone }]}>
        <Ionicons name="cloud-offline-outline" size={12} color={colors.signalNone} />
        <Text style={[syncStyles.text, { color: colors.signalNone }]}>OFFLINE</Text>
      </View>
    );
  }
  return null;
}

const syncStyles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderColor: colors.accent,
    borderRadius: radius.sm,
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  text: {
    ...typography.labelMedium,
    fontSize: 9,
    color: colors.accent,
  },
});

// ─────────────────────────────────────────
// SIGNAL BADGE
// ─────────────────────────────────────────
const SIGNAL_CONFIG = {
  ok:      { color: colors.signalOk,      icon: 'wifi' as const,         label: 'SIGNAL OK'   },
  warning: { color: colors.signalWarning, icon: 'wifi' as const,         label: 'WEAK SIGNAL' },
  none:    { color: colors.signalNone,    icon: 'wifi-outline' as const,  label: 'NO SIGNAL'   },
};

export function SignalBadge({ status }: { status: string }) {
  const cfg = SIGNAL_CONFIG[status as keyof typeof SIGNAL_CONFIG];
  if (!cfg) return null;
  return (
    <View style={[sigStyles.badge, { borderColor: cfg.color }]}>
      <Ionicons name={cfg.icon} size={10} color={cfg.color} />
      <Text style={[sigStyles.text, { color: cfg.color }]}>{cfg.label}</Text>
    </View>
  );
}

const sigStyles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: 6,
    paddingVertical: 3,
    alignSelf: 'flex-start',
  },
  text: { ...typography.labelMedium, fontSize: 9 },
});

// ─────────────────────────────────────────
// SECTION HEADER
// ─────────────────────────────────────────
export function SectionHeader({ label, style }: { label: string; style?: TextStyle }) {
  return (
    <Text style={[shStyles.label, style]}>{label}</Text>
  );
}

const shStyles = StyleSheet.create({
  label: { ...typography.labelLarge, marginBottom: spacing.sm },
});

// ─────────────────────────────────────────
// ICON BUTTON
// ─────────────────────────────────────────
export function IconButton({
  icon, onPress, color, size = 22, style,
}: {
  icon: string;
  onPress: () => void;
  color?: string;
  size?: number;
  style?: ViewStyle;
}) {
  return (
    <TouchableOpacity style={[ibStyles.btn, style]} onPress={onPress}>
      <Ionicons name={icon as any} size={size} color={color || colors.textPrimary} />
    </TouchableOpacity>
  );
}

const ibStyles = StyleSheet.create({
  btn: { padding: spacing.sm },
});

// ─────────────────────────────────────────
// DURATION TAG
// ─────────────────────────────────────────
export function DurationTag({ minutes }: { minutes: number }) {
  const label = minutes < 60
    ? `${minutes}m`
    : `${Math.floor(minutes / 60)}h${minutes % 60 > 0 ? ` ${minutes % 60}m` : ''}`;

  return (
    <View style={dtStyles.tag}>
      <Ionicons name="time-outline" size={9} color={colors.textTertiary} />
      <Text style={dtStyles.text}>{label}</Text>
    </View>
  );
}

const dtStyles = StyleSheet.create({
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  text: { ...typography.labelMedium, fontSize: 9 },
});

// ─────────────────────────────────────────
// DRIVE TIME CONNECTOR
// ─────────────────────────────────────────
export function DriveConnector({
  minutes,
  color,
}: {
  minutes?: number;
  color?: string;
}) {
  return (
    <View style={dcStyles.row}>
      <View style={dcStyles.lineWrap}>
        <View style={[dcStyles.line, { backgroundColor: color || colors.accent }]} />
      </View>
      {minutes ? (
        <View style={dcStyles.badge}>
          <Ionicons name="car-outline" size={10} color={colors.textTertiary} />
          <Text style={dcStyles.text}>
            {minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const dcStyles = StyleSheet.create({
  row: {
    height: 36,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: spacing.xl,
  },
  lineWrap: { width: 2, height: '100%', alignItems: 'center', marginRight: spacing.md },
  line: { width: 1, flex: 1, opacity: 0.35 },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.surfaceElevated,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.sm,
  },
  text: { ...typography.bodySmall, fontSize: 10 },
});
