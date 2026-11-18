# solver-replay-lab: the test lane

A second copy of the planner (Phil, 18 Nov 2026: "build the lane and put ideal light on it"). Runs whose
config has `lane: 'lab'` are sent here by `replay_run_tick` (`replay_fn_url`); every other run, the live T
runs included, keeps going to `solver-replay`, which nobody touches for an experiment.

- Deploy experiments here freely (`supabase functions deploy solver-replay-lab ...`); keep this folder = deployed.
- A lab run never reaches the app: it is not a publish run in the database (config `publish` false, so no
  "the trip's T run" lookup can pick it), `as_app: true` makes it plan like the live T run in memory (Phil's
  ticks and notes), `publish()` writes nothing and one-pass starts no rest-of-trip draft from it, and this
  function refuses any run without `lane: 'lab'`.
- Live experiments: a row in `planner_lab` (trip, name, extra switches). Cron `planner-lab-follow` (every
  10 min) copies the trip's live T run at a night boundary (T's own state) as `lab_<name>`, plans 10 min after T.
- Bench: any replay run with `lane: 'lab'` in its config.
- A winner moves into `solver-replay` once, after a bench run shows its switch-off plans are identical.

Today's lab code = `solver-replay` (a42bf90e) + the ideal-light bits (`ideal` 655360, `ideal_strong` 1310720) + the lab guards.
