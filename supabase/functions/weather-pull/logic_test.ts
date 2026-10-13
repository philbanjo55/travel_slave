// Unit tests for the pure weather-pull decision logic.
// Run: deno test --no-remote supabase/functions/weather-pull/logic_test.ts
// deno-lint-ignore-file no-explicit-any
// Minimal assertions (no remote imports, so tests run offline).
const assert = {
  ok(v: unknown, msg = 'expected truthy') { if (!v) throw new Error(msg); },
  equal(a: unknown, b: unknown, msg?: string) {
    if (a !== b) throw new Error(`${msg ?? 'not equal'}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
  },
  deepEqual(a: unknown, b: unknown, msg?: string) {
    const ja = JSON.stringify(a), jb = JSON.stringify(b);
    if (ja !== jb) throw new Error(`${msg ?? 'not deep-equal'}: got ${ja}, want ${jb}`);
  },
};
import {
  consensus, fogRisk, leadDayFor, minutesFromISOrelativeTo, parseHour, pickPrimary,
  rankModels, readModelRow, registryFrom, stopRegistry, SKILL_MIN_HOURS,
} from './logic.ts';

// A registry shaped like the live weather_models table (subset).
const REG = registryFrom(
  {
    'DMI/KNMI HARMONIE': ['dmi_harmonie_arome_europe', 'dmi_seamless', 'knmi_harmonie_arome_europe'],
    'DWD ICON': ['icon_eu', 'icon_seamless', 'icon_global'],
    'ECMWF': ['ecmwf_ifs025'],
    'UK Met Office': ['ukmo_seamless'],
    'NOAA GFS': ['gfs_seamless', 'ncep_hrrr_conus', 'ncep_nbm_conus'],
    'Env. Canada': ['gem_seamless'],
  },
  {
    dmi_harmonie_arome_europe: 2, dmi_seamless: 25, knmi_harmonie_arome_europe: 2,
    icon_eu: 7, icon_seamless: 7, icon_global: 13, ecmwf_ifs025: 25, ukmo_seamless: 10,
    gfs_seamless: 13, ncep_hrrr_conus: 3, ncep_nbm_conus: 2.5, gem_seamless: 15,
  },
  {
    dmi_harmonie_arome_europe: 10, dmi_seamless: 11, knmi_harmonie_arome_europe: 12,
    icon_eu: 40, icon_seamless: 41, icon_global: 42, ecmwf_ifs025: 50, ukmo_seamless: 30,
    gfs_seamless: 60, ncep_hrrr_conus: 61, ncep_nbm_conus: 62, gem_seamless: 70,
  },
  {
    nativeOf: { icon_seamless: 'icon_eu', dmi_seamless: 'dmi_harmonie_arome_europe' },
    outsideOf: { icon_seamless: 'downgrade', dmi_seamless: 'exclude' },
    outsideResOf: { icon_seamless: 13 },
  },
);

// Coverage as model_grid_points would record it.
const FAROES_GRID: Record<string, { km: number | null; ok: boolean }> = {
  dmi_harmonie_arome_europe: { km: 1.5, ok: true }, icon_eu: { km: 2.5, ok: true },
  ncep_hrrr_conus: { km: null, ok: false }, ncep_nbm_conus: { km: null, ok: false },
};
const TETON_GRID: Record<string, { km: number | null; ok: boolean }> = {
  dmi_harmonie_arome_europe: { km: null, ok: false }, knmi_harmonie_arome_europe: { km: null, ok: false },
  icon_eu: { km: null, ok: false }, ncep_hrrr_conus: { km: 1.1, ok: true }, ncep_nbm_conus: { km: 1.2, ok: true },
};

// A model row as readModelRow builds it; layered = has low cloud.
const row = (layered: boolean, extra: Record<string, any> = {}) => ({
  temperature_c: 1, cloud_cover_pct: 50, cloud_cover_low_pct: layered ? 20 : null, ...extra,
});

// ---------------------------------------------------------------- region rule
Deno.test('region rule: Faroes coverage leaves every model untouched', () => {
  const { reg, adjustments } = stopRegistry(REG, FAROES_GRID);
  assert.deepEqual(adjustments, []);
  assert.deepEqual(reg.models, REG.models);
  assert.deepEqual(reg.resolutionOf, REG.resolutionOf);
  assert.deepEqual(reg.centres, REG.centres);
});

Deno.test('region rule: Teton coverage excludes dmi_seamless and relabels icon_seamless to 13 km', () => {
  const { reg, adjustments } = stopRegistry(REG, TETON_GRID);
  assert.ok(!reg.models.includes('dmi_seamless'));
  assert.equal(reg.resolutionOf.icon_seamless, 13);
  assert.equal(REG.resolutionOf.icon_seamless, 7, 'shared registry must not be mutated');
  assert.deepEqual(adjustments.map((a) => `${a.model}:${a.action}`).sort(),
    ['dmi_seamless:excluded', 'icon_seamless:downgraded']);
  assert.ok(!reg.centres['DMI/KNMI HARMONIE'].includes('dmi_seamless'));
});

Deno.test('region rule: unprobed coverage (new stop) changes nothing', () => {
  const { reg, adjustments } = stopRegistry(REG, {});
  assert.deepEqual(adjustments, []);
  assert.deepEqual(reg.models, REG.models);
});

// ---------------------------------------------------------------- ranking
Deno.test('rankModels: finest resolution first, then nearest grid point, then sort order', () => {
  const grid = { a: { km: 5 }, b: { km: 1 } } as any;
  const reg = registryFrom({ C: ['a', 'b', 'c'] }, { a: 10, b: 10, c: 3 }, { a: 1, b: 2, c: 3 });
  assert.deepEqual(rankModels(reg, ['a', 'b', 'c'], grid), ['c', 'b', 'a']);
});

// ---------------------------------------------------------------- main model
Deno.test('pickPrimary (resolution mode): finest model WITH cloud layers wins over a finer one without', () => {
  const models = { ncep_nbm_conus: row(false), ncep_hrrr_conus: row(true), ukmo_seamless: row(true) };
  const ranked = rankModels(REG, Object.keys(models), TETON_GRID);
  const p = pickPrimary(ranked, models, null);
  assert.equal(p.model, 'ncep_hrrr_conus');
  assert.equal(p.method, 'resolution');
});

Deno.test('pickPrimary (resolution mode): Faroes still picks DMI HARMONIE, as before v34', () => {
  const models = {
    dmi_harmonie_arome_europe: row(true), dmi_seamless: row(true), icon_eu: row(true),
    icon_seamless: row(true), ecmwf_ifs025: row(true), ukmo_seamless: row(true),
  };
  const { reg } = stopRegistry(REG, FAROES_GRID);
  const p = pickPrimary(rankModels(reg, Object.keys(models), FAROES_GRID), models, null);
  assert.equal(p.model, 'dmi_harmonie_arome_europe');
});

Deno.test('pickPrimary (skill mode): lowest skill score with cloud layers wins, regardless of grid size', () => {
  const models = { ncep_hrrr_conus: row(true), gem_seamless: row(true), icon_seamless: row(true) };
  const skill = {
    ncep_hrrr_conus: { skill_score: 35.8, n_hours: 334 },
    gem_seamless: { skill_score: 14.2, n_hours: 334 },
    icon_seamless: { skill_score: 21.1, n_hours: 334 },
  };
  const p = pickPrimary(rankModels(REG, Object.keys(models), TETON_GRID), models, skill);
  assert.equal(p.model, 'gem_seamless');
  assert.equal(p.method, 'skill');
  assert.equal(p.score, 14.2);
});

Deno.test('pickPrimary (skill mode): best score without cloud layers is skipped for the next layered one', () => {
  const models = { ncep_nbm_conus: row(false), gem_seamless: row(true) };
  const skill = { ncep_nbm_conus: { skill_score: 5, n_hours: 334 }, gem_seamless: { skill_score: 20, n_hours: 334 } };
  assert.equal(pickPrimary(Object.keys(models), models, skill).model, 'gem_seamless');
});

Deno.test(`pickPrimary (skill mode): fewer than ${SKILL_MIN_HOURS} verified hours does not count`, () => {
  const models = { ncep_hrrr_conus: row(true), gem_seamless: row(true) };
  const skill = { gem_seamless: { skill_score: 1, n_hours: SKILL_MIN_HOURS - 1 } };
  const p = pickPrimary(rankModels(REG, Object.keys(models), TETON_GRID), models, skill);
  assert.equal(p.model, 'ncep_hrrr_conus');
  assert.equal(p.method, 'resolution-fallback');
});

Deno.test('pickPrimary (skill mode): a model with a score but no data this hour cannot be picked', () => {
  const models = { icon_seamless: row(true) };
  const skill = { gem_seamless: { skill_score: 1, n_hours: 334 }, icon_seamless: { skill_score: 30, n_hours: 334 } };
  assert.equal(pickPrimary(Object.keys(models), models, skill).model, 'icon_seamless');
});

// ---------------------------------------------------------------- consensus
Deno.test('consensus: one vote per centre, and an excluded blend cannot vote', () => {
  const models = {
    dmi_seamless: row(true, { cloud_cover_pct: 90 }), ecmwf_ifs025: row(true, { cloud_cover_pct: 90 }),
    icon_seamless: row(true, { cloud_cover_pct: 40 }), icon_global: row(true, { cloud_cover_pct: 40 }),
    ncep_hrrr_conus: row(true, { cloud_cover_pct: 10 }),
  };
  const before = consensus(models, REG, TETON_GRID as any);
  assert.ok(before.centres.includes('DMI/KNMI HARMONIE'), 'old behaviour: DMI votes in Wyoming');
  const { reg } = stopRegistry(REG, TETON_GRID);
  const after = consensus(models, reg, TETON_GRID as any);
  assert.ok(!after.centres.includes('DMI/KNMI HARMONIE'));
  assert.equal(after.centre_count, before.centre_count - 1);
  assert.equal(after.by_variable.cloud_cover.centres_reporting, 3);
});

// ---------------------------------------------------------------- lead day
Deno.test('leadDayFor: clamps to the 1-7 days model_skill is graded on', () => {
  const now = Date.UTC(2026, 11, 20, 12);
  const h = 3600000;
  assert.equal(leadDayFor(NaN, now), 1);
  assert.equal(leadDayFor(now - 5 * h, now), 1);
  assert.equal(leadDayFor(now + 10 * h, now), 1);
  assert.equal(leadDayFor(now + 62 * h, now), 3);
  assert.equal(leadDayFor(now + 12 * 24 * h, now), 7);
});

// ---------------------------------------------------------------- time parsing
Deno.test('parseHour: rounds to the nearest hour and handles 12 AM / 12 PM', () => {
  assert.equal(parseHour('7:05 AM'), 7);
  assert.equal(parseHour('7:35 AM'), 8);
  assert.equal(parseHour('12:10 PM'), 12);
  assert.equal(parseHour('12:30 AM'), 1);
  assert.equal(parseHour('5:45 PM'), 18);
  assert.equal(parseHour(null), 12);
  assert.equal(parseHour('11:50 PM'), 23, 'never rolls past 23');
});

Deno.test('minutesFromISOrelativeTo: a sunset after midnight counts as the next day', () => {
  assert.equal(minutesFromISOrelativeTo('2026-07-07T00:05', '2026-07-06'), 1445);
  assert.equal(minutesFromISOrelativeTo('2026-12-26T16:52', '2026-12-26'), 1012);
});

// ---------------------------------------------------------------- model rows
Deno.test('readModelRow: reads model-suffixed series and returns null when a model has nothing', () => {
  const H = {
    temperature_2m_icon_global: [1, 2], cloud_cover_icon_global: [10, 20], cloud_cover_low_icon_global: [5, 6],
    temperature_2m_icon_eu: [null, null], cloud_cover_icon_eu: [null, null],
  };
  const r = readModelRow(H, 1, 'icon_global', { icon_global: 'DWD ICON' });
  assert.equal(r?.temperature_c, 2);
  assert.equal(r?.cloud_cover_low_pct, 6);
  assert.equal(r?.centre, 'DWD ICON');
  assert.equal(readModelRow(H, 1, 'icon_eu', {}), null);
});

Deno.test('fogRisk: visibility first, then temperature/dew-point spread', () => {
  assert.equal(fogRisk(null, null, null, null, 45), 'likely');
  assert.equal(fogRisk(800, 99, 0, 0, 3), 'likely');
  assert.equal(fogRisk(3000, 99, 0, 0, 3), 'possible');
  assert.equal(fogRisk(20000, 99, 0, 0, 3), 'none');
  assert.equal(fogRisk(null, 97, 1.0, 0.5, 3), 'possible');
  assert.equal(fogRisk(null, 60, 5, -5, 3), 'none');
});
