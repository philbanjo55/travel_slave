import Constants from 'expo-constants';

// True in "Philm+Frame TEST" (eas.json profile `test`, APP_VARIANT=test).
// The solver's Planner screens show only there until Phil signs the solver
// off, so this code can sit on `update` without reaching the real app.
// Read from the built config (name / package), so no app.config change and
// no new fingerprint for the real app.
const cfg: any = Constants.expoConfig ?? {};
export const IS_TEST_APP: boolean =
  String(cfg.name ?? '').endsWith('TEST') || String(cfg.android?.package ?? '').endsWith('.test');

// Every feature shows in both apps since 15 Nov 2026 (Phil: the main app gets
// everything the TEST app had; TEST is where new things are built next).
// IS_TEST_APP still tells the two builds apart (logs, update channel).
export const PLANNER_ON = true;

// Planner redesign, option 3 "Week strip on top" (Phil, 28 Nov 2026: "I like the idea of option 3"; mockup
// https://claude.ai/artifact/6bFbuwwtbZDFQLeDVYQ7Po). TEST app only: the day tabs become week tiles (T's number and
// changes per day), one "Re-plan from now on" button, the timeline always shows T's day merged with yours, the stop
// page's T block has no tabs, and the Planner screen moves behind the trip's ⋯ menu.
export const OPTION3_UI: boolean = IS_TEST_APP;
