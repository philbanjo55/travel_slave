import React, { useState } from 'react';
import { View, StyleSheet, Modal } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Pair, SkyPos } from '../../utils/sunEngine';
import Sun3DPanel from './Sun3DPanel';
import { useTrailRoutes } from '../../services/trailRoutes';

// Overhead, our own 3D look (Phil, 16 Nov 2026): every shot of the place seen from straight above on our terrain (winter
// ground colour, buildings, trees, the real calculated shadows at the slider's time), with no signal needed. Same props
// as OverheadMapPanel (the satellite look) plus what the 3D page needs (day0, tripId); the small view takes no gestures
// but taps (the page scrolls over it); full screen pinches, drags and turns, with `fullBar` (the time and slider) under
// the picture, so the sun moves there too: the page re-lights live, no restart.

type Props = {
  pairs: Pair[];
  sel: Pair;
  onPick: (p: Pair) => void;
  sun: SkyPos;
  shaded?: boolean;   // a ridge shades the picked shot's subject at this time (grey arrows)
  height: number;
  fullBar?: React.ReactNode;
  day0: number;       // start of the stop's local day, ms (the 3D page's sun path)
  tripId?: string | null;
  onJump?: (minute: number) => void;
};

let lastSunOn = true;

export default function Overhead3DPanel({ pairs, sel, onPick, sun, shaded, height, fullBar, day0, tripId, onJump }: Props) {
  const [full, setFull] = useState(false);
  const [sunOn, setSunOnState] = useState(lastSunOn);
  const setSunOn = (v: boolean) => { lastSunOn = v; setSunOnState(v); };
  const insets = useSafeAreaInsets();
  const routes = useTrailRoutes(pairs.map(p => p.v));
  const overhead = { pairs, selId: sel.vantage_id, onPick, sunOn, onSun: setSunOn, shaded, routes };
  const jump = onJump ?? (() => {});
  return (
    <>
      {!full ? (   // one web view at a time: the small one is let go while full screen is open
        <Sun3DPanel pair={sel} tripId={tripId} sun={sun} day0={day0} height={height} onJump={jump} onFull={() => setFull(true)} overhead={overhead} />
      ) : <View style={[styles.placeholder, { height }]} />}
      <Modal visible={full} animationType="fade" onRequestClose={() => setFull(false)}>
        <View style={[styles.fullScreen, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
          {full ? <Sun3DPanel full pair={sel} tripId={tripId} sun={sun} day0={day0} onJump={jump} onFull={() => setFull(false)} overhead={overhead} /> : null}
          {full && fullBar ? <View style={styles.fullBar}>{fullBar}</View> : null}
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  fullScreen: { flex: 1, backgroundColor: '#000000' },
  fullBar: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 14, gap: 8, backgroundColor: '#000000' },
  placeholder: { borderRadius: 10, backgroundColor: '#111111' },
});
