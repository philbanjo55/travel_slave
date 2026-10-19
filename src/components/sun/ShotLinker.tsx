import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing } from '../../theme';
import { TripShot, fetchTripShots, linkShots } from '../../services/sunPlan';
import VantagePhoto from './VantagePhoto';
import { shotTitle } from './sunStyle';

// "Add shots from other stops": tick shots already set up elsewhere in the
// trip and they show on this stop too. Linked, not copied, so a fix to a pin
// or photo shows everywhere. Needs a connection.

export default function ShotLinker({ tripId, stopId, onDone }: {
  tripId: string;
  stopId: string;
  onDone: (added: number) => void;
}) {
  const [shots, setShots] = useState<TripShot[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setError(null);
    try { setShots(await fetchTripShots(stopId)); } catch (e: any) { setError(e.message); }
  };
  useEffect(() => { load(); }, [stopId]);

  // Grouped under the first stop (in trip order) that has the shot.
  const groups = useMemo(() => {
    const out: { key: string; title: string; items: TripShot[] }[] = [];
    (shots ?? []).forEach(s => {
      const others = s.stops.filter(x => x.stop_id !== stopId).sort((a, b) => a.day - b.day);
      const home = others[0];
      if (!home) return;   // only on this stop
      const key = home.stop_id;
      let g = out.find(x => x.key === key);
      if (!g) { g = { key, title: `Day ${home.day} · ${home.name}`, items: [] }; out.push(g); }
      g.items.push(s);
    });
    return out;
  }, [shots, stopId]);

  const toggle = (id: string) => setPicked(p => (p.includes(id) ? p.filter(x => x !== id) : [...p, id]));

  const save = async () => {
    setSaving(true); setError(null);
    try { onDone(await linkShots(tripId, stopId, picked)); }
    catch (e: any) { setError(e.message); }
    finally { setSaving(false); }
  };

  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.tip}>
          Tick shots to show them here too. They stay the same shots, not copies: fixing a pin or photo changes it everywhere,
          and the sun is worked out for this stop's day and time.
        </Text>
        {shots === null && !error && <ActivityIndicator color={colors.textSecondary} style={{ marginVertical: 24 }} />}
        {!!error && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity onPress={load}><Text style={styles.link}>Try again</Text></TouchableOpacity>
          </View>
        )}
        {shots !== null && groups.length === 0 && <Text style={styles.muted}>No other stop in this trip has shots yet.</Text>}
        {groups.map(g => (
          <View key={g.key} style={{ gap: 6 }}>
            <Text style={styles.section} numberOfLines={1}>{g.title.toUpperCase()}</Text>
            {g.items.map(s => {
              const here = s.on_this_stop;
              const on = here || picked.includes(s.vantage_id);
              return (
                <TouchableOpacity
                  key={s.vantage_id}
                  style={[styles.row, on && styles.rowOn]}
                  onPress={() => !here && toggle(s.vantage_id)}
                  disabled={here}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on, disabled: here }}
                  accessibilityLabel={shotTitle(s)}
                >
                  {s.photo_id
                    ? <VantagePhoto id={s.photo_id} url={s.photo_url} style={styles.thumb} />
                    : <View style={[styles.thumb, styles.thumbEmpty]}><Ionicons name="camera-outline" size={16} color="#4a4a4a" /></View>}
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowTitle} numberOfLines={1}>{shotTitle(s)}</Text>
                    {here && <Text style={styles.rowSub}>Already on this stop</Text>}
                  </View>
                  <Ionicons name={on ? 'checkbox' : 'square-outline'} size={22} color={here ? '#555' : on ? '#ffffff' : '#777'} />
                </TouchableOpacity>
              );
            })}
          </View>
        ))}
      </ScrollView>
      <View style={styles.footer}>
        <TouchableOpacity style={[styles.primary, (!picked.length || saving) && { opacity: 0.4 }]} onPress={save} disabled={!picked.length || saving}>
          {saving ? <ActivityIndicator size="small" color="#000" /> : <Ionicons name="link" size={18} color="#000" />}
          <Text style={styles.primaryText}>
            {saving ? 'Adding…' : picked.length ? `Add ${picked.length} shot${picked.length === 1 ? '' : 's'} to this stop` : 'Tick shots to add'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { padding: spacing.xl, gap: 14, paddingBottom: 40 },
  tip: { color: colors.textSecondary, fontSize: 12, lineHeight: 18 },
  muted: { color: colors.textSecondary, fontSize: 14 },
  section: { color: colors.textTertiary, fontSize: 11, fontWeight: '700', letterSpacing: 1.2 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 56, paddingHorizontal: 8, paddingVertical: 6,
    borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
  },
  rowOn: { borderColor: '#777777' },
  thumb: { width: 42, height: 42, borderRadius: 6 },
  thumbEmpty: { backgroundColor: '#1a1a1a', alignItems: 'center', justifyContent: 'center' },
  rowTitle: { color: colors.textPrimary, fontSize: 14, fontWeight: '600' },
  rowSub: { color: colors.textTertiary, fontSize: 11, marginTop: 2 },
  footer: { padding: spacing.xl, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  primary: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#ffffff',
    borderRadius: 10, minHeight: 46,
  },
  primaryText: { color: '#000000', fontSize: 15, fontWeight: '700' },
  errorBox: { borderWidth: 1, borderColor: '#6b3a33', backgroundColor: '#2a1714', borderRadius: 8, padding: 12, gap: 6 },
  errorText: { color: '#f0a79c', fontSize: 13 },
  link: { color: colors.textPrimary, fontSize: 13, fontWeight: '600', textDecorationLine: 'underline' },
});
