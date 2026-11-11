// T-NOTES logic: what Claude is told, what it may answer, and how its answer becomes planner rules and the
// plain-words lines Phil sees. No network here, so the tests can run it as is.

export const MODEL = 'claude-opus-5-5';

export type Place = { name: string; ids: string[]; minutes: number[]; days: string[]; tier: string };
export type TripCtx = {
  tripId: string; name: string; tz: string; dates: string[]; places: Place[];
  bookings: { name: string; date: string; time: string }[]; hotels: { name: string; from: string; to: string }[];
  today: string; nowClock: string; sun?: Record<string, { first_light: string; sunrise: string; sunset: string }>;
  // Rental gear (skis, snowshoes), when the trip has it: the places that need it and when it is picked up / returned.
  gear?: { places: string[]; pickup?: { date: string; time: string }; ret?: { date: string; time: string } };
};
// A rule as the planner reads it (solver-replay NoteRule): stop ids, HH:MM in the trip's time zone, dates.
export type Rule = { type: string; dates?: string[]; from_date?: string; to_date?: null; time?: string; from?: string; to?: string;
  at?: string | null; label?: string; stops?: string[]; places?: string[]; then?: string[]; then_places?: string[]; minutes?: number; count?: number; factor?: number; tier?: string; why?: string };

const TYPES = ['back_by', 'leave_after', 'busy', 'skip', 'must', 'max_visit', 'max_leg', 'stay', 'day_off', 'max_stops',
  'slow_roads', 'no_gear', 'gear_to', 'gear_from', 'first', 'last', 'before', 'optional', 'only_top', 'arrive_by'] as const;

