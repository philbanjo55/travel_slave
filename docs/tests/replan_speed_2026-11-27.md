# Why a full Re-plan takes ~5 minutes: three theories tested (27-28 Nov 2026)

Phil: "Do some tests on these theories, in its own branch away from everything else ... It cannot and should not affect
T or the current app in any way." Everything here is read-only: past rows in `planner_t_now`, `replay_runs`,
`replay_run_days`, `solver_runs` and the edge-function request log. Nothing was run, changed or deployed.

Case looked at: the test robot trip's Re-plan of 27 Nov 2026 (draft run 9962, today + 6 days).

## 1. "The later days wait for the scheduler, not for thinking" — TRUE, and it is almost all of the time

- The 6-day draft took **14 solver-replay requests** (Monte Carlo and polish are split into steps to stay under the
  2 s edge CPU limit), 21:36:47 -> 21:41:06 UTC = **4 min 19 s** wall clock.
- Each request took **1.4-2.6 s** (sum ~27 s). The requests are spaced **exactly ~20 s apart** = the `replay-run` cron
  tick: each step waits for the next tick.
- So ~27 s of work is spread over ~260 s. Running the steps back to back (start the next step as soon as one ends,
  for the one run being re-planned) would bring the week part to roughly **30-45 s**.
- Per day, from `replay_run_days.stats.t`: done 1.2-2.3 s, of it loading 0.4-1.0 s, waiting for a lock 0.26-0.68 s.

## 2. "Don't wait for camera pictures that were just read" — TRUE BUT SMALL

- 24 Re-plans with a recorded start (`planner_t_now`): waiting before planning median **12 s**, average **22 s**,
  worst **133 s**. The plan itself then takes ~4 s.
- Same before and after the :37 picture capture (avg 23 s / 20 s), so the long waits are rare, not tied to the hour.
- Using a reading from the last ~30 min would save ~20 s on average, up to ~2 min on a bad tap. My "up to about
  2 minutes on most taps" was wrong: most taps wait 10-20 s.

## 3. "Stop the wasted restart" — WRONG for time (saves server work only)

- One-pass starts a rest-of-trip draft at once and replaces it when today's new plan lands (4 of 48 drafts in the
  last 7 days ended 'stopped').
- The replaced draft runs *while* today's re-plan waits for cameras, and the new draft starts right when today's
  plan lands either way, so removing it saves no waiting time; it only saves a few requests of server work.

## What this means

| | estimated saving | how sure |
|---|---|---|
| 1. back-to-back steps for the run being re-planned | ~3.5 min -> ~40 s for the week | measured cause; the speed-up itself still needs a test build |
| 2. reuse a fresh camera reading | ~20 s typical, up to ~2 min | measured |
| 3. no restart | ~0 s (server work only) | measured |

Full Re-plan: ~5 min today -> roughly **1-1.5 min** with 1 (+ 2). Today's new plan alone: ~15-30 s typical today,
already fine.

## Next test (not done, needs Phil's yes: it would change the scheduler)

Prove 1 on the test lane only: a copy of the scheduler loop that runs one *lab* draft's steps back to back
(`solver-replay-lab`, config `lane: 'lab'`, never published), and compare its wall time and its plans with the same
draft run the normal way. T's own scheduler (`replay_run_tick`) and the live runs stay untouched.

## Lab proof, 28 Nov 2026 (Phil: "a bunch of plans would need to be identical. You'd have to convince me")

Lab only: function `solver-replay-lab` (its self-calls now go to the lab, never to `solver-replay`), runs with
`lane: 'lab'`, `publish: false` (planned like the app in memory, nothing written to the app). Live T runs and
`replay_run_tick` were not changed. Each run = a copy of the real "rest of the trip" draft for that trip at the
same moment (same seed, same settings). A = normal tick pace, B = chained (`chain` + `chain_nights`), A2 = normal
again (to see how much the planner wobbles on its own). Records: table `lab_speed_runs`; helper `lab_speed_make`.

Wave 1 (all 15 at once, 01:28 UTC): the lab worker was overloaded (WORKER_RESOURCE_LIMIT), Faroes 2027 failed on all
three. Plans: 25 of 25 days identical A = A2 = B on the other four trips.

Wave 2 (one run at a time, 01:40-02:55 UTC):

| trip | days | A (tick) | A2 (tick) | B (chained) | B = A | A2 = A |
|---|---|---|---|---|---|---|
| Test robot | 6 | 190 s | 219 s | 18 s | 6/6 | 6/6 |
| Teton Live | 6 | 242 s | 221 s | 18 s | 6/6 | 6/6 |
| Faroes Live | 6 | 443 s | 425 s | 35 s | 6/6 | 6/6 |
| Grand Teton Winter 2026 | 7 | 196 s | 190 s | 29 s | 7/7 | 7/7 |
| Faroe Islands 2027 | 16 | 1141 s | 649 s | 512 s | 16/16 | 6/16 |

B matched A on every day (41 of 41 in wave 2, 66 of 66 counting wave 1). A2 differed from A on 10 Faroes 2027
days: the planner's time budgets make the big 16-day trip wobble between two normal runs, so that is not the
chaining. Faroes 2027 chained: 3 of 29 self-calls hit the edge CPU limit (546) and each waited for the tick's
2-minute reset, which is most of its 512 s.

Switch-on (not done; needs Phil): `planner_t_trips.config.chain_nights = true` per trip; `planner_t_rest`
already turns on `chain` + `chain_nights` for the draft and starts it directly. Undo: set it back to null.
