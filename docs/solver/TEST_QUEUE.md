# Planner test queue (Phil, 3 Nov 2026: "run more tests we haven't done yet, constantly")

A scheduled check-in in the planning session works this list: read finished runs, record results
(planner_versions + the board), launch the next item when bench slots free up, and tell Phil only
when a result lands. Rules: every new planner version gets its letter in `planner_versions` before
it runs; compare paired per week with `replay_paired(a, b, kind, block_days)` (plain and calendar-block error bars; 3 Nov 2026: the overlapping weeks start 2 days apart, but block SEs came out within ~10% of the plain ones, e.g. T vs L +1.28, SE 0.48 plain / 0.54 by week blocks / 0.47 by 2-week blocks, so past conclusions stand; ~30 versions tried on the same weeks, so a new winner must also hold on fresh data: October, Faroes, live days); sum `realized` per run day (never over a
`jsonb_array_elements` join); check 'no route' nights before reading a result; keep the bench
under 6 runs at a time and never start many heavy (Faroes, polish) runs at once; watch DB size.

Phil, 3 Nov 2026: focus on the solver; app feedback later; roadside repeats are fine.

Held runs (4 Nov 04:30 UTC): `slow56` / `miss56` released again after the midday and fog tests; `foR_T` (Faroes, heavy) still held, release when they are done.

