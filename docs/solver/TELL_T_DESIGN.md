# "Tell T about your day" (worksheet g4): design

Status (11 Nov 2026): everything on Phil's list is built except "a place not on the trip" (one question for Phil
first). Nothing is live: the note-aware planner (solver-replay v100) is NOT deployed, notes are switched on for no
trip (planner_t_trips.config.tell), the app screens are on the test branch only (claude/planner-buttons-test), and
two edits to live database functions wait in docs/solver/pending/. See "Built and tested (11 Nov)" at the end.
Phil's page: the "Tell T" design artifact (link in the Planner Tracker).

## What it is

A note box on a day in the TEST app. Phil types (or dictates with the phone keyboard's mic)
something like "dinner at 7", "tired, nothing long today", "Moose-Wilson road closed till
Friday", "want Oxbow tomorrow morning". Claude reads the note and turns it into a short list of
**rules** T already knows how to follow. Phil sees the rules in plain words and taps OK; then
the affected days are re-planned. A note never edits `stops`, ticks or stop settings: it only
changes what T plans.

## Rules (the only things a note can turn into)

Each rule has a scope: `dates` (one or more trip dates) or `until` (a date) or `trip` (rest of
trip). Default = the one day the note is about.

| Rule | Example note | What T does | Where in solver-replay |
|---|---|---|---|
| `back_by {time}` | "dinner at 7" | Free stops end so the drive home lands by the time (Claude sets the time, e.g. 6:45 PM for a 7 PM dinner in town). | `day.latestMin` = min(existing, time). `winEnd` already means "back at the hotel by" (iMax uses `winMin - home`). |
| `start_after {time}` | "sleep in", "breakfast at 8" | No free stop before the time. | `day.earliestMin` = max(existing, time); also cancels the 03:45 sunrise exception that day. |
| `busy {from, to, at}` | "lunch at the inn 12-2", "massage 3-4 in town" | A fixed block; `at` = the hotel stop or a trip stop. | Added to `day.anchors` (a 0-value booking). Unknown places -> the hotel (Claude says so). |
| `skip {places}` | "skip Schwabacher", "Moose road closed" | Leave those places out on the scope's days. A place = every stop of it (Oxbow Bend has 3 entries). | Per-day `skip` set (by subject group); for scope `trip` the place also leaves the every-place/required list. |
| `must {places, at?, priority?}` | "want Oxbow tomorrow", "today I want to prioritize Mormon Row, regardless of the other stops", "Mormon Row at sunrise" | Plan the place on that day. `at` = sunrise / sunset / morning / afternoon / a clock time (else its best time). `priority` (the default for "prioritize", "regardless", "no matter what"): it outranks every other note and T's own wishes; only bookings beat it; other stops drop to make room. If it still can't fit, the plan says why. An area name ("Mormon Row" = both Moulton barns) maps to all its places. | Per-day `must` (same path as fm1's required places + the `mustfix` rescue); `at` = a time band on the visit's start slots; priority = kept first when the day is cut back. |
| `stay {place, minutes}` | "spend 3 hours at Mormon Row" | That visit lasts that long that day (instead of the stop's length). | Per-day `dur` override for that place's nodes. |
| `max_visit {minutes}` | "tired, nothing long" | No single visit longer than N min that day (long ski outings move to other days). | Per-day filter on free nodes by `dur`. |
| `max_leg {minutes}` | "stay close to town" | No drive leg over N min that day. | Per-day leg cap in the beam's extend step. |

Anything else in a note (a thought, a question, something T has no input for) comes back as
`info`: shown to Phil as "T can't use this: ..." and ignored by the planner. Claude never invents
a rule type, a place or a date: places are picked from the trip's own list (id + name), dates
from the trip's days, times are clock times in the trip's time zone.

Conflicts: rules win over T's own preferences, never over bookings (flights, gear window,
`time_locked` stops). If a day can't hold every `must` inside the rules, the plan keeps the
bookings, then the rules, and lists what it dropped (`stats.notes.broken`). Two notes on the same
day: the stricter rule wins (earliest back_by, latest start_after, union of skips).

## How long a note lasts

- Default: the day it is about ("today", "tomorrow", "Friday", or the day card it was typed on).
- "until Friday" / a closure with an end date: to that date, then it drops off by itself.
- "for the rest of the trip": only when the note says so clearly. The preview labels it
  "rest of the trip" so Phil sees it before it sticks.
- Every note can be deleted from the day card (status `cleared`); its days are re-planned.

## Flow

1. **Tell T** on a day card (today or later; past days have none) -> text box -> Send.
2. App calls solver-actions `note_read {trip_id, date, text}` -> Claude (`claude-opus-5-5`,
   effort low, structured output, `fallbacks: "default"`, logged to `claude_usage`, inside
   `CLAUDE_MONTHLY_CAP_USD`) with: the note, the day it was typed on, now (trip time), the trip's
   days and hotels, the rated places (one line each: name, length, which days they are on), and
   today's T plan. Returns `{rules[], info[], say}` where `say` is the plain-words preview.
   Nothing is saved yet (row `t_notes` status `draft`).
3. Preview: "T will: Be back at Wyoming Inn by 6:45 PM (Tue 29 Dec only)". Buttons **Looks
   right** / **Change note**.
4. Looks right -> `note_save {id}` (status `active`) -> re-plan:
   - the note's day is today: the Re-plan now path (`planner_t_now`), rest of today;
   - a later day with a forecast: a new `note` step (the `now` machinery for another day:
     rebuilds that day's plan with the rules, publishes `T: re-plan (your note)`, never records
     the night or touches the run's state);
   - beyond the forecast: the week draft (`planner_t_replan`).
   Every later scheduled step (evening plan, morning, camera look, re-plan now, week draft)
   reads the active notes by itself.
5. Day card shows "Your notes" (each: the note, its rules in one line, how long, x to delete)
   and the plan's line "Plan follows your notes" or "Couldn't: Oxbow didn't fit by 6:45 PM".

## Data

`t_notes` (id, trip_id, created_at, typed_on date, text, status draft|active|cleared|expired,
rules jsonb, info jsonb, say text, from_date, to_date (null = rest of trip), cost_usd,
saved_at, cleared_at; `app_read` select policy). Writes only through solver-actions (the app's
key cannot write it). Training copies: notes belong to the trip they were typed on (not synced).

solver-replay loads the trip's active notes once per request and turns them into per-day
`latestMin / earliestMin / anchors / skip / must / maxVisit / maxLeg` (place -> all its stops by
subject group). Run config `notes` (bench) supplies fixture notes instead, so the bench can test
rules without a trip.

## Testing before Phil gets it

1. **No-notes identity:** with no notes, every plan is byte-identical to today's (Teton +
   Faroes bench weeks and the live runs' last nights). Required: 100%.
2. **Reading test:** ~40 sample notes written beforehand with the right answer (dinner / sleep
   in / tired / closures with and without dates / "the barns" / "tomorrow" late at night /
   two days at once / nonsense / a note about a past day / a place not on the trip). Pass mark:
   38 of 40 exactly right and no wrong place or date in the other 2. Cost under $1.
3. **Rule test on the bench:** each rule type on the 56 Teton weeks (fixture notes on random
   days): automatic checks that every plan obeys (no free stop past back_by, nothing before
   start_after, skipped places absent, must places present or listed as broken, no visit over
   max_visit, no leg over max_leg, bookings untouched). Required: zero violations, no
   "no route" nights added.
4. **App test:** emulator checks for the box, preview, save, notes list, delete, offline.
5. **Live trial on Teton Live** for a few days with real notes, then ask Phil before it goes to
   his phone.

## More ideas (10 Nov 2026, Phil asked for a wider look; staged, none approved yet)

**Stage 1 extras (how the feature behaves; no new planner rules):**
- **Ask, don't guess:** when a note is unclear ("the barns" = which? "Friday" = which Friday?
  "early" = what time?), Claude returns one question with 2-3 tap answers instead of a rule.
- **Quick buttons** under the box, no typing and no Claude call (gloves, cold): Sleep in, Easy day,
  Day off, Back by..., Skip a place..., Want a place.... Each makes the same rule a note would.
- **Notes ahead of time + trip rules:** a note can be about any trip day, typed weeks before
  ("New Year's Eve dinner at 8", "sleep in on the 1st"). Rest-of-trip notes ("never before
  6:30", "always back by 6") are listed as "Trip rules" in the Planner's Setup tab.
- **No signal:** the note is kept on the phone and sent when signal returns (the card says
  "waiting for signal"); the last plan stays on screen.

**Stage 2 (more rules; each small, each gets the bench rule test):**
- `max_stops {n}` / easy day ("easy day", "only 3 stops") and `day_off` (nothing planned, or
  "afternoon off" = back_by).
- `slow_roads {factor}` ("roads are icy", "snowing"): every drive that day x1.25 / x1.5
  (the bench already replays plans with slower drives: `slow_drive`; this plans with them).
- `no_gear` ("no skis today", "returning the skis early"): ski outings off that day, or the
  gear window moved.
- `order` ("start at the barns", "end at Snake River Overlook", "Oxbow before Mormon Row"):
  first / last / before.
- `optional {places}` ("don't make me do Taggart if the weather's bad"): the place loses its
  every-place requirement, so T only plans it on a good chance.
- `only_top {tier}` ("just the best spots today"): only GOD / S places that day.

**Stage 3 (bigger; each is its own build and test):**
- **Evening recap:** one box in the evening: "nailed the barns, Oxbow was clouded out, sleep
  in tomorrow" -> proposed ticks (Nailed it / Go back for better / Missed it) plus tomorrow's
  rules, all shown for one OK before the 8:45 PM plan. (Changes "a note never touches ticks":
  it would, but only after Phil confirms each one.)
- **Where I really am:** "I'm at Dornans", "running an hour late", "staying here 30 more
  minutes" -> Re-plan now from Phil's real place and time, not where the plan says he is.
- **Your eyes as a camera:** "peaks are out" / "socked in here" counts as the look for
  Re-plan now (Phil outvotes the cameras).
- **A place not on the trip:** "sleigh ride at the Elk Refuge at 2" -> needs a location
  lookup and new drive times (Google); shown on the map for Phil to confirm.
- **Ask T:** questions that change nothing: "what if we skip Jenny Lake?", "why is Oxbow on
  Thursday?", "best day for Mormon Row?".
- **Plan check -> note:** a closure or avalanche flag gets a "Tell T" button that fills the note.

**Looked at, not worth building:** a per-day risk dial ("gamble today" / "play it safe": the
ablation showed the risk setting doesn't change plans); per-day light wishes (that is the
stop's own Settings tab).


## Decided 10 Nov 2026 (Phil): everything, tested before live

Still to build, all of it: max_stops / easy day; slow_roads; no_gear / gear window change; order (first, last,
before); optional (only on a good chance); only_top; arrive_by per stop; cost warning in the preview (what a note
makes T give up, before the OK); evening recap (ticks after one OK); where I really am / running late / staying
longer; **weather reports from the field** (Phil, 10 Nov: "I wanna be able to give weather reports in the field
too": "peaks are out", "socked in at Jenny Lake", "fog in the valley": counts as the look for the rest of today's
plan, above the cameras, and is kept as truth for the day check); a place not on the trip; Ask T; plan check ->
note button; quick buttons, trip rules list, no-signal queue in the app.

Test gaps to close before live (my own review, 10 Nov): rule tests ran on 8 Teton weeks with hand-picked days,
not all 56 with random notes; nothing on the Faroes trip; every bench run was on the local runner (no 2 s CPU
limit), so the edge function's limit is untested with notes; the live path (save, re-plan, delete, a note typed
mid-day) is untested; the checker was written with the rules (an independent SQL check is still to do); the
reading test is one trip, 60 notes.

## Built and tested (11 Nov 2026)

**What a note can be now**
- A rule for a day or the rest of the trip: back_by, leave_after, busy, skip, must (+ time band), max_visit, max_leg,
  stay, day_off, max_stops, slow_roads, no_gear, gear_to / gear_from, first, last, before, optional, only_top,
  arrive_by. "Easy day" = at most 3 stops, none over 2 hours.
- Word from the field (today only, used once): where Phil is (a trip place or the hotel), how late he is, how much
  longer he is staying, what he sees of the peaks (out / hidden / in and out). T re-plans the rest of today from it
  (planner_t_now_here -> the Re-plan now path with `here`); a sky report is kept in t_reports and, once the pending
  t_truth edit is applied, goes above the cameras for that hour (the look for the re-plan, the truth for the day check).
- An evening recap: "nailed the barns, Oxbow was clouded out" -> proposed ticks, set only after the OK, never lowered
  ("missed" changes nothing).
- A question (changes nothing): why a place is on a day, the best day for a place, what a change would cost ("what
  if we skip Jenny Lake?"). Answers are put together from T's stored plans and the forecast grid, not written by Claude.
- Before the OK, a note that touches later days shows what it would make T give up (the rest of the trip planned
  with and without it; only what the note itself costs).

**Rules the planner keeps under notes**
- Bookings first, then notes, then T's own wishes. A wanted place brings its keep-together partner (both Moulton
  barns); a general note that takes one of a pair out takes the other out too; a partner skipped by name leaves the
  other free to go alone. A note is about its calendar day (matters in the far north). A wanted place that cannot
  fit is said, with the reason where it is plain (needs the rental gear before pickup).

**Tests** (tools/tell_t)
- No notes = identical plans: 56 of 56 nights on six code versions (latest v99; v100 rerun pending at the time of writing).
- Random notes, 5 rules a week: 56 Teton weeks + 14 more + 9 Faroes periods, judged by the planner's own check and by
  an independent checker (check_runs.py: by stop name, stored visits, drive table, keep-together). Found and fixed on
  the way: a Faroes "by 11:00" met the night before (v98); one night with no plan and three nights with one barn
  planned alone (v99).
- Pair fixture (tellP1): wanted barn + max stops, nothing-long, day off + wanted barn, skip one + want the other.
- The 2-second edge limit: a deployed test copy ran 28 weeks with and without notes, same timing.
- Reading: 130 notes with answers written beforehand (main 40, held-out 20, easy 6, more 12, Faroes 20, field /
  recap / questions 32): 129-130 right on the last pass, never a wrong day or place.
- Flow test (flow_test.py, 27 checks on the test-bed trip): draft -> OK -> ticks / report / re-plan request -> clear,
  questions, what-if, refusals; every row it makes is removed.
- "Where I really am": dry Re-plan now runs against a past Teton Live day (late, at another place, staying longer,
  an honest "can't fit" when a booking would be missed); nothing published.
- App: emulator checks tell-* on the test branch (the test build says notes are on, forces dry reads, blocks saves).

**Not tested until Phil says go** (each needs a deploy or a live switch)
- The deployed planner following a real saved note end to end on Teton Live (type, preview, OK, re-plan, delete).
- A field weather report changing a live re-plan (needs docs/solver/pending/20261111060000_t_field_reports_live.sql).

**Going live, in order, each on Phil's OK:** 1. deploy solver-replay v100; 2. apply the pending SQL; 3. switch
`tell` on for Teton Live only and run real notes for a few days; 4. merge the app screens into the work branch (TEST
app); 5. later, the real trips.
