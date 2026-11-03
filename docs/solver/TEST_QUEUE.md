# Planner test queue (Phil, 3 Nov 2026: "run more tests we haven't done yet, constantly")

A scheduled check-in in the planning session works this list: read finished runs, record results
(planner_versions + the board), launch the next item when bench slots free up, and tell Phil only
when a result lands. Rules: every new planner version gets its letter in `planner_versions` before
it runs; compare paired per week with error bars; sum `realized` per run day (never over a
`jsonb_array_elements` join); check 'no route' nights before reading a result; keep the bench
under 6 runs at a time and never start many heavy (Faroes, polish) runs at once; watch DB size.

| # | Test | What it answers | Status |
|---|------|-----------------|--------|
| 1 | Y = T + polish 10 (`pk10_56`, 56 winters) | Does a deeper exhaustive day search earn real points, or only plan score? | done 3 Nov: retired. -1.15 +/- 0.42 per week vs T (14 better / 40 worse, both winters down): more search on the forecast's score overfits forecast noise |
| 2 | Faroes on Phil's checked rules (`foR_T`, 33 May trips) | Both Drangarnir trips planned every trip? Bøur Viewpoint used? Points vs `fo47_T` | held (status `held`) until `bf_smoke` is done, then set back to `queued` |
| 3 | Month-matched odds | Fit hidden-peak odds per month group (Oct/Nov vs Dec/Jan): needs Oct/Nov 2024-25 Previous Runs at the Teton cell + KJAC truth. Rerun October weeks: does it recover the -1.2/week? | todo |
| 4 | Missed stop recovery | Each bench week, one planned S/GOD visit "missed" (seeded): does T get it back later, and what does a miss cost? (solver-replay switch) | todo |
| 5 | Slow drives | Realized timing with drives x1.25 (winter roads): how often does a plan arrive after its light? | todo |
| 6 | Brute force, one day (B1 = planner Z1, run config `brute`, solver-replay v58) | Every candidate place, every start slot, all weather versions, for tomorrow: how far is T's day from the true best of its own score, and does the gap show up in realized points? | smoke `bf_smoke` (2 weeks, runs 4162-4163) queued 3 Nov; read stats.polish.brute_* (gain, tried, capped), then full 56 weeks as `bf56`. First read: every search hit the 1.2 s budget (capped, 30-60k nodes night, 100-200k morning), plan-score gains 0-0.8 on a third of nights; week 2025-12-01 -0.72 vs T. Not exhaustive yet: needs faster code or fan-out before bf56 means anything |
| 7 | Brute force, week (planner Z, run config `week_exact`, solver-replay v59) | The rest of the week solved exactly in each weather version inside T's Monte Carlo (every open place on any later day or none, keep-together as one, same day sizes / gear window / miss penalty as the stand-in), from the stand-in's answer | smoke `wk_smoke` (2 weeks): first try died on CPU (no answer, night 0), retried with `week_cap` 2000; read stats.mc.cands[].we (versions better, mean gain, nodes, capped), then `wk56`; then Z1 + Z together |
| 7b | Careful score (solver-replay v60), 4 versions x 56 winters vs T (`freshpol56`): AA `cl10_56` risk weight 1.0, AB `cl20_56` 2.0, AC `sh75_56` forecast trusted 75% (rest = light x usual clear-peaks share, clim_hidden 0.47 = KJAC+camera daylight 2016-2023), AD `sh50_56` 50% | Y lost points by trusting the forecast harder: does trusting it less (or weighting bad outcomes more) earn points? If one wins, rerun brute force (Z1 / Z) on that score | queued 3 Nov |
| 8 | Real trip dry run | T on exactly 29 Dec - 4 Jan in both past winters, plans in plain words for Phil to sanity-check | todo |
| 9 | Live scoreboard | T vs L vs old on the practice trips, nightly | ongoing |

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
