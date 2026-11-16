import React from 'react';
import { Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { markSpotSeen, useStopSpotsNew } from '../services/photoSpot';

// Find spot: a finished search of one of this stop's photos that has not been looked at yet.
export default function SpotFoundChip({ stopId, stopName }: { stopId: string; stopName?: string }) {
  const navigation = useNavigation<any>();
  const fresh = useStopSpotsNew(stopId);
  if (!fresh.length) return null;
  const e = fresh[0];
  const ok = !!e.job?.result?.ok;
  return (
    <TouchableOpacity
      style={styles.chip}
      onPress={() => { markSpotSeen(e.jobId); if (ok) navigation.navigate('PhotoSpot', { jobId: e.jobId, stopName: stopName ?? null }); }}
      accessibilityRole="button"
      accessibilityLabel={ok ? 'Spot found. See it' : "Couldn't place the photo"}
    >
      <Ionicons name="locate-outline" size={14} color={ok ? '#000' : '#fff'} />
      <Text style={[styles.text, !ok && { color: '#fff' }]}>{ok ? 'Spot found' : "Couldn't place the photo"}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  chip: {
    alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, height: 30, paddingHorizontal: 12,
    borderRadius: 15, backgroundColor: '#ffffff', marginBottom: 12,
  },
  text: { color: '#000', fontSize: 13, fontWeight: '600' },
});