export const SYSTEM = `You read a short note from a landscape photographer on a trip and turn it into rules for his day planner ("T"). T plans each day's photo stops around weather and light. It follows only the rule types below; you never plan the day yourself.

Rule types (use only these):
- back_by {time}: be back at the hotel by this time. When he gives the time to be back ("back by 6", "back by 6 for dinner"), use exactly that time. Only when he gives the time of the thing itself ("dinner at 7", "a 6pm reservation") work back from it: about 20 minutes before, for getting ready and the drive.
- leave_after {time}: do not leave the hotel before this time. "Sleep in" with no time = 09:00; "sleep in till 9" = 09:00; "breakfast at 8" = leaving about 45 minutes after it starts; "nothing before 10" = 10:00.
- busy {from, to, at_place, label}: a block of time that is taken (lunch, a call, a booking). at_place is one of the trip's places if it happens there, else null (the hotel). label is 2-4 words, e.g. "Lunch at the inn".
- skip {places}: leave these places out.
- must {places, from, to}: he wants this place on that day. from / to bound when the visit STARTS, only if he says when: "at sunrise" = from 45 minutes before sunrise to sunrise; "at sunset" = from 90 to 30 minutes before sunset; "morning" = from first light to 11:00; "afternoon" = from 12:00; "around 3" = 14:30 to 15:30. With no time said, from and to are null (T picks the best light).
- max_visit {minutes}: no single stop longer than this ("tired", "nothing long", "easy on the legs" = 90 unless he gives a number).
- max_leg {minutes}: no drive longer than this ("stay close to town" = 30 unless he gives a number).
- stay {places, minutes}: how long to stay at a place ("spend 3 hours at ...").
- max_stops {count}: at most this many stops that day ("only 3 stops", "just a couple of stops" = 2). Places he asks for the same day count first.
- "Easy day" / "light day" / "take it easy" with nothing more exact = two rules: max_stops 3 and max_visit 120.
- slow_roads {factor}: the roads are slow, so every drive that day takes longer. Only when he talks about the roads or the driving; a remark about the weather alone ("it's snowing hard", "windy", "cloudy") is not a rule and goes in cant_use. "Icy", "snowy", "slow going" = 1.25; "really bad", "chains", "crawling" = 1.5.
- no_gear: no ski or snowshoe outings that day ("no skis today", "legs are done, no skiing"). Only if the trip has rental gear.
- gear_to {time} / gear_from {time}: the rental gear is returned / picked up at a different day or time. dates = that one day; time = when he is at the shop. Only if the trip has rental gear.
- first {places} / last {places}: start / end the day at that place ("start at the barns", "finish at Snake River Overlook"). One place each. It is wanted that day, so do not add a must for it as well. "First thing" with a time of day in mind is a must with a time, not this.
- before {places, then_places}: go to places before then_places if both are on the day ("Oxbow before Mormon Row").
- optional {places}: only plan it when its chance of a good shot is good; never force it ("only if the weather's good", "don't make me do X in bad weather"). Usually rest of trip unless he names a day.
- only_top {tier}: only his best places that day. tier is the lowest tier allowed: "S" (S and GOD, the usual meaning of "just the best spots") or "GOD" (only the very best) or "A".
- arrive_by {places, time}: be at that place no later than this time whenever it is planned ("get to Taggart by 8", "lot fills by 9"). Usually rest of trip unless he names a day.
- day_off: nothing planned that day ("day off", "rest day", "staying in today", someone is sick). Bookings stay. Never use a busy block for a whole day.

Days:
- dates lists every trip day the rule covers, from the list of trip days you are given. Never a day before today.
- No day words in the note: the day the note was typed on.
- "today", "tonight", "this afternoon": today's date if the trip is under way, else the day the note was typed on. "tomorrow": the day after that. Between midnight and 4 AM "tomorrow" is unclear (after this sleep, or the day after?): ask which day.
- A weekday or a date ("Friday", "the 31st"): that trip day. "until Friday" / "through Friday": every day from the note's day to that day.
- rest_of_trip is true ONLY when the note clearly says so ("for the rest of the trip", "from now on", "never", "always", "done with it"). Then dates holds the first day it applies: the note's day, unless he names a later day to start from ("from Friday on"). A closure with no end date is NOT rest of trip: use the note's day only, and say in cant_use that he should repeat it if it is still closed.

Places:
- Use only the trip's place names, exactly as given. An area or nickname that clearly means listed places maps to all of them ("the barns" or "Mormon Row" = both Moulton barns; "the overlook" is not clear if several overlooks are listed).
- "Skip X" / "not doing X" with no day words: if X is on the note's day in the places list, skip it that day. If X is only on other days, ask whether he means the whole trip or which day (do not pick rest of trip yourself). This asking is only for skips: every other rule with no day words is for the note's day.
- Never work out a place from a description alone ("the cliffs", "the waterfall", "the lake"): use it only if exactly one listed place has that word in its name, else ask or leave it in cant_use.
- A road or trail closure: skip the listed places you are confident need that road or trail; if you are not confident which places it affects, ask.

Right now (now): only when the trip is under way. These are about this very moment, whichever day card they were typed on; they are not rules: T re-plans the rest of today from them once. Leave now null otherwise.
- here_place: where he says he is ("I'm at Oxbow", "still at the barns", "back at the hotel" = "hotel"). A listed place or "hotel"; a place that is not listed goes in cant_use.
- late_minutes: how far behind the plan he is ("running an hour late" = 60, "half an hour behind" = 30, "a bit behind" = 20).
- stay_minutes: how much longer he will stay where he is ("staying another half hour" = 30, "give me 20 more minutes here" = 20).
- sky: what he himself sees of the mountains right now: "out" (he can see the peaks: "peaks are out", "it's cleared", "totally clear here"), "hidden" (he cannot: "socked in", "clouded over", "can't see a thing", "fog in the valley", "snowing, no view"), "mixed" ("in and out", "half covered"). Only what he reports seeing now. A forecast, a hope or a guess ("looks like it might clear", "supposed to snow later") is not a report: cant_use. A remark about past light ("the light was amazing yesterday") is not a report either.
- A note can hold both now and rules ("socked in here, skip Oxbow today").

What happened (recap): when he reports how a place went, today or earlier on the trip, one item per place: result "nailed" (he got the shot he wanted: "nailed it", "got a great one", "got the shot"), "got" (he got something but wants better: "got it but flat light", "ok, would go back"), "missed" (no shot: "clouded out", "missed it", "didn't get it", "skipped it"). Only listed places, only results he reports (never a plan or a wish). A recap is not a rule: do not add a skip for a place he nailed (T stops planning it by itself). "Done with X for the rest of the trip" with no word on how it went is a skip, not a recap. Praise for the light or the day with no result ("the light was amazing at Oxbow") is not a recap: cant_use.

Questions (question): when the note asks T something instead of telling it ("what if we skip Jenny Lake?", "why is Oxbow on Thursday?", "what's the best day for Mormon Row?", "when should I do the barns?"), fill question and leave now and recap empty. kind: "what_if" (what would happen if...: then rules holds the "if" as rules, exactly as if he had told T to do it, and nothing else), "why" (why a place is where it is on the plan), "best_day" (which day or time suits a place), "other" (anything else: T cannot answer it yet). places = the listed places the question is about. For why, best_day and other, rules stays empty.

When to ask instead of guessing: if the note could mean two different things that would change the plan (which place, which day, what time), return one short question in ask with 2-4 short answer options, and no rules. Do not ask when a sensible default above covers it.

Anything in the note T cannot use (a thought, a forecast, a wish no rule covers) goes in cant_use as a short plain sentence each. If the whole note is like that, return no rules.

Every rule needs why: a few plain words tying it to the note ("Dinner at 7, 20 min to get ready"). Times are 24-hour HH:MM in the trip's local time. Fields that do not apply are null or empty.`;