| # | Test | What it answers | Status |
|---|------|-----------------|--------|
| 1 | Y = T + polish 10 (`pk10_56`, 56 winters) | Does a deeper exhaustive day search earn real points, or only plan score? | done 3 Nov: retired. -1.15 +/- 0.42 per week vs T (14 better / 40 worse, both winters down): more search on the forecast's score overfits forecast noise |
| 2 | Faroes on Phil's checked rules (`foR_T`, 33 May trips) | Both Drangarnir trips planned every trip? Bøur Viewpoint used? Points vs `fo47_T` | held (status `held`) until `bf_smoke` is done, then set back to `queued` |
| 3 | Month-matched odds (AE, `20261103080000`) | Autumn (Sep-29 Nov) fits from Teton Oct-Nov 2024/2025: peaks hidden much less than in winter (14-55% vs 33-81% by forecast cloud). Rerun October weeks `monthT_oct` vs `fitT_oct` (winter odds) and `freshpol_oct` (crude rule) with replay_paired | done 3 Nov: `monthT_oct` 49.5 points/week; +1.72 +/- 0.86 vs winter odds (`fitT_oct`, 8 better / 1 worse), +0.55 +/- 1.11 vs the crude rule (`freshpol_oct`, 4 / 6), no 'no route' nights. AE = contender, kept on for the autumn practice trips; the Dec-Jan trip keeps winter odds |
| 4 | Missed stop recovery (X3, `miss56`, solver-replay v61 run config `miss_seed` 1) | One night per week the first planned S/GOD visit is missed (earns nothing, not shot, not seen). Read: `replay_paired('miss56','freshpol56')` = cost of a miss; recovery = in weeks whose missed place is once-only, was it visited on a later night (replay_run_days.visits); stats.missed names it | running 4 Nov (released 00:10 UTC) |
| 5 | Slow drives (X2, `slow56`, run config `slow_drive` 1.25) | Same plans as T; stats.slow = {realized, late, delay_min} with every drive x1.25. Read: avg(realized - stats.slow.realized) per week, share of visits late, which stops lose most | running 4 Nov (released 00:10 UTC) |
| 6 | Brute force, one day (B1 = planner Z1, run config `brute`, solver-replay v58) | Every candidate place, every start slot, all weather versions, for tomorrow: how far is T's day from the true best of its own score, and does the gap show up in realized points? | retired 4 Nov (Z1): never finished a search inside the 2 s limit, smoke -0.50, 3 of the first 6 full weeks died at night 0 even after a retry (3 done: -2.75); remaining bf56 runs stopped |
| 7 | Brute force, week (planner Z, run config `week_exact`, solver-replay v59) | The rest of the week solved exactly in each weather version inside T's Monte Carlo (every open place on any later day or none, keep-together as one, same day sizes / gear window / miss penalty as the stand-in), from the stand-in's answer | done 4 Nov: retired (Z). `wk56` 32.95 points/week, -0.59 +/- 0.38 vs T (56 weeks, 14 better / 18 worse, 2024-25 -0.7, 2025-26 -0.5), no 'no route' nights. Like Y: more exact search on the forecast's score does not earn real points |
| 7b | Careful score (solver-replay v60), 4 versions x 56 winters vs T (`freshpol56`): AA `cl10_56` risk weight 1.0, AB `cl20_56` 2.0, AC `sh75_56` forecast trusted 75% (rest = light x usual clear-peaks share, clim_hidden 0.47 = KJAC+camera daylight 2016-2023), AD `sh50_56` 50% | Y lost points by trusting the forecast harder: does trusting it less (or weighting bad outcomes more) earn points? If one wins, rerun brute force (Z1 / Z) on that score | done 3 Nov: all retired. vs T per week: AA -0.55 +/- 0.34 (55 wks), AB -0.99 +/- 0.54, AC -0.58 +/- 0.40 (54), AD -0.48 +/- 0.52 (55); every one worse in 2025-26 (-0.8 to -1.7), about even in 2024-25. T's risk weight 0.5 and full trust stay. 4 weeks lost to CPU errors are left out |
| 8 | Real trip dry run | T on exactly 29 Dec - 4 Jan in both past winters, plans in plain words for Phil to sanity-check | todo |
| 9 | Live scoreboard | T vs L vs old on the practice trips, nightly | ongoing |
| 10 | Midday re-plan (AF, `mid_smoke` then `mid56` + `mid_oct`, solver-replay v62 run config `midday`) | A second look at the peaks at local noon (the report in the hour before noon re-conditions the odds from 13:00, `replay_morning_counts` lk 1) and the afternoon re-planned from where the morning plan is. Teton winter noon look (ECMWF): clear at noon -> hidden ~18% of afternoon hours, hidden at noon -> 83-98% | done 4 Nov: retired (AF). Winters -0.40 +/- 0.32 per week vs T (53 weeks, 17 / 17; 2024-25 +0.15, 2025-26 -0.9), October -0.30 +/- 0.87 (9 weeks). Changed the afternoon on 157 of 376 days; same-morning days: clear noon +0.59 a day (32), hidden noon -0.16 (72), then the week reshuffles. Noon-clear-only re-plan: idea for fresh data (October / Faroes / live) only |
| 11 | Morning valley fog (AG, run config `fog`, builds lead + 80, v63) | Clear-forecast mornings: peaks hidden 41% at 08-09 MST vs 27-33% later (fog 21% vs 0-7%, ECMWF bin 1, n = 34). Slots before 10:00 local use odds learned from those hours alone (`replay_hidden_counts` hb 1). T's morning look already sees fog that is there; this helps the night plan pick the sunrise spot | done 4 Nov: retired (AG). Winters -0.42 +/- 0.59 per week vs T (53 weeks, 20 / 24; 2024-25 +0.4, 2025-26 -1.2), October -2.11 +/- 0.55 (7 weeks, 1 better / 6 worse). The morning look already catches fog that is there |
| 12 | Odds per place | Separate peaks-hidden odds per place | not testable yet: bench truth is one yes/no per hour for the whole range (KJAC ceiling + TetonCam), and the starred subjects are mostly placeholders aimed at the Grand. Needs per-place truth: the JHMR / Kelly / Moose cameras only have labels since 23 Oct (no winter history). Revisit after this winter |
| 13 | Practice-trip scoreboard (old vs L vs T on lived days, `live_old` / `live_L` / `live_T`) | Real weather, nothing replayed | 4 Nov: only 2 days scored so far (30-31 Oct; truth comes ~2 days late): T 6.1 points vs L 4.0 vs old 4.1. Far too few days to read; grows a day per day. `live_old` night 4 died (no answer), retried 4 Nov |

## Brute force design (B1 / B2)

- Search space per day (Teton): ~19 rated places, at most ~5 fit a winter day, start every
  15 min within each place's window, 51 weather versions.
- B1: depth-first over ordered visits with time feasibility pruning and an upper bound (the best
  still-reachable value per remaining place) for branch-and-bound. The score (mean + 0.5 CVaR over
  51 versions) is not additive, so states cannot be merged by a single number; the bound keeps
  it exact anyway. Split by first stop (and first start slot) across parallel requests, the
  `split_mc` way, so each request stays under the 2 s edge CPU limit. If that is too slow, run it
  on a GitHub Actions runner through a token-gated door (never the service-role key in the repo).
- B2: tomorrow's candidates = B1's top plans (hundreds, not 5); later days solved by B1 per
  weather version and per set of open ski outings, cached ((version, day, open outings) is a
  few thousand solves a night), then mean + 0.5 CVaR over the week.
