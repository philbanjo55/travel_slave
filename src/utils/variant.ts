import Constants from 'expo-constants';

// True in "Philm+Frame TEST" (eas.json profile `test`, APP_VARIANT=test).
// The solver's Planner screens show only there until Phil signs the solver
// off, so this code can sit on `update` without reaching the real app.
// Read from the built config (name / package), so no app.config change and
// no new fingerprint for the real app.
const cfg: any = Constants.expoConfig ?? {};
export const IS_TEST_APP: boolean =
  String(cfg.name ?? '').endsWith('TEST') || String(cfg.android?.package ?? '').endsWith('.test');