const NULLSTR = { type: ['string', 'null'] };
export function buildSchema(ctx: TripCtx) {
  const places = ctx.places.map(p => p.name);
  return {
    type: 'object', additionalProperties: false, required: ['ask', 'rules', 'now', 'recap', 'question', 'cant_use'],
    properties: {
      ask: { anyOf: [{ type: 'null' }, { type: 'object', additionalProperties: false, required: ['question', 'options'],
        properties: { question: { type: 'string' }, options: { type: 'array', items: { type: 'string' } } } }] },
      rules: { type: 'array', items: { type: 'object', additionalProperties: false,
        required: ['type', 'dates', 'rest_of_trip', 'time', 'from', 'to', 'places', 'then_places', 'at_place', 'minutes', 'count', 'factor', 'tier', 'label', 'why'],
        properties: {
          type: { type: 'string', enum: [...TYPES] },
          dates: { type: 'array', items: { type: 'string', enum: ctx.dates } },
          rest_of_trip: { type: 'boolean' },
          time: NULLSTR, from: NULLSTR, to: NULLSTR,
          places: { type: 'array', items: { type: 'string', enum: places } },
          then_places: { type: 'array', items: { type: 'string', enum: places } },
          factor: { type: ['number', 'null'] }, tier: { type: ['string', 'null'] },
          at_place: NULLSTR, minutes: { type: ['integer', 'null'] }, count: { type: ['integer', 'null'] }, label: NULLSTR, why: { type: 'string' },
        } } },
      now: { anyOf: [{ type: 'null' }, { type: 'object', additionalProperties: false, required: ['here_place', 'late_minutes', 'stay_minutes', 'sky', 'why'],
        properties: {
          here_place: { anyOf: [{ type: 'null' }, { type: 'string', enum: [...places, 'hotel'] }] },
          late_minutes: { type: ['integer', 'null'] }, stay_minutes: { type: ['integer', 'null'] },
          sky: { anyOf: [{ type: 'null' }, { type: 'string', enum: ['out', 'hidden', 'mixed'] }] }, why: { type: 'string' },
        } }] },
      recap: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['place', 'result'],
        properties: { place: { type: 'string', enum: places }, result: { type: 'string', enum: ['nailed', 'got', 'missed'] } } } },
      question: { anyOf: [{ type: 'null' }, { type: 'object', additionalProperties: false, required: ['kind', 'places', 'text'],
        properties: { kind: { type: 'string', enum: ['what_if', 'why', 'best_day', 'other'] }, places: { type: 'array', items: { type: 'string', enum: places } }, text: { type: 'string' } } }] },
      cant_use: { type: 'array', items: { type: 'string' } },
    },
  };
}

const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const dayWords = (d: string) => { const x = new Date(`${d}T12:00:00Z`); return `${WD[x.getUTCDay()]} ${x.getUTCDate()} ${MO[x.getUTCMonth()]}`; };
export const clock12 = (t: string) => { const [h, m] = t.split(':').map(Number); return `${((h + 11) % 12) + 1}${m ? ':' + String(m).padStart(2, '0') : ''} ${h < 12 ? 'AM' : 'PM'}`; };
const mins = (n: number) => n < 60 ? `${n} minutes` : n % 60 === 0 ? `${n / 60} hour${n === 60 ? '' : 's'}` : n % 60 === 30 ? `${Math.floor(n / 60)}½ hours` : `${Math.floor(n / 60)} h ${n % 60} min`;

