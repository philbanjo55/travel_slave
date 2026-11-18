import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../../services/supabase';
import { colors } from '../../theme';
import { clock12 } from '../../services/planner';
import { useNotesOn } from '../../services/tNotes';

// Claude's plan check (worksheet g3, edge function t-review): each evening (real trips: every plan)
// Claude reads T's plan against the park's closures and hours, weather warnings and avalanche danger.
// It never changes the plan; the day card shows its verdict and, on a tap, what to watch for and what
// was checked (Phil, 10 Nov 2026: shown in the TEST app so it is seen on the trip).
export type PlanFlag = { stop?: string; issue: string; action?: string; source?: string; severity?: 'info' | 'warn' | 'problem' };
export type PlanCheckItem = { what: string; result: string; source?: string };
export type PlanReview = {
  id: number; plan_date: string; note: string | null; verdict: 'ok' | 'check' | 'problem' | null;
  summary: string | null; flags: PlanFlag[] | null; checks: PlanCheckItem[] | null; done_at: string | null;
};

const KEY = (tripId: string, date: string) => `plancheck:${tripId}:${date}`;

// Newest finished check of this trip day; saved on the phone so it still shows with no signal.
export async function fetchPlanReview(tripId: string, date: string): Promise<PlanReview | null> {
  try {
    const { data, error } = await supabase.from('t_reviews')
      .select('id, plan_date, note, verdict, summary, flags, checks, done_at')
      .eq('trip_id', tripId).eq('plan_date', date).eq('status', 'done')
      .order('done_at', { ascending: false }).limit(1);
    if (error) throw error;
    const r = (data?.[0] as PlanReview | undefined) ?? null;
    AsyncStorage.setItem(KEY(tripId, date), JSON.stringify(r)).catch(() => {});
    return r;
  } catch {
    try { const v = await AsyncStorage.getItem(KEY(tripId, date)); return v ? JSON.parse(v) : null; } catch { return null; }
  }
}

export function usePlanReview(tripId: string, date: string): PlanReview | null {
  const [r, setR] = useState<PlanReview | null>(null);
  useEffect(() => {
    let live = true;
    const load = () => fetchPlanReview(tripId, date).then(x => { if (live) setR(x); });
    load();
    const sub = AppState.addEventListener('change', s => { if (s === 'active') load(); });
    return () => { live = false; sub.remove(); };
  }, [tripId, date]);
  return r;
}

const MARK = { ok: '✓', check: '!', problem: '✕' } as const;
const TINT = { ok: colors.signalOk, check: '#e0a84b', problem: '#e74c3c' } as const;

export function headline(r: PlanReview): string {
  const flags = (r.flags ?? []).filter(f => f.severity !== 'info');
  if (r.verdict === 'ok' || !flags.length) return 'Nothing found to change';
  const first = flags[0];
  const where = first.stop ? `${first.stop.replace(/\s*\(.*\)\s*$/, '')}: ` : '';
  const rest = flags.length > 1 ? ` (+${flags.length - 1} more)` : '';
  return `${where}${first.issue.split(/(?<=\.)\s/)[0]}${rest}`;
}

export function PlanCheckRow({ tripId, date, tz, onTellT }: { tripId: string; date: string; tz?: string; onTellT?: (text: string) => void }) {
  const r = usePlanReview(tripId, date);
  // Tell T (worksheet g4): a flag can be handed to T as a note (Phil still sees what T understood and gives the OK).
  const notes = useNotesOn(onTellT ? tripId : null);
  const [open, setOpen] = useState(false);
  const [showChecks, setShowChecks] = useState(false);
  if (!r || !r.verdict) return null;
  const tint = TINT[r.verdict] ?? colors.textSecondary;
  const when = r.done_at ? clock12(r.done_at, tz) : '';
  return (
    <View style={styles.wrap}>
      <TouchableOpacity onPress={() => setOpen(o => !o)} activeOpacity={0.8} accessibilityRole="button"
        accessibilityLabel={`Claude's plan check: ${headline(r)}. ${open ? 'Hide' : 'Show'} details`}>
        <View style={styles.row}>
          <Text style={[styles.mark, { color: tint, borderColor: tint }]}>{MARK[r.verdict]}</Text>
          <Text style={styles.text} numberOfLines={open ? undefined : 2}>
            <Text style={styles.lead}>Plan check{when ? ` · ${when}` : ''}: </Text>{headline(r)}
            <Text style={styles.go}> {open ? '‹' : '›'}</Text>
          </Text>
        </View>
      </TouchableOpacity>
      {open ? (
        <View style={styles.body}>
          {r.summary ? <Text style={styles.summary}>{r.summary}</Text> : null}
          {(r.flags ?? []).map((f, i) => (
            <View key={i} style={[styles.flag, { borderLeftColor: f.severity === 'info' ? colors.border : f.severity === 'problem' ? TINT.problem : TINT.check }]}>
              {f.stop ? <Text style={styles.flagStop}>{f.stop}</Text> : null}
              <Text style={styles.flagText}>{f.issue}</Text>
              {f.action && f.action !== 'none' ? <Text style={styles.flagAction}>Do: {f.action}</Text> : null}
              {f.source ? <Text style={styles.source}>{f.source}</Text> : null}
              {notes && onTellT && f.severity !== 'info' ? (
                <TouchableOpacity onPress={() => onTellT(`${f.stop ? `${f.stop.replace(/\s*\(.*\)\s*$/, '')}: ` : ''}${f.issue}`)} hitSlop={{ top: 8, bottom: 8 }}
                  accessibilityRole="button" accessibilityLabel="Tell T about this">
                  <Text style={styles.more}>Tell T about this ›</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          ))}
          {(r.checks ?? []).length ? (
            <TouchableOpacity onPress={() => setShowChecks(s => !s)} hitSlop={{ top: 8, bottom: 8 }} accessibilityRole="button">
              <Text style={styles.more}>{showChecks ? 'Hide what was checked' : `What was checked (${r.checks!.length})`}</Text>
            </TouchableOpacity>
          ) : null}
          {showChecks ? (r.checks ?? []).map((c, i) => (
            <Text key={i} style={styles.check}><Text style={styles.checkWhat}>{c.what}: </Text>{c.result}</Text>
          )) : null}
          <Text style={styles.source}>Claude checks the plan only. It never changes it.</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  mark: { width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, textAlign: 'center', fontSize: 12, lineHeight: 17, fontWeight: '800', overflow: 'hidden' },
  text: { flex: 1, fontSize: 13, lineHeight: 18, color: colors.textPrimary },
  lead: { fontWeight: '700' },
  go: { color: colors.textSecondary },
  body: { gap: 8, paddingLeft: 28 },
  summary: { fontSize: 13, lineHeight: 18, color: colors.textSecondary },
  flag: { borderLeftWidth: 2, paddingLeft: 8, gap: 2 },
  flagStop: { fontSize: 12, fontWeight: '700', color: colors.textPrimary },
  flagText: { fontSize: 13, lineHeight: 18, color: colors.textPrimary },
  flagAction: { fontSize: 12, fontWeight: '700', color: TINT.check },
  source: { fontSize: 11, color: colors.textSecondary },
  more: { fontSize: 12, fontWeight: '700', color: colors.signalOk },
  check: { fontSize: 12, lineHeight: 17, color: colors.textSecondary },
  checkWhat: { fontWeight: '700', color: colors.textPrimary },
});
