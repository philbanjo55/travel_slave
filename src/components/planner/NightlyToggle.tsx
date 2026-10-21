import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Switch } from 'react-native';
import { colors, spacing, radius } from '../../theme';
import { Nightly, disableNightly, enableNightly, nightlyState, readyTimeLocal, refreshNightly } from '../../services/plannerNotify';

const two = (n: number) => String(n).padStart(2, '0');

// "Tell me when tonight's plans are in" for this trip (one trip at a time).
export default function NightlyToggle({ tripId, tripTitle }: { tripId: string; tripTitle: string }) {
  const [state, setState] = useState<Nightly | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { refreshNightly(tripTitle).finally(() => nightlyState().then(setState)); }, [tripId]);

  const on = state?.tripId === tripId;
  const t = readyTimeLocal();
  const toggle = async (v: boolean) => {
    setBusy(true); setError(null);
    try { setError(v ? await enableNightly(tripId, tripTitle) : (await disableNightly(), null)); }
    catch (e: any) { setError(String(e?.message ?? e)); }
    setState(await nightlyState());
    setBusy(false);
  };
  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Nightly brief</Text>
          <Text style={styles.hint}>
            A notification at {two(t.hour)}:{two(t.minute)} your time, when the night's plans are in.
            {state && !on ? ' (Now set for another trip; turning it on moves it here.)' : ''}
          </Text>
        </View>
        <Switch value={on} onValueChange={toggle} disabled={busy}
          trackColor={{ true: colors.signalOk, false: colors.border }} thumbColor={colors.textPrimary} />
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginTop: spacing.xl, backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, gap: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  title: { fontSize: 14, fontWeight: '600', color: colors.textPrimary },
  hint: { fontSize: 12, color: colors.textTertiary, marginTop: 2 },
  error: { fontSize: 12, color: '#e74c3c' },
});