export function userText(ctx: TripCtx, date: string, text: string, answer: { question: string; choice: string } | null) {
  const under = ctx.today >= ctx.dates[0] && ctx.today <= ctx.dates[ctx.dates.length - 1];
  const L: string[] = [];
  L.push(`Trip: ${ctx.name}. Time zone ${ctx.tz}.`);
  L.push(under ? `Right now it is ${dayWords(ctx.today)} (${ctx.today}), ${ctx.nowClock}. The trip is under way.`
               : `Right now it is ${ctx.today}. The trip has not started (he is planning ahead).`);
  L.push(`The note was typed on the day card for ${dayWords(date)} (${date}).`);
  L.push('', 'Trip days:');
  for (const d of ctx.dates) {
    const h = ctx.hotels.find(a => a.from <= d && d < a.to)?.name, s = ctx.sun?.[d];
    const bk = ctx.bookings.filter(b => b.date === d).map(b => `${b.name} ${b.time}`.trim());
    L.push(`- ${d} ${dayWords(d)}${d < ctx.today ? ' (past)' : ''}${s ? `: first light ${s.first_light}, sunrise ${s.sunrise}, sunset ${s.sunset}` : ''}${h ? `; sleeps at ${h}` : ''}${bk.length ? `; fixed: ${bk.join(', ')}` : ''}`);
  }
  L.push('', 'Places (name | usual visit | days it is on now):');
  for (const p of ctx.places) {
    const lo = Math.min(...p.minutes), hi = Math.max(...p.minutes);
    L.push(`- ${p.name} | ${lo === hi ? lo : `${lo}-${hi}`} min | ${[...new Set(p.days)].sort().map(dayWords).join(', ')}`);
  }
  if (ctx.gear?.places.length) L.push('', `Rental gear (skis / snowshoes): picked up ${ctx.gear.pickup ? `${dayWords(ctx.gear.pickup.date)} ${ctx.gear.pickup.time}` : 'on the trip'}, returned ${ctx.gear.ret ? `${dayWords(ctx.gear.ret.date)} ${ctx.gear.ret.time}` : 'on the trip'}. Places that need it: ${ctx.gear.places.join(', ')}.`);
  else L.push('', 'This trip has no rental gear: do not use no_gear, gear_to or gear_from.');
  L.push('', `Note: "${text}"`);
  if (answer) L.push('', `You asked: "${answer.question}". He answered: "${answer.choice}". Do not ask again; use the answer.`);
  return L.join('\n');
}

const HHMM = /^([01]?\d|2[0-3]):[0-5]\d$/;
const pad = (t: string) => { const [h, m] = t.split(':'); return `${h.padStart(2, '0')}:${m}`; };
const hm = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));

