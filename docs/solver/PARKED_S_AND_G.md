# Parked: S (ideal light per shot) and G (sunrise / sunset per shot)

Parked 19 Nov 2026 (Phil: "save all this stuff and put aside. I need to finish framing first and I don't rlly wanna mess
with T just yet"). Nothing here is live. T is unchanged.

## S = ideal light per shot (versions BI gentle / BJ strong)
- Each shot can carry a saved ideal sun position (stop page, Sun & Moon, sun button: saved with the shot, shared by every
  visit and the practice copy). S scores a starred shot 1.0 at that sun position, falling with distance (~40 deg); far
  away = 0.6 (gentle, same as plain daylight under T) or 0.3 (strong). Shots without a time plan like T.
- Code: test lane only (`solver-replay-lab`, run config `ideal` / `ideal_strong` / `ideal_set`; `replay_build` lead bits
  655360 / 1310720 / set x 2621440; random sets in `ideal_test_sets`). See CLAUDE.md "Test lane".
- Bench (lane, 18-19 Nov): configs LN_* (1-15 Nov, 5 trips) and LW_* (28 winter trips) x 9 setups (off, yours
  gentle / strong, 3 random draws x gentle / strong). Reports: `tools/ideal_light/lane_closeness.sql`, plus
  `replay_paired_visible(cfg, 'LW_off')` / `replay_paired`.
- Halfway winter read (13 trips): within 10 deg of Phil's times T 14%, gentle 38%, strong 43%; peaks-out places per trip
  gentle -0.4 +/- 0.4, strong -0.7 +/- 0.4 (random -0.2 to -1.25); T's own points -2 to -5 (old light grading).
  November: hits 19% -> 36 / 33%, peaks-out +0.6 / +0.75 (5 trips).
- What it showed: midday shots move onto their times (Blacktail, Elk Ranch, Cunningham, John Moulton); Phil's times
  bunch 11 AM - 2:10 PM, so S drops Menor's Ferry (29 visits under T -> 4-5); Oxbow and Snake River both want ~8:30 AM,
  so Snake River goes to the afternoon; long outings (Jenny Lake) need the shooting time, not mid-visit, in the report.
- Live lab copy on Teton Live (`planner_lab` id 1, name ideal_strong) switched off 19 Nov when parked.

## G = Sunrise / Sunset / Any per shot (designed, not built)
- Phil, 18 Nov: "It's really just sunrise vs sunset that I'm after"; light settings and sunrise / sunset overlap but
  don't map cleanly (sunset at a west-facing Teton view = the visible side in shadow; front light = any morning hour).
- Each SHOT gets Sunrise (first light to ~1.5 h after sunrise) / Sunset (~1.5 h before sunset through dusk) / Any;
  inside the window top marks, outside fades gently. A window, not a minute, so no midday crowding.
- Needs a model change: a stop is worth its BEST shot at that moment (Mormon Row's 10 shots: the sunrise shot at
  sunrise, the sunset shot at sunset), not only the starred shot; the plan names the shot; repeatable places may be
  visited twice; the star becomes an optional boost.
- Input: Tell T ("sunrise for the barn from the north", saved on the shot for the whole trip, a new kind of note) and a
  Sunrise / Sunset / Any chip on the shot (mockup first). Either saves on the shot (shared with every visit and copy).
- Open questions for Phil: two visits (sunrise + sunset) or one to the best; pre-fill a first guess from shot direction.
- Test the same way as S on the lane (winters, November, random tags), T untouched.

## Meanwhile (Phil, 19 Nov)
During a trip day, Phil and Claude can talk through what T is saying and change settings on the fly (tier, light,
notes, Tell T rules, Re-plan now).
