# "Tell T about your day" (worksheet g4): design

Status: design, waiting for Phil's OK (10 Nov 2026). Nothing built yet.
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
| `must {places}` | "want Oxbow tomorrow" | Plan the place on that day (at its best time). If it can't fit, the plan says why. | Per-day `must` (same path as fm1's required places + the `mustfix` rescue). |
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

## Later (not in the first build)

- Plan check -> note: a closure flag on the day card gets a "Tell T" button that fills the note.
- Yesterday's results in Claude's context ("you got the barns, Taggart was clouded out").