// Claude's answer -> planner rules. Anything malformed is dropped and said so (never guessed into shape).
export function toRules(ctx: TripCtx, date: string, raw: any[]): { rules: Rule[]; cant: string[] } {
  const rules: Rule[] = [], cant: string[] = [];
  const first = ctx.today > ctx.dates[0] ? ctx.today : ctx.dates[0];
  for (const r of raw ?? []) {
    if (!TYPES.includes(r?.type)) { cant.push('One part of the note was not something T can follow.'); continue; }
    let dates: string[] = [...new Set(((r.dates ?? []) as string[]).filter(d => ctx.dates.includes(d)))].sort();
    if (!dates.length) dates = [date];
    const past = dates.filter(d => d < first);
    dates = dates.filter(d => d >= first);
    if (!dates.length) { cant.push(`${dayWords(past[0])} is already over, so T can't change it.`); continue; }
    const t = (x: unknown) => (typeof x === 'string' && HHMM.test(x.trim()) ? pad(x.trim()) : null);
    const names = [...new Set(((r.places ?? []) as string[]).filter(n => ctx.places.some(p => p.name === n)))];
    const stops = names.flatMap(n => ctx.places.find(p => p.name === n)!.ids);
    const n = Number.isFinite(Number(r.minutes)) && r.minutes != null ? Math.round(Number(r.minutes)) : null;
    const scope = r.rest_of_trip === true ? { from_date: dates[0], to_date: null } : { dates };
    const why = typeof r.why === 'string' ? r.why.slice(0, 120) : undefined;
    const bad = (what: string) => cant.push(`T could not use "${what}" from the note.`);
    switch (r.type) {
      case 'back_by': case 'leave_after': { const x = t(r.time); if (!x) { bad(r.type === 'back_by' ? 'back by' : 'leave after'); break; } rules.push({ type: r.type, time: x, ...scope, why }); break; }
      case 'busy': {
        const a = t(r.from), b = t(r.to); if (!a || !b || b <= a || hm(b) - hm(a) > 600) { bad('the busy time'); break; }
        const at = ctx.places.find(p => p.name === r.at_place)?.ids[0] ?? null;
        rules.push({ type: 'busy', from: a, to: b, at, label: (typeof r.label === 'string' && r.label.trim() ? r.label.trim().slice(0, 40) : 'Busy') + ' (your note)', ...scope, why }); break;
      }
      case 'skip': if (!stops.length) { bad('the place to skip'); break; } rules.push({ type: 'skip', stops, places: names, ...scope, why }); break;
      case 'must': {
        if (!stops.length) { bad('the place you want'); break; }
        const a = t(r.from), b = t(r.to);
        // One rule per place, so each is wanted on its own (the planner counts a place once).
        for (const nm of names) rules.push({ type: 'must', stops: ctx.places.find(p => p.name === nm)!.ids, places: [nm], ...(a ? { from: a } : {}), ...(b && (!a || b >= a) ? { to: b } : {}), ...scope, why });
        break;
      }
      case 'max_visit': if (!n || n < 15 || n > 600) { bad('the longest stop'); break; } rules.push({ type: 'max_visit', minutes: n, ...scope, why }); break;
      case 'max_leg': if (!n || n < 5 || n > 240) { bad('the longest drive'); break; } rules.push({ type: 'max_leg', minutes: n, ...scope, why }); break;
      case 'day_off': rules.push({ type: 'day_off', ...scope, why }); break;
      case 'slow_roads': { const f = Number(r.factor); if (!(f > 1 && f <= 2)) { bad('how slow the roads are'); break; } rules.push({ type: 'slow_roads', factor: Math.round(f * 100) / 100, ...scope, why }); break; }
      case 'no_gear': if (!ctx.gear?.places.length) { bad('the rental gear (this trip has none)'); break; } rules.push({ type: 'no_gear', ...scope, why }); break;
      case 'gear_to': case 'gear_from': { const x = t(r.time); if (!ctx.gear?.places.length || !x) { bad('the gear time'); break; } rules.push({ type: r.type, time: x, dates: [dates[0]], why }); break; }
      case 'first': case 'last': if (!names.length) { bad(r.type === 'first' ? 'where to start' : 'where to end'); break; } rules.push({ type: r.type, stops: ctx.places.find(p => p.name === names[0])!.ids, places: [names[0]], ...scope, why }); break;
      case 'before': {
        const tn = [...new Set(((r.then_places ?? []) as string[]).filter(n => ctx.places.some(p => p.name === n) && !names.includes(n)))];
        if (!names.length || !tn.length) { bad('the order of the places'); break; }
        rules.push({ type: 'before', stops, places: names, then: tn.flatMap(n => ctx.places.find(p => p.name === n)!.ids), then_places: tn, ...scope, why }); break;
      }
      case 'optional': if (!stops.length) { bad('the place to keep optional'); break; } rules.push({ type: 'optional', stops, places: names, ...scope, why }); break;
      case 'only_top': { const tr = ['GOD', 'S', 'A'].includes(String(r.tier)) ? String(r.tier) : 'S'; rules.push({ type: 'only_top', tier: tr, ...scope, why }); break; }
      case 'arrive_by': { const x = t(r.time); if (!stops.length || !x) { bad('the time to be there by'); break; } rules.push({ type: 'arrive_by', stops, places: names, time: x, ...scope, why }); break; }
      case 'max_stops': { const c = Number.isFinite(Number(r.count)) && r.count != null ? Math.round(Number(r.count)) : null; if (!c || c < 1 || c > 12) { bad('how many stops'); break; } rules.push({ type: 'max_stops', count: c, ...scope, why }); break; }
      case 'stay': if (!stops.length || !n || n < 15 || n > 600) { bad('how long to stay'); break; } rules.push({ type: 'stay', stops, places: names, minutes: n, ...scope, why }); break;
    }
  }
  return { rules, cant };
}

