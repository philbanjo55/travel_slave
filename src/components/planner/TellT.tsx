import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { colors, radius, spacing, typography } from '../../theme';
import { errText } from '../../utils/errText';
import {
  TNote, QuickKind, clearNote, covers, dropWaiting, fetchNote, followReplan, queueNote, quickNote, readNote, refreshNotes, restOfTrip,
  saveNote, useNotes, useNotesOn,
} from '../../services/tNotes';

// "Tell T about your day" on a day card (TEST app; Phil, 10 Nov 2026). Type a note (or tap a quick button);
// Claude turns it into rules T follows and the sheet shows them in plain words. Nothing is in force until
// "Looks right". The card lists the notes in force for the day, each with an x to remove it.
// Shows only where Tell T is switched on for the trip.

const QUICK: { kind: QuickKind; label: string; needs?: 'time' | 'place' }[] = [
  { kind: 'sleep_in', label: 'Sleep in' },
  { kind: 'easy_day', label: 'Easy day' },
  { kind: 'nothing_long', label: 'Nothing long' },
  { kind: 'day_off', label: 'Day off' },
  { kind: 'back_by', label: 'Back by…', needs: 'time' },
  { kind: 'skip', label: 'Skip a place…', needs: 'place' },
  { kind: 'want', label: 'Want a place…', needs: 'place' },
];
const TIMES = ['12:00', '13:00', '14:00', '15:00', '16:00', '16:30', '17:00', '17:30', '18:00', '18:30', '19:00', '20:00'];
const clock = (t: string) => { const [h, m] = t.split(':').map(Number); return `${((h + 11) % 12) + 1}${m ? ':' + String(m).padStart(2, '0') : ''} ${h < 12 ? 'AM' : 'PM'}`; };
const HINT = 'dinner at 7 · skip Oxbow today · running an hour late · peaks are out · nailed the barns · why is Oxbow on Thursday?';

type Phase =
  | { k: 'write' }
  | { k: 'busy'; what: string }
  | { k: 'pick'; quick: typeof QUICK[number] }
  | { k: 'preview'; note: TNote }
  | { k: 'asking'; note: TNote }
  | { k: 'answer'; note: TNote }
  | { k: 'saved'; lines: string[] }
  | { k: 'error'; message: string; offline?: boolean };

