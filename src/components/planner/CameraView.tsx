import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image, Modal, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { format } from 'date-fns';
import { CameraFrame, PhilLabel, labelFrame, frameSummary, ago, solverAction } from '../../services/planner';
import { colors, spacing, radius, typography } from '../../theme';

const LABELS: { key: PhilLabel; text: string }[] = [
  { key: 'clear', text: 'Hills clear' },
  { key: 'cloud_on_hills', text: 'Cloud on hills' },
  { key: 'fog', text: 'Fog' },
  { key: 'cant_tell', text: "Can't tell" },
];

// Tap-to-label buttons for one frame. Phil's label is the scoreboard's ground
// truth and is kept apart from Claude's.
export function LabelButtons({ frameId, value, onChange }: {
  frameId: string; value: string | null; onChange?: (v: PhilLabel | null) => void;
}) {
  const [current, setCurrent] = useState<string | null>(value);
  const [busy, setBusy] = useState(false);
  const pick = async (v: PhilLabel) => {
    const next = current === v ? null : v;
    setBusy(true);
    try { await labelFrame(frameId, next); setCurrent(next); onChange?.(next); } catch { /* keep the old value */ }
    setBusy(false);
  };
  return (
    <View style={styles.labelRow}>
      {LABELS.map(l => {
        const on = current === l.key;
        return (
          <TouchableOpacity key={l.key} onPress={() => pick(l.key)} disabled={busy}
            style={[styles.labelBtn, on && styles.labelBtnOn]} accessibilityState={{ selected: on }}>
            <Text style={[styles.labelText, on && styles.labelTextOn]}>{l.text}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const LIVE_REFRESH_MS = 30_000;

// Live view: the camera's picture now, reloaded every 30 s while open. The new
// picture is downloaded first and swapped in, so it doesn't blink. Templated
// archives (TetonCam) ask the server for their newest file each time.
function useLive(camera: CameraFrame['camera'] | undefined, on: boolean) {
  const [state, setState] = useState<{ uri: string; at: Date; picture: string | null; failed: boolean } | null>(null);
  useEffect(() => {
    if (!on || !camera) { setState(null); return; }
    let alive = true;
    const load = async () => {
      let url = camera.live_url ?? camera.image_url;
      let picture = camera.live_time ?? null;
      if (camera.image_url.includes('{')) {
        try {
          const r = await solverAction<{ cameras: CameraFrame[] }>({ action: 'frames', camera: camera.code });
          const c = r.cameras[0]?.camera;
          if (c?.live_url) { url = c.live_url; picture = c.live_time ?? null; }
        } catch { /* keep the last address */ }
      }
      const uri = `${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}`;
      let ok = true;
      try { ok = await Image.prefetch(uri); } catch { ok = false; }
      if (!alive) return;
      setState(prev => ok || !prev ? { uri, at: new Date(), picture, failed: !ok } : { ...prev, failed: true });
    };
    load();
    const id = setInterval(load, LIVE_REFRESH_MS);
    return () => { alive = false; clearInterval(id); };
  }, [on, camera?.code]);
  return state;
}

// Full-size frame with Live (straight from the camera now) and labels.
export function FrameModal({ item, onClose }: { item: CameraFrame | null; onClose: () => void }) {
  const [live, setLive] = useState(false);
  const liveView = useLive(item?.camera, live);
  if (!item) return null;
  const { camera, frame } = item;
  const uri = live ? liveView?.uri : frame?.url ?? undefined;
  const liveMeta = !liveView ? 'loading live' : liveView.failed ? `camera not answering · last ${format(liveView.at, 'h:mm:ss a')}`
    : `live · updated ${format(liveView.at, 'h:mm:ss a')}`;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalBg}>
        <View style={styles.modalCard}>
          <View style={styles.modalHead}>
            <View style={{ flex: 1 }}>
              <Text style={styles.camName}>{camera.name}</Text>
              <Text style={styles.camMeta}>
                {camera.island}{camera.distance_km != null ? ` · ${camera.distance_km} km away` : ''}
                {' · '}{live ? liveMeta : frame ? ago(frame.taken_at ?? frame.captured_at) : 'no frame'}
              </Text>
            </View>
            <TouchableOpacity onPress={onClose} accessibilityLabel="Close" style={styles.closeBtn}>
              <Ionicons name="close" size={22} color={colors.textPrimary} />
            </TouchableOpacity>
          </View>
          {uri ? <Image source={{ uri }} style={styles.bigImage} resizeMode="contain" /> : <View style={styles.bigImage} />}
          <View style={styles.modalRow}>
            <Text style={styles.summary}>{live ? (liveView?.picture ? `Picture from ${liveView.picture} camera time · every 30 s` : 'Live view, refreshes every 30 s')
              : frameSummary(frame)}</Text>
            <TouchableOpacity onPress={() => setLive(v => !v)} style={styles.liveBtn}>
              <Ionicons name={live ? 'time-outline' : 'radio-outline'} size={14} color={colors.accent} />
              <Text style={styles.liveText}>{live ? 'Saved frame' : 'Live'}</Text>
            </TouchableOpacity>
          </View>
          {!live && frame?.label_note ? <Text style={styles.note}>{frame.label_note}</Text> : null}
          {!live && frame ? (
            <>
              <Text style={styles.ask}>What do you see?</Text>
              <LabelButtons frameId={frame.id} value={frame.phil_label} onChange={v => { frame.phil_label = v; }} />
            </>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

// Small thumbnail tile: image, camera, time, label.
export function FrameTile({ item, onPress, wide }: { item: CameraFrame; onPress: () => void; wide?: boolean }) {
  const { camera, frame } = item;
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.85} style={[styles.tile, wide && styles.tileWide]}>
      {frame?.url ? <Image source={{ uri: frame.url }} style={[styles.tileImage, wide && styles.tileImageWide]} />
        : <View style={[styles.tileImage, wide && styles.tileImageWide, styles.empty]}><ActivityIndicator color={colors.textTertiary} /></View>}
      <Text style={styles.tileName} numberOfLines={1}>{camera.name}</Text>
      <Text style={styles.tileMeta} numberOfLines={1}>
        {camera.distance_km != null ? `${camera.distance_km} km · ` : ''}{frame ? ago(frame.taken_at ?? frame.captured_at) : '—'}
      </Text>
      <Text style={styles.tileLabel} numberOfLines={1}>
        {frameSummary(frame)}{frame?.phil_label ? ' · you ✓' : ''}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  labelRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  labelBtn: {
    minHeight: 36, paddingHorizontal: 12, justifyContent: 'center',
    borderRadius: radius.full, borderWidth: 1, borderColor: colors.border,
  },
  labelBtnOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  labelText: { fontSize: 12, color: colors.textPrimary },
  labelTextOn: { color: colors.textInverse, fontWeight: '700' },

  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', justifyContent: 'center', padding: spacing.lg },
  modalCard: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.md },
  modalHead: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  closeBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginTop: -10, marginRight: -10 },
  camName: { ...typography.headlineMedium },
  camMeta: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  bigImage: { width: '100%', aspectRatio: 16 / 9, backgroundColor: '#000', borderRadius: radius.sm },
  modalRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  summary: { flex: 1, fontSize: 13, color: colors.textPrimary, fontWeight: '600' },
  liveBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 32, paddingHorizontal: 10,
    borderRadius: radius.full, borderWidth: 1, borderColor: colors.border,
  },
  liveText: { fontSize: 12, color: colors.accent, fontWeight: '600' },
  note: { fontSize: 12, color: colors.textSecondary, lineHeight: 17 },
  ask: { ...typography.labelMedium, color: colors.textSecondary },

  tile: { width: 150, gap: 3 },
  tileWide: { flex: 1, width: undefined },
  tileImage: { width: 150, height: 84, borderRadius: radius.sm, backgroundColor: colors.surfaceElevated },
  tileImageWide: { width: '100%', height: undefined, aspectRatio: 16 / 9 },
  empty: { alignItems: 'center', justifyContent: 'center' },
  tileName: { fontSize: 12, fontWeight: '600', color: colors.textPrimary },
  tileMeta: { fontSize: 11, color: colors.textTertiary },
  tileLabel: { fontSize: 11, color: colors.textSecondary },
});
