import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, ActivityIndicator, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { colors, typography, spacing, radius } from '../theme';
import { parseExposureText, importExposures, applyShotTimeZones, ParsedExposure } from '../services/exposureImport';

export default function ExposureImportScreen() {
  const navigation = useNavigation<any>();
  const [text, setText] = useState('');
  const [preview, setPreview] = useState<ParsedExposure[] | null>(null);
  const [busy, setBusy] = useState(false);

  const doPreview = async () => {
    const parsed = parseExposureText(text);
    if (parsed.length === 0) {
      Alert.alert('Nothing found', 'No exposure blocks detected. Paste the full shared text (it should start with "Meter:").');
      return;
    }
    setBusy(true);
    // Each frame's time in the zone where it was shot (from the nearest trip stop); offline,
    // frames keep the phone's zone and the preview says so.
    try { setPreview(await applyShotTimeZones(parsed)); } catch { setPreview(parsed); } finally { setBusy(false); }
  };

  const doImport = async () => {
    if (!preview) return;
    setBusy(true);
    try {
      const { inserted, updated } = await importExposures(preview, { source: 'text' });
      Alert.alert('Imported', `${inserted} new, ${updated} updated.`, [
        { text: 'OK', onPress: () => navigation.popTo('Exposures') },
      ]);
    } catch (e: any) {
      // Nothing is lost: the preview and the pasted text stay here to try again.
      Alert.alert('Not imported', `Nothing was saved. ${e?.message ? `(${e.message}) ` : ''}Check your connection and tap Import again; your pasted text is kept.`);
    } finally {
      setBusy(false);
    }
  };


  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.title}>Import Exposures</Text>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 60 }}>
        {/* The .sdocx file import isn't built yet, so only the paste importer
            is shown. */}

        {/* paste text path (live) */}
        <Text style={styles.label}>PASTE SHARED TEXT</Text>
        <Text style={styles.help}>
          In Light Meter: long-press an exposure → Share → copy the text → paste here.
          Multiple exposures in one paste also work.
        </Text>
        <TextInput
          style={styles.textArea}
          value={text}
          onChangeText={(t) => { setText(t); setPreview(null); }}
          placeholder={'Meter: Camera Meter\nTime: 03/06/2026 10:18:08 AM\nEV: 11.9\n…'}
          placeholderTextColor={colors.textTertiary}
          multiline
          textAlignVertical="top"
          selectionColor={colors.accent}
        />

        {!preview ? (
          <TouchableOpacity style={[styles.actionBtn, !text && styles.actionBtnDisabled]} onPress={doPreview} disabled={!text || busy}>
            <Text style={styles.actionBtnText}>Preview</Text>
          </TouchableOpacity>
        ) : (
          <>
            <Text style={styles.label}>PREVIEW — {preview.length} EXPOSURE{preview.length > 1 ? 'S' : ''}</Text>
            {preview.map((p, i) => (
              <View key={i} style={styles.previewCard}>
                <Text style={styles.previewWhen}>{p.local_time ? p.local_time.replace('T', ' ') : p.captured_at || 'no time?'}</Text>
                <Text style={styles.previewMeta}>{p.captured_at ? (p.tz ? `${p.tz} time (shot near a trip stop)` : "Phone's time zone (no trip stop nearby)") : ''}</Text>
                <Text style={styles.previewSettings}>
                  f/{p.aperture ?? '—'} · {p.shutter_display ?? '—'} · ISO {p.iso ?? '—'} · EV {p.ev ?? '—'}
                </Text>
                <Text style={styles.previewMeta}>
                  {p.film_stock ? p.film_stock + ' · ' : ''}{p.filter || ''}
                </Text>
              </View>
            ))}
            <TouchableOpacity style={styles.actionBtn} onPress={doImport} disabled={busy}>
              {busy ? <ActivityIndicator color={colors.textInverse} /> : <Text style={styles.actionBtnText}>Import {preview.length}</Text>}
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondaryBtn} onPress={() => setPreview(null)}>
              <Text style={styles.secondaryBtnText}>Edit text</Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, gap: spacing.sm,
  },
  backBtn: { padding: spacing.xs },
  title: { fontSize: 16, fontWeight: '600', color: colors.textPrimary, flex: 1 },
  fileBtn: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    marginHorizontal: spacing.lg, marginTop: spacing.lg, padding: spacing.lg,
    backgroundColor: colors.surface, borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
  },
  fileBtnTitle: { fontSize: 15, fontWeight: '600', color: colors.textPrimary },
  fileBtnSub: { ...typography.bodySmall, color: colors.textTertiary, marginTop: 2 },
  or: { textAlign: 'center', color: colors.textTertiary, marginVertical: spacing.md, fontSize: 12 },
  label: { ...typography.labelMedium, color: colors.textTertiary, paddingHorizontal: spacing.lg, marginTop: spacing.md, marginBottom: spacing.xs },
  help: { ...typography.bodySmall, color: colors.textTertiary, paddingHorizontal: spacing.lg, marginBottom: spacing.sm },
  textArea: {
    marginHorizontal: spacing.lg, minHeight: 160,
    backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md,
    color: colors.textPrimary, fontSize: 13, lineHeight: 19,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
  },
  actionBtn: {
    marginHorizontal: spacing.lg, marginTop: spacing.lg, paddingVertical: spacing.md,
    backgroundColor: colors.accent, borderRadius: radius.md, alignItems: 'center',
  },
  actionBtnDisabled: { opacity: 0.3 },
  actionBtnText: { color: colors.textInverse, fontSize: 16, fontWeight: '700' },
  secondaryBtn: { alignItems: 'center', marginTop: spacing.md },
  secondaryBtnText: { color: colors.textSecondary, fontSize: 14 },
  previewCard: {
    marginHorizontal: spacing.lg, marginBottom: spacing.sm, padding: spacing.md,
    backgroundColor: colors.surface, borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
  },
  previewWhen: { ...typography.labelMedium, color: colors.textTertiary },
  previewSettings: { fontSize: 15, fontWeight: '600', color: colors.textPrimary, marginTop: 2 },
  previewMeta: { fontSize: 12, color: colors.accent, marginTop: 2 },
});