function Lines({ note }: { note: TNote }) {
  return (
    <View style={{ gap: 6 }}>
      {(note.say ?? []).map((l, i) => (
        <View key={i} style={styles.line}>
          <Text style={styles.lineText}>{l.text}</Text>
          <Text style={styles.lineWhen}>{l.when}{l.why ? ` · ${l.why}` : ''}</Text>
        </View>
      ))}
      {(note.info ?? []).map((t, i) => <Text key={`i${i}`} style={styles.cant}>T can't use: {t}</Text>)}
    </View>
  );
}

export function TellTSheet({ visible, onClose, tripId, date, dayLabel, places, startText, startNote }: {
  visible: boolean; onClose: () => void; tripId: string; date: string; dayLabel: string; places: string[];
  startText?: string; startNote?: TNote | null;
}) {
  const [text, setText] = useState('');
  const [phase, setPhase] = useState<Phase>({ k: 'write' });
  const alive = useRef(true);
  const box = useRef<any>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  // Android does not reliably focus a box inside a pop-up by itself (emulator test, 11 Nov 2026): ask for it once the sheet is up.
  useEffect(() => {
    if (!visible || phase.k !== 'write') return;
    const t = setTimeout(() => box.current?.focus(), 350);
    return () => clearTimeout(t);
  }, [visible, phase.k]);
  useEffect(() => {
    if (!visible) return;
    setText(startNote?.text ?? startText ?? '');
    setPhase(startNote ? (startNote.status === 'asking' ? { k: 'asking', note: startNote } : { k: 'preview', note: startNote }) : { k: 'write' });
  }, [visible, startNote, startText]);

  // What the note would make T give up arrives a few seconds after the preview.
  const pv = phase.k === 'preview' ? phase.note : null;
  useEffect(() => {
    if (!pv || !pv.id || pv.cost || !(pv.rules ?? []).length) return;
    let n = 0;
    const t = setInterval(async () => {
      n += 1;
      const fresh = await fetchNote(pv.id).catch(() => null);
      if (!alive.current) return;
      if (fresh?.cost || n >= 20) { clearInterval(t); if (fresh?.cost) setPhase(p => (p.k === 'preview' && p.note.id === fresh.id ? { k: 'preview', note: fresh } : p)); }
    }, 4000);
    return () => clearInterval(t);
  }, [pv?.id, pv?.cost]);

  const show = (note: TNote) => setPhase(note.status === 'asking' ? { k: 'asking', note } : note.status === 'answer' ? { k: 'answer', note } : { k: 'preview', note });
  const fail = (e: any) => setPhase({ k: 'error', message: errText(e), offline: !!e?.offline });
  const send = async (answer?: { question: string; choice: string }) => {
    const t = text.trim();
    if (t.length < 2) return;
    setPhase({ k: 'busy', what: 'T is reading your note…' });
    try { const note = await readNote(tripId, date, t, answer); if (alive.current) show(note); refreshNotes(tripId); }
    catch (e) { if (alive.current) fail(e); }
  };
  const quick = async (q: typeof QUICK[number], extra: { time?: string; place?: string } = {}) => {
    setPhase({ k: 'busy', what: 'Telling T…' });
    try {
      const qr = await quickNote(tripId, date, q.kind, extra);
      const note = qr.note;
      followReplan(tripId, qr);
      refreshNotes(tripId);
      if (alive.current) setPhase({ k: 'saved', lines: [...(note.say ?? []).map(l => `${l.text} (${l.when})`), 'T is re-planning the days this touches.'] });
    } catch (e) { if (alive.current) fail(e); }
  };
  const ok = async (note: TNote) => {
    setPhase({ k: 'busy', what: 'Saving…' });
    try {
      const r = await saveNote(note.id);
      followReplan(tripId, r);
      refreshNotes(tripId);
      const lines: string[] = [];
      for (const m of r.marks ?? []) lines.push(m.set ? `${m.place}: marked ${m.result === 'nailed' ? 'Nailed it' : 'Go back for better'}.` : `${m.place}: your ticks stay as they are.`);
      if (r.now) lines.push(r.now.ok === false ? `T could not re-plan the rest of today: ${r.now.error ?? 'no answer'}` : 'T is re-planning the rest of today (about a minute). The new plan shows on the day card.');
      if ((note.rules ?? []).length) lines.push('T is re-planning the days this touches.');
      if (!lines.length) lines.push('Saved.');
      if (alive.current) setPhase({ k: 'saved', lines });
    } catch (e) { if (alive.current) fail(e); }
  };
  const change = async (note: TNote) => {   // back to the box; the unconfirmed draft is dropped
    setPhase({ k: 'write' });
    clearNote(note.id).then(() => refreshNotes(tripId)).catch(() => {});
  };
  const keep = async () => { await queueNote(tripId, date, text.trim()); onClose(); };

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.back}>
        <View style={styles.sheet}>
          <View style={styles.head}>
            <Text style={styles.title}>Tell T · {dayLabel}</Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }} accessibilityRole="button" accessibilityLabel="Close Tell T">
              <Text style={styles.close}>Close</Text>
            </TouchableOpacity>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: spacing.md, paddingBottom: spacing.xl }}>
            {phase.k === 'write' ? (
              <>
                <TextInput ref={box} value={text} onChangeText={setText} multiline placeholder={HINT} placeholderTextColor={colors.textTertiary}
                  style={styles.input} accessibilityLabel="Your note for T" maxLength={1000} />
                <TouchableOpacity onPress={() => send()} disabled={text.trim().length < 2} style={[styles.primary, text.trim().length < 2 && { opacity: 0.4 }]}
                  activeOpacity={0.8} accessibilityRole="button" accessibilityLabel="Send the note to T">
                  <Text style={styles.primaryText}>Send to T</Text>
                </TouchableOpacity>
                <Text style={styles.label}>OR ONE TAP</Text>
                <View style={styles.chips}>
                  {QUICK.map(q => (
                    <TouchableOpacity key={q.kind} style={styles.chip} activeOpacity={0.8} accessibilityRole="button" accessibilityLabel={`Quick: ${q.label}`}
                      onPress={() => (q.needs ? setPhase({ k: 'pick', quick: q }) : quick(q))}>
                      <Text style={styles.chipText}>{q.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <Text style={styles.small}>T shows you what it understood before anything changes. A note never edits your stops.</Text>
              </>
            ) : null}
            {phase.k === 'busy' ? <View style={styles.busy}><ActivityIndicator color={colors.textPrimary} /><Text style={styles.small}>{phase.what}</Text></View> : null}
            {phase.k === 'pick' ? (
              <>
                <Text style={styles.label}>{phase.quick.needs === 'time' ? 'BACK BY' : phase.quick.kind === 'skip' ? 'SKIP WHICH PLACE (THIS DAY)' : 'WANT WHICH PLACE (THIS DAY)'}</Text>
                <View style={styles.chips}>
                  {(phase.quick.needs === 'time' ? TIMES : places).map(x => (
                    <TouchableOpacity key={x} style={styles.chip} activeOpacity={0.8} accessibilityRole="button"
                      onPress={() => quick(phase.quick, phase.quick.needs === 'time' ? { time: x } : { place: x })}>
                      <Text style={styles.chipText}>{phase.quick.needs === 'time' ? clock(x) : x}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <TouchableOpacity onPress={() => setPhase({ k: 'write' })} accessibilityRole="button"><Text style={styles.link}>Back</Text></TouchableOpacity>
              </>
            ) : null}
            {phase.k === 'preview' ? (
              <>
                <Text style={styles.quote}>“{phase.note.text}”</Text>
                {(phase.note.say ?? []).length ? <Text style={styles.label}>T WILL</Text> : <Text style={styles.small}>T found nothing in this note it can follow.</Text>}
                <Lines note={phase.note} />
                {(phase.note.rules ?? []).length ? (
                  phase.note.cost?.lines?.length ? (
                    <View style={styles.cost}>{phase.note.cost.lines.map((l, i) => <Text key={i} style={styles.costText}>{l}</Text>)}</View>
                  ) : phase.note.cost ? null : <Text style={styles.small}>Working out what this gives up on the later days…</Text>
                ) : null}
                {(phase.note.say ?? []).length ? (
                  <TouchableOpacity onPress={() => ok(phase.note)} style={styles.primary} activeOpacity={0.8} accessibilityRole="button" accessibilityLabel="Looks right: tell T to go by this note">
                    <Text style={styles.primaryText}>Looks right</Text>
                  </TouchableOpacity>
                ) : null}
                <TouchableOpacity onPress={() => change(phase.note)} accessibilityRole="button" accessibilityLabel="Change the note"><Text style={styles.link}>Change note</Text></TouchableOpacity>
              </>
            ) : null}
            {phase.k === 'asking' && phase.note.ask ? (
              <>
                <Text style={styles.quote}>“{phase.note.text}”</Text>
                <Text style={styles.question}>{phase.note.ask.question}</Text>
                <View style={{ gap: spacing.sm }}>
                  {phase.note.ask.options.map(o => (
                    <TouchableOpacity key={o} style={styles.option} activeOpacity={0.8} accessibilityRole="button"
                      onPress={() => { const a = { question: phase.note.ask!.question, choice: o }; clearNote(phase.note.id).catch(() => {}); send(a); }}>
                      <Text style={styles.optionText}>{o}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <TouchableOpacity onPress={() => change(phase.note)} accessibilityRole="button"><Text style={styles.link}>Change note</Text></TouchableOpacity>
              </>
            ) : null}
            {phase.k === 'answer' ? (
              <>
                <Text style={styles.quote}>“{phase.note.text}”</Text>
                {(phase.note.answer?.if_say ?? []).length ? (
                  <><Text style={styles.label}>IF T DID THIS</Text>{phase.note.answer!.if_say!.map((l, i) => <Text key={i} style={styles.lineWhen}>{l.text} ({l.when})</Text>)}</>
                ) : null}
                <Text style={styles.label}>T SAYS</Text>
                {(phase.note.answer?.lines ?? []).map((l, i) => <Text key={i} style={styles.lineText}>{l}</Text>)}
                <Text style={styles.small}>A question changes nothing.</Text>
                <TouchableOpacity onPress={() => setPhase({ k: 'write' })} accessibilityRole="button"><Text style={styles.link}>Ask or tell T something else</Text></TouchableOpacity>
              </>
            ) : null}
            {phase.k === 'saved' ? (
              <>
                {phase.lines.map((l, i) => <Text key={i} style={styles.lineText}>{l}</Text>)}
                <TouchableOpacity onPress={onClose} style={styles.primary} activeOpacity={0.8} accessibilityRole="button"><Text style={styles.primaryText}>Done</Text></TouchableOpacity>
              </>
            ) : null}
            {phase.k === 'error' ? (
              <>
                <Text style={[styles.lineText, { color: '#e74c3c' }]}>{phase.offline ? 'No signal: T could not be reached.' : phase.message}</Text>
                {phase.offline && text.trim().length >= 2 ? (
                  <TouchableOpacity onPress={keep} style={styles.primary} activeOpacity={0.8} accessibilityRole="button" accessibilityLabel="Keep the note and send it when there is signal">
                    <Text style={styles.primaryText}>Keep it and send when there's signal</Text>
                  </TouchableOpacity>
                ) : null}
                <TouchableOpacity onPress={() => setPhase({ k: 'write' })} accessibilityRole="button"><Text style={styles.link}>Back to the note</Text></TouchableOpacity>
              </>
            ) : null}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// The row on a day card: the button, the notes in force for the day, notes waiting for the OK or for signal.
export function TellTRow({ tripId, date, dayLabel, places, open, onOpened }: {
  tripId: string; date: string; dayLabel: string; places: string[];
  // A note to start from (the plan check's "Tell T" link): the sheet opens with this text.
  open?: string | null; onOpened?: () => void;
}) {
  const on = useNotesOn(tripId);
  const { notes, waiting } = useNotes(on ? tripId : null);
  const [sheet, setSheet] = useState<{ text?: string; note?: TNote } | null>(null);
  useEffect(() => { if (on && open) { setSheet({ text: open }); onOpened?.(); } }, [on, open]);
  if (!on) return null;
  const mine = notes.filter(n => n.status === 'active' && covers(n, date));
  const drafts = notes.filter(n => (n.status === 'draft' || n.status === 'asking') && n.typed_on === date);
  const wait = waiting.filter(w => w.date === date);
  const remove = (n: TNote) => Alert.alert('Remove this note?', `“${n.text}”\nT re-plans the days it touched.`, [
    { text: 'Keep it', style: 'cancel' },
    { text: 'Remove', style: 'destructive', onPress: () => clearNote(n.id).then(r => { followReplan(tripId, r); return refreshNotes(tripId); }).catch((e: any) => Alert.alert('Could not remove it', errText(e))) },
  ]);
  return (
    <View style={{ gap: 6 }}>
      {mine.length ? <Text style={styles.label}>YOUR NOTES FOR T</Text> : null}
      {mine.map(n => (
        <View key={n.id} style={styles.noteRow}>
          <View style={{ flex: 1, gap: 2 }}>
            {(n.say ?? []).map((l, i) => <Text key={i} style={styles.noteText}>{l.text} <Text style={styles.noteWhen}>· {l.when}</Text></Text>)}
          </View>
          <TouchableOpacity onPress={() => remove(n)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} accessibilityRole="button" accessibilityLabel={`Remove the note: ${n.text}`}>
            <Text style={styles.x}>✕</Text>
          </TouchableOpacity>
        </View>
      ))}
      {drafts.map(n => (
        <TouchableOpacity key={n.id} onPress={() => setSheet({ note: n })} activeOpacity={0.8} accessibilityRole="button" accessibilityLabel={`Note waiting for your OK: ${n.text}`}>
          <Text style={styles.pending}>{n.status === 'asking' ? 'T has a question about' : 'Needs your OK'}: “{n.text}” ›</Text>
        </TouchableOpacity>
      ))}
      {wait.map(w => (
        <View key={w.key} style={styles.noteRow}>
          <Text style={[styles.noteWhen, { flex: 1 }]}>Waiting for signal: “{w.text}”</Text>
          <TouchableOpacity onPress={() => dropWaiting(w.key)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} accessibilityRole="button" accessibilityLabel="Drop the waiting note">
            <Text style={styles.x}>✕</Text>
          </TouchableOpacity>
        </View>
      ))}
      <TouchableOpacity onPress={() => setSheet({})} style={styles.tellBtn} activeOpacity={0.8} accessibilityRole="button" accessibilityLabel="Tell T about this day">
        <Text style={styles.tellText}>Tell T about this day ›</Text>
      </TouchableOpacity>
      <TellTSheet visible={!!sheet} onClose={() => { setSheet(null); refreshNotes(tripId); }} tripId={tripId} date={date} dayLabel={dayLabel}
        places={places} startText={sheet?.text} startNote={sheet?.note ?? null} />
    </View>
  );
}

// Planner Setup tab: the notes that hold for the rest of the trip.
export function TripRules({ tripId }: { tripId: string }) {
  const on = useNotesOn(tripId);
  const { notes } = useNotes(on ? tripId : null);
  if (!on) return null;
  const rules = notes.filter(n => n.status === 'active' && restOfTrip(n));
  return (
    <View style={styles.rules}>
      <Text style={styles.label}>TRIP RULES (FROM YOUR NOTES)</Text>
      {rules.length ? rules.map(n => (
        <View key={n.id} style={styles.noteRow}>
          <View style={{ flex: 1, gap: 2 }}>
            {(n.say ?? []).map((l, i) => <Text key={i} style={styles.noteText}>{l.text} <Text style={styles.noteWhen}>· {l.when}</Text></Text>)}
          </View>
          <TouchableOpacity hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} accessibilityRole="button" accessibilityLabel={`Remove the trip rule: ${n.text}`}
            onPress={() => Alert.alert('Remove this rule?', `“${n.text}”`, [{ text: 'Keep it', style: 'cancel' },
              { text: 'Remove', style: 'destructive', onPress: () => clearNote(n.id).then(r => { followReplan(tripId, r); return refreshNotes(tripId); }).catch(() => {}) }])}>
            <Text style={styles.x}>✕</Text>
          </TouchableOpacity>
        </View>
      )) : <Text style={styles.small}>None. A note like “always back by 6” or “never before 6:30” shows here.</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  // The sheet hangs from the top of the screen, so the box and its Send button stay clear of the keyboard.
  back: { flex: 1, justifyContent: 'flex-start', paddingTop: 44, backgroundColor: 'rgba(0,0,0,0.7)' },
  sheet: { maxHeight: '86%', backgroundColor: colors.surfaceElevated, borderRadius: radius.lg, marginHorizontal: spacing.sm, padding: spacing.lg, gap: spacing.md },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontSize: 16, fontWeight: '700', color: colors.textPrimary },
  close: { fontSize: 14, fontWeight: '700', color: colors.textSecondary },
  input: { minHeight: 96, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: colors.surface,
           padding: spacing.md, fontSize: 16, lineHeight: 22, color: colors.textPrimary, textAlignVertical: 'top' },
  primary: { minHeight: 48, borderRadius: radius.md, backgroundColor: colors.signalOk, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.lg },
  primaryText: { fontSize: 15, fontWeight: '800', color: colors.textInverse },
  label: { ...typography.labelMedium, color: colors.textSecondary },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { minHeight: 44, justifyContent: 'center', paddingHorizontal: spacing.md, borderRadius: radius.full, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: colors.surface },
  chipText: { fontSize: 14, fontWeight: '600', color: colors.textPrimary },
  small: { fontSize: 12, lineHeight: 17, color: colors.textSecondary },
  busy: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.lg },
  quote: { fontSize: 14, lineHeight: 20, fontStyle: 'italic', color: colors.textSecondary },
  line: { borderLeftWidth: 2, borderLeftColor: colors.signalOk, paddingLeft: spacing.sm, gap: 2 },
  lineText: { fontSize: 15, lineHeight: 21, color: colors.textPrimary },
  lineWhen: { fontSize: 12, lineHeight: 17, color: colors.textSecondary },
  cant: { fontSize: 13, lineHeight: 18, color: '#e0a84b' },
  cost: { borderRadius: radius.sm, backgroundColor: colors.surface, padding: spacing.sm, gap: 4 },
  costText: { fontSize: 13, lineHeight: 18, color: '#e0a84b' },
  link: { fontSize: 14, fontWeight: '700', color: colors.signalOk, paddingVertical: spacing.sm },
  question: { fontSize: 16, lineHeight: 22, fontWeight: '700', color: colors.textPrimary },
  option: { minHeight: 48, justifyContent: 'center', borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: colors.surface, paddingHorizontal: spacing.md },
  optionText: { fontSize: 15, color: colors.textPrimary },
  noteRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  noteText: { fontSize: 13, lineHeight: 18, color: colors.textPrimary },
  noteWhen: { fontSize: 12, color: colors.textSecondary },
  x: { fontSize: 14, fontWeight: '800', color: colors.textSecondary, paddingHorizontal: 4 },
  pending: { fontSize: 13, lineHeight: 18, fontWeight: '700', color: '#e0a84b' },
  tellBtn: { alignSelf: 'flex-start', minHeight: 36, justifyContent: 'center', paddingHorizontal: 12, borderRadius: radius.sm, backgroundColor: colors.surface },
  tellText: { fontSize: 13, fontWeight: '700', color: colors.signalOk },
  rules: { marginVertical: spacing.sm, padding: spacing.md, gap: 6, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: colors.surface },
});
