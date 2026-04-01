import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors, typography, spacing } from '../theme';

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return <ErrorScreen error={this.state.error} onRetry={() => this.setState({ hasError: false, error: null })} />;
    }
    return this.props.children;
  }
}

function ErrorScreen({ error, onRetry }: { error: Error | null; onRetry: () => void }) {
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <Ionicons name="warning-outline" size={48} color={colors.signalWarning} />
        <Text style={styles.title}>Something went wrong</Text>
        <Text style={styles.message}>{error?.message || 'An unexpected error occurred'}</Text>
        <TouchableOpacity style={styles.retryBtn} onPress={onRetry}>
          <Text style={styles.retryText}>Try Again</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

// ─────────────────────────────────────────
// NOT FOUND SCREEN
// ─────────────────────────────────────────
export function NotFoundScreen({ message }: { message?: string }) {
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <Ionicons name="map-outline" size={48} color={colors.textTertiary} />
        <Text style={styles.title}>Not Found</Text>
        <Text style={styles.message}>{message || 'This content could not be found'}</Text>
      </View>
    </SafeAreaView>
  );
}

// ─────────────────────────────────────────
// OFFLINE SCREEN
// ─────────────────────────────────────────
export function OfflineBanner() {
  return (
    <View style={styles.offlineBanner}>
      <Ionicons name="cloud-offline-outline" size={14} color={colors.signalNone} />
      <Text style={styles.offlineText}>Offline — showing cached data</Text>
    </View>
  );
}

// ─────────────────────────────────────────
// EMPTY STATE
// ─────────────────────────────────────────
export function EmptyState({ icon, message }: { icon: string; message: string }) {
  return (
    <View style={styles.empty}>
      <Ionicons name={icon as any} size={36} color={colors.textTertiary} />
      <Text style={styles.emptyText}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xxxl,
    gap: spacing.lg,
  },
  title: {
    ...typography.headlineLarge,
    textAlign: 'center',
  },
  message: {
    ...typography.bodyMedium,
    textAlign: 'center',
    lineHeight: 20,
  },
  retryBtn: {
    marginTop: spacing.lg,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderWidth: 1,
    borderColor: colors.accent,
    borderRadius: 8,
  },
  retryText: {
    ...typography.headlineMedium,
    color: colors.accent,
  },
  offlineBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: 'rgba(138,74,74,0.15)',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.signalNone,
  },
  offlineText: {
    ...typography.labelMedium,
    color: colors.signalNone,
  },
  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.xxxl,
  },
  emptyText: {
    ...typography.bodyMedium,
    textAlign: 'center',
  },
});
