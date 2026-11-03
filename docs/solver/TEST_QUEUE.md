# Planner test queue (Phil, 3 Nov 2026: "run more tests we haven't done yet, constantly")

A scheduled check-in in the planning session works this list: read finished runs, record results
(planner_versions + the board), launch the next item when bench slots free up, and tell Phil only
when a result lands. Rules: every new planner version gets its letter in `planner_versions` before
it runs; compare paired per week with error bars; sum `realized` per run day (never over a
`jsonb_array_elements` join); check 'no route' nights before reading a result; keep the bench
under 6 runs at a time and never start many heavy (Faroes, polish) runs at once; watch DB size.

| # | Test | What it answers | Status |
|---|------|-----------------|--------|
| 1 | Y = T + polish 10 (`pk10_56`, 56 winters) | Does a deeper exhaustive day search earn real points, or only plan score? | running 3 Nov |
| 2 | Faroes on Phil's checked rules (`foR_T`, 33 May trips) | Both Drangarnir trips planned every trip? Bøur Viewpoint used? Points vs `fo47_T` | running 3 Nov |
| 3 | Month-matched odds | Fit hidden-peak odds per month group (Oct/Nov vs Dec/Jan): needs Oct/Nov 2024-25 Previous Runs at the Teton cell + KJAC truth. Rerun October weeks: does it recover the -1.2/week? | todo |
| 4 | Missed stop recovery | Each bench week, one planned S/GOD visit "missed" (seeded): does T get it back later, and what does a miss cost? (solver-replay switch) | todo |
| 5 | Slow drives | Realized timing with drives x1.25 (winter roads): how often does a plan arrive after its light? | todo |
| 6 | Brute force, one day (B1) | Every candidate place, every start slot, all weather versions, for tomorrow: how far is T's day from the true best of its own score, and does the gap show up in realized points? | todo, design below |
| 7 | Brute force, week (B2 = planner Z) | Outings to days exhaustively + B1 per day per weather version, cached | after B1 |
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
