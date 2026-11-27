// Unit tests for the T2 helpers: node --test supabase/functions/solver-replay/t2.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calChance, CAL_FALLBACK, regionOf, hm12, lightWordOf, LIGHT_WORD, reasonText, goodShotsOf, moveWhyText } from './t2.ts';

test('calibrated chance rises with value and stays in 0..1', () => {
  for (const r of ['teton', 'faroes'] as const) {
    let prev = -1;
    for (let v = 0; v <= 1.0001; v += 0.05) {
      const c = calChance(CAL_FALLBACK[r], v);
      assert.ok(c > 0 && c < 1);
      assert.ok(c > prev);
      prev = c;
    }
  }
});

test('calibrated chance matches the bench reliability table', () => {
  // Held-out bench: Teton value ~0.6 came good ~67%, ~0.4 ~32%; Faroes 0.5 ~52%.
  assert.ok(Math.abs(calChance(CAL_FALLBACK.teton, 0.6) - 0.62) < 0.05);
  assert.ok(Math.abs(calChance(CAL_FALLBACK.teton, 0.4) - 0.22) < 0.05);
  assert.ok(Math.abs(calChance(CAL_FALLBACK.faroes, 0.5) - 0.56) < 0.05);
  // A visit the old p_good called 0% (value ~0.2) still gets a few percent.
  assert.ok(calChance(CAL_FALLBACK.teton, 0.2) > 0.03);
});

test('region from latitude', () => {
  assert.equal(regionOf(43.7), 'teton');
  assert.equal(regionOf(62.0), 'faroes');
});

test('12-hour clock wraps and pads', () => {
  assert.equal(hm12(0), '12:00 AM');
  assert.equal(hm12(7 * 60 + 5), '7:05 AM');
  assert.equal(hm12(12 * 60), '12:00 PM');
  assert.equal(hm12(16 * 60 + 59.6), '5:00 PM');
  assert.equal(hm12(-30), '11:30 PM');
  assert.equal(hm12(24 * 60 + 15), '12:15 AM');
});

test('light words by sun altitude', () => {
  assert.equal(lightWordOf(-3), 'blue hour');
  assert.equal(lightWordOf(2), 'golden hour');
  assert.equal(lightWordOf(10), 'low sun');
  assert.equal(lightWordOf(30), 'daylight');
  assert.equal(LIGHT_WORD.backlit, 'back');
  assert.equal(LIGHT_WORD['in shadow'], 'soft');
});

const base = { anchor: false, rated: true, lightOnly: false, nGood: 4, nFc: 6, peakMinutes: 7 * 60 + 42, peakAlt: 3, waitMin: 0, once: false };
test('reason text', () => {
  assert.equal(reasonText(base), 'good in 4 of 6 forecasts, best light 7:42 AM (golden hour)');
  assert.equal(reasonText({ ...base, anchor: true }), 'Booked: kept at its time');
  assert.equal(reasonText({ ...base, rated: false }), 'On the way');
  assert.equal(reasonText({ ...base, lightOnly: true, nGood: null, nFc: null }), 'typical weather only (no forecast yet), best light 7:42 AM (golden hour)');
  assert.equal(reasonText({ ...base, waitMin: 35, once: true }), 'good in 4 of 6 forecasts, best light 7:42 AM (golden hour), wait 35 min for it, once this trip');
  assert.equal(reasonText({ ...base, waitMin: 19 }), reasonText(base));
});

test('expected good shots count a place once at its best visit', () => {
  const r = goodShotsOf([
    { chance: 0.3, key: 'snake', top: true },
    { chance: 0.7, key: 'snake', top: true },   // same place, second row: best counts
    { chance: 0.5, key: 'barn', top: false },
    { chance: null, key: 'road', top: false },  // unrated
    { chance: 0.9, key: null, top: true },      // unknown stop
  ]);
  assert.deepEqual(r, { exp_all: 1.2, exp_big: 0.7 });
  assert.deepEqual(goodShotsOf([]), { exp_all: 0, exp_big: 0 });
});

const mv = { booked: false, nGood: 4, nFc: 6, own: null, startMinutes: 8 * 60 + 30, ownDayLabel: null, sameDay: false };
test('move reasons', () => {
  assert.equal(moveWhyText({ ...mv, own: { minutes: 7 * 60 + 10, nGood: 1, nFc: 6 } }),
    'moved from your 7:10 AM to 8:30 AM: good in 4 of 6 forecasts then vs 1 of 6 at yours');
  assert.equal(moveWhyText({ ...mv, own: { minutes: 8 * 60 + 10, nGood: 1, nFc: 6 } }), null); // under 30 min
  assert.equal(moveWhyText({ ...mv, ownDayLabel: 'Fri, Jan 2' }), 'moved here from your Fri, Jan 2: good in 4 of 6 forecasts today');
  assert.equal(moveWhyText({ ...mv, ownDayLabel: 'Fri, Jan 2', sameDay: true }), null);
  assert.equal(moveWhyText(mv), 'added: good in 4 of 6 forecasts today');
  assert.equal(moveWhyText({ ...mv, booked: true }), null);
  assert.equal(moveWhyText({ ...mv, nGood: null }), null); // light-only day
});