// The lines Phil sees before his OK: built from the rules themselves, so the preview is what T will do.
export function sayLines(ctx: TripCtx, rules: Rule[]): { text: string; when: string; why?: string }[] {
  const list = (a: string[]) => a.length <= 1 ? (a[0] ?? '') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`;
  const when = (r: Rule) => {
    if (!r.dates) return `rest of the trip, from ${dayWords(r.from_date!)}`;
    if (r.dates.length === 1) return r.dates[0] === ctx.today ? 'today only' : `${dayWords(r.dates[0])} only`;
    const run = r.dates.every((d, i) => i === 0 || ctx.dates.indexOf(d) === ctx.dates.indexOf(r.dates![i - 1]) + 1);
    return run ? `${dayWords(r.dates[0])} to ${dayWords(r.dates[r.dates.length - 1])}` : list(r.dates.map(dayWords));
  };
  const hotelOn = (r: Rule) => { const d = r.dates?.[0] ?? r.from_date!; return ctx.hotels.find(a => a.from <= d && d < a.to)?.name ?? 'the hotel'; };
  return rules.map(r => {
    const p = list(r.places ?? []);
    const text = r.type === 'back_by' ? `Be back at ${hotelOn(r)} by ${clock12(r.time!)}`
      : r.type === 'leave_after' ? `Leave no earlier than ${clock12(r.time!)}`
      : r.type === 'busy' ? `Keep ${clock12(r.from!)} to ${clock12(r.to!)} free: ${r.label!.replace(/ \(your note\)$/, '')}`
      : r.type === 'skip' ? `Leave out ${p}`
      : r.type === 'must' ? `Put ${p} on the plan${r.from && r.to ? `, starting between ${clock12(r.from)} and ${clock12(r.to)}` : r.from ? `, starting after ${clock12(r.from)}` : r.to ? `, starting by ${clock12(r.to)}` : ''}. Only your bookings come first`
      : r.type === 'max_visit' ? `Keep every stop under ${mins(r.minutes!)}`
      : r.type === 'max_leg' ? `No drive over ${mins(r.minutes!)}`
      : r.type === 'day_off' ? 'Plan nothing: a day off (your bookings stay)'
      : r.type === 'slow_roads' ? `Plan every drive ${Math.round((r.factor! - 1) * 100)}% longer`
      : r.type === 'no_gear' ? 'No ski or snowshoe outings'
      : r.type === 'gear_to' ? `Return the rental gear at ${clock12(r.time!)}`
      : r.type === 'gear_from' ? `Pick up the rental gear at ${clock12(r.time!)}`
      : r.type === 'first' ? `Start the day at ${p}`
      : r.type === 'last' ? `End the day at ${p}`
      : r.type === 'before' ? `${p} before ${list(r.then_places ?? [])}`
      : r.type === 'optional' ? `Only plan ${p} when its chance is good (never forced)`
      : r.type === 'only_top' ? `Only your top spots (${r.tier === 'GOD' ? 'GOD' : r.tier === 'A' ? 'A and better' : 'S and GOD'})`
      : r.type === 'arrive_by' ? `Be at ${p} by ${clock12(r.time!)}`
      : r.type === 'max_stops' ? `At most ${r.count} stop${r.count === 1 ? '' : 's'}`
      : `Stay ${mins(r.minutes!)} at ${p}`;
    return { text, when: when(r), ...(r.why ? { why: r.why } : {}) };
  });
}

// What a note says about right now (where Phil is, how late, what he sees), checked. Only on the day itself.
export type NowWord = { here?: { place: string; stop_id?: string; hotel?: boolean }; late_min?: number; stay_min?: number; sky?: 'out' | 'hidden' | 'mixed'; why?: string };
// deno-lint-ignore no-explicit-any
export function toNow(ctx: TripCtx, date: string, raw: any): { now: NowWord | null; cant: string[] } {
  if (!raw || typeof raw !== 'object') return { now: null, cant: [] };
  const int = (x: unknown, lo: number, hi: number) => { const v = Math.round(Number(x)); return x != null && Number.isFinite(v) && v >= lo && v <= hi ? v : null; };
  const out: NowWord = {};
  if (raw.here_place === 'hotel') out.here = { place: 'the hotel', hotel: true };
  else { const p = ctx.places.find(p => p.name === raw.here_place); if (p) out.here = { place: p.name, stop_id: p.ids[Math.max(0, p.days.indexOf(date))] }; }
  const late = int(raw.late_minutes, 5, 360), stay = int(raw.stay_minutes, 5, 600);
  if (late) out.late_min = late;
  if (stay) out.stay_min = stay;
  if (['out', 'hidden', 'mixed'].includes(raw.sky)) out.sky = raw.sky;
  if (!out.here && !out.late_min && !out.stay_min && !out.sky) return { now: null, cant: [] };
  const under = ctx.today >= ctx.dates[0] && ctx.today <= ctx.dates[ctx.dates.length - 1];
  // About this moment, whichever day card it was typed on (the preview says "right now"); only while the trip is on.
  if (!under) return { now: null, cant: ['T can only use where you are, or what you see, while the trip is on.'] };
  if (typeof raw.why === 'string') out.why = raw.why.slice(0, 120);
  return { now: out, cant: [] };
}
export function nowLines(now: NowWord | null): { text: string; when: string; why?: string }[] {
  if (!now) return [];
  const L: string[] = [];
  if (now.here) L.push(`Re-plan the rest of today from ${now.here.place}${now.stay_min ? `, leaving in ${mins(now.stay_min)}` : ''}`);
  else if (now.stay_min) L.push(`Stay where you are ${mins(now.stay_min)} longer, then re-plan the rest of today`);
  if (now.late_min && !now.here) L.push(`Push the rest of today back: you are about ${mins(now.late_min)} behind`);
  if (now.sky === 'out') L.push('Count the peaks as out right now (your word beats the cameras) and re-plan the rest of today');
  if (now.sky === 'hidden') L.push('Count the peaks as hidden right now (your word beats the cameras) and re-plan the rest of today');
  if (now.sky === 'mixed') L.push('Save your report (peaks in and out). T keeps going by the cameras');
  return L.map(text => ({ text, when: 'right now', ...(now.why ? { why: now.why } : {}) }));
}

// How places went (the evening recap): proposed ticks, set only after Phil's OK. One per place, the last word wins.
export type Recap = { place: string; ids: string[]; days: string[]; result: 'nailed' | 'got' | 'missed' };
// deno-lint-ignore no-explicit-any
export function toRecap(ctx: TripCtx, date: string, raw: any[]): { recap: Recap[]; cant: string[] } {
  const m = new Map<string, Recap>();
  for (const r of raw ?? []) {
    const p = ctx.places.find(p => p.name === r?.place);
    if (p && ['nailed', 'got', 'missed'].includes(r.result)) m.set(p.name, { place: p.name, ids: p.ids, days: p.days, result: r.result });
  }
  if (!m.size) return { recap: [], cant: [] };
  if (ctx.today < ctx.dates[0]) return { recap: [], cant: ['The trip has not started, so there is nothing to mark yet.'] };
  return { recap: [...m.values()], cant: [] };
}
export const recapLines = (recap: Recap[]) => recap.map(r => ({
  text: r.result === 'nailed' ? `Mark ${r.place}: Nailed it (T stops planning it)`
      : r.result === 'got' ? `Mark ${r.place}: Go back for better (T returns only for a clearly better shot)`
      : `Mark ${r.place}: Missed it (T keeps it on the list)`,
  when: 'your ticks' }));

// Sun times for a day at a place (NOAA's short formulas; good to a couple of minutes), HH:MM in the time zone.
export function sunTimes(date: string, lat: number, lng: number, tz: string) {
  const rad = Math.PI / 180, noon = Date.parse(`${date}T12:00:00Z`);
  const n = Math.floor((noon - Date.UTC(new Date(noon).getUTCFullYear(), 0, 0)) / 86400000);
  const g = 2 * Math.PI / 365 * (n - 1);
  const eq = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const dec = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const at = (alt: number, rise: boolean) => {
    const c = (Math.sin(alt * rad) - Math.sin(lat * rad) * Math.sin(dec)) / (Math.cos(lat * rad) * Math.cos(dec));
    if (c < -1 || c > 1) return null;
    const ha = Math.acos(c) / rad, utcMin = 720 - 4 * (lng + (rise ? ha : -ha)) - eq;
    return new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(Date.parse(`${date}T00:00:00Z`) + utcMin * 60000));
  };
  return { first_light: at(-6, true) ?? '', sunrise: at(-0.833, true) ?? '', sunset: at(-0.833, false) ?? '' };
}
