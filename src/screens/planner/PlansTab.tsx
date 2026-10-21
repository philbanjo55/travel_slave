import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { format, parseISO } from 'date-fns';
import { colors, spacing, radius } from '../../theme';
import { DayPlanView, MultiPlanView } from '../../components/planner/PlanView';
import { dayBadge } from '../../components/planner/dayBadge';

// Any trip day, or three days together. The chosen day is shared with Map.
export default function PlansTab({ tripId, days, date, setDate, goMap }: {
  tripId: string; days: any[]; date: string | null; setDate: (d: string) => void; goMap: () => void;
}) {
  const [span, setSpan] = useState<1 | 3>(1);
  const dated = days.filter((d: any) => d.date);
  const cur = date ?? dated[0]?.date ?? null;
  const i = dated.findIndex((d: any) => d.date === cur);
  const three = i >= 0 ? dated.slice(i, i + 3).map((d: any) => d.date) : [];

  return (
    <ScrollView contentContainerStyle={styles.body}>
      <View style={styles.spanRow}>
        {([1, 3] as const).map(n => (
          <TouchableOpacity key={n} onPress={() => setSpan(n)} style={[styles.spanBtn, span === n && styles.spanOn]}>
            <Text style={[styles.spanText, span === n && styles.spanTextOn]}>{n === 1 ? '1 day' : '3 days'}</Text>
          </TouchableOpacity>
        ))}
        <TouchableOpacity onPress={goMap} style={styles.mapLink} accessibilityLabel="Show this plan on the map">
          <Text style={styles.link}>On map ›</Text>
        </TouchableOpacity>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.days}>
        {dated.map((d: any) => {
          const on = span === 1 ? d.date === cur : three.includes(d.date);
          const b = dayBadge(d.date);
          return (
            <TouchableOpacity key={d.id} onPress={() => setDate(d.date)} style={[styles.day, on && styles.dayOn]}>
              <Text style={[styles.dayNum, on && styles.dayTextOn]}>D{d.day_number}</Text>
              <Text style={[styles.dayDate, on && styles.dayTextOn]}>{format(parseISO(d.date), 'd MMM')}</Text>
              <Text style={[styles.dayBadge, { color: on ? colors.textInverse : b.color }]}>{b.text === 'LIGHT ONLY' ? 'LIGHT' : b.text.slice(0, 5)}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {!cur ? <Text style={styles.hint}>This trip has no dated days.</Text>
        : span === 1 ? <DayPlanView tripId={tripId} tripDate={cur} />
        : three.length > 1 ? <MultiPlanView tripId={tripId} tripDates={three} />
        : <Text style={styles.hint}>Pick a day with at least one trip day after it.</Text>}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  body: { padding: spacing.lg, paddingBottom: spacing.xxxl, gap: spacing.md },
  spanRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  spanBtn: { minHeight: 34, paddingHorizontal: 14, justifyContent: 'center', borderRadius: radius.full, borderWidth: 1, borderColor: colors.border },
  spanOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  spanText: { fontSize: 13, color: colors.textPrimary },
  spanTextOn: { color: colors.textInverse, fontWeight: '700' },
  mapLink: { marginLeft: 'auto', minHeight: 34, justifyContent: 'center', paddingHorizontal: spacing.sm },
  link: { fontSize: 13, color: colors.accent, fontWeight: '600' },
  days: { gap: 6 },
  day: { width: 58, paddingVertical: 8, alignItems: 'center', gap: 2, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border },
  dayOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  dayNum: { fontSize: 12, fontWeight: '700', color: colors.textPrimary },
  dayDate: { fontSize: 11, color: colors.textSecondary },
  dayTextOn: { color: colors.textInverse },
  dayBadge: { fontSize: 8, fontWeight: '800', letterSpacing: 0.6 },
  hint: { fontSize: 12, color: colors.textTertiary },
});
