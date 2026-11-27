import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { colors, typography, spacing } from '../theme';

// Shown instead of a blank screen when a page's day or stop isn't in the
// loaded trip: still loading (no trip yet), or gone (deleted, moved, or a
// practice trip rolled its days). Always has a way back.
export default function MissingScreen({ loading, what }: { loading: boolean; what: string }) {
  const navigation = useNavigation<any>();
  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
      </View>
      <View style={styles.body}>
        {loading ? (
          <ActivityIndicator color={colors.accent} />
        ) : (
          <>
            <Text style={styles.text}>{`This ${what} isn't in the trip any more.`}</Text>
            <Text style={styles.sub}>It may have been moved or deleted.</Text>
            <TouchableOpacity onPress={() => navigation.goBack()} style={styles.btn}>
              <Text style={styles.btnText}>Go back</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  backBtn: { padding: spacing.xs },
  body: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: spacing.xl },
  text: { ...typography.labelLarge, color: colors.textPrimary, textAlign: 'center' },
  sub: { ...typography.labelMedium, color: colors.textSecondary, marginTop: spacing.sm, textAlign: 'center' },
  btn: { marginTop: spacing.lg, paddingVertical: spacing.sm, paddingHorizontal: spacing.lg },
  btnText: { ...typography.labelMedium, color: colors.accent },
});
