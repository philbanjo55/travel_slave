#!/usr/bin/env node
/**
 * PHILM+FRAME — Ireland/Scotland 2026 Migration Script
 * 
 * Run this ONCE after setting up Supabase to migrate all trip data.
 * 
 * Usage:
 *   SUPABASE_URL=https://xxx.supabase.co SUPABASE_ANON_KEY=eyJ... node migrate.js
 */

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// ─────────────────────────────────────────
// TRIP
// ─────────────────────────────────────────
const TRIP = {
  title: 'Ireland + Scotland',
  subtitle: 'Philm+Frame · Large Format',
  owner: 'phil',
  start_date: '2026-06-21',
  end_date: '2026-07-05',
  accent_color: '#c4a882',
};

// ─────────────────────────────────────────
// DAYS
// ─────────────────────────────────────────
const DAYS = [
  { day_number: 0,  date: '2026-06-21', title: 'Wheels Up',          subtitle: 'IAD → Dublin overnight',           region: 'travel',   checked: true,  mc_lat: 38.9,     mc_lng: -77.4,   mz: 8  },
  { day_number: 1,  date: '2026-06-22', title: 'Atlantic Approach',  subtitle: 'Dublin → Boyle → Sligo',           region: 'ireland',  checked: false, mc_lat: 54.0,     mc_lng: -8.3,    mz: 9  },
  { day_number: 2,  date: '2026-06-23', title: 'Edge of the World',  subtitle: 'Slieve League · Assaranca',        region: 'ireland',  checked: false, mc_lat: 54.65,    mc_lng: -8.7,    mz: 10 },
  { day_number: 3,  date: '2026-06-24', title: 'Yeats Country',      subtitle: 'Benbulben · Gleniff · Mullaghmore',region: 'ireland',  checked: false, mc_lat: 54.35,    mc_lng: -8.45,   mz: 10 },
  { day_number: 4,  date: '2026-06-25', title: "Queen Maeve's Land", subtitle: 'Knocknarea · Downpatrick Head',    region: 'ireland',  checked: false, mc_lat: 54.25,    mc_lng: -8.55,   mz: 10 },
  { day_number: 5,  date: '2026-06-26', title: 'The Long Road',      subtitle: 'Aughris Head · Dublin',            region: 'travel',   checked: false, mc_lat: 54.1,     mc_lng: -8.5,    mz: 8  },
  { day_number: 6,  date: '2026-06-27', title: 'Dublin Days',        subtitle: 'Guinness · Jameson · City',        region: 'dublin',   checked: false, mc_lat: 53.34,    mc_lng: -6.27,   mz: 13 },
  { day_number: 7,  date: '2026-06-28', title: 'Glasgow to Glencoe', subtitle: 'DUB→GLA · Castle Stalker · Buachaille', region: 'scotland', checked: true, mc_lat: 56.65, mc_lng: -5.1,  mz: 10 },
  { day_number: 8,  date: '2026-06-29', title: 'Full Glencoe',       subtitle: 'Lost Valley · Etive Mor · Lochan', region: 'scotland', checked: true,  mc_lat: 56.67,    mc_lng: -5.05,   mz: 11 },
  { day_number: 9,  date: '2026-06-30', title: 'Glencoe to Skye',   subtitle: 'Five Sisters · Eilean Donan · Sligachan', region: 'scotland', checked: true, mc_lat: 57.1, mc_lng: -5.5, mz: 9  },
  { day_number: 10, date: '2026-07-01', title: 'Storr to Neist',     subtitle: 'Old Man · Brothers Pt · Kilt Rock · Neist', region: 'scotland', checked: true, mc_lat: 57.5, mc_lng: -6.25, mz: 10 },
  { day_number: 11, date: '2026-07-02', title: 'Three Waters',       subtitle: 'Quiraing · Fairy Pools · Talisker · Elgol', region: 'scotland', checked: true, mc_lat: 57.35, mc_lng: -6.3, mz: 10 },
  { day_number: 12, date: '2026-07-03', title: 'City of Stone',      subtitle: 'Corpach · St Andrews · Edinburgh', region: 'scotland', checked: true,  mc_lat: 56.5,     mc_lng: -3.5,    mz: 8  },
  { day_number: 13, date: '2026-07-04', title: 'Castle Rock',        subtitle: 'Edinburgh Castle · Arthur\'s Seat · Calton Hill', region: 'scotland', checked: true, mc_lat: 55.95, mc_lng: -3.19, mz: 13 },
  { day_number: 14, date: '2026-07-05', title: 'Safe Home',          subtitle: 'EDI→DUB→IAD',                     region: 'travel',   checked: true,  mc_lat: 55.95,    mc_lng: -3.37,   mz: 10 },
];

// ─────────────────────────────────────────
// STOPS (key stops per day)
// ─────────────────────────────────────────
const STOPS_BY_DAY = {
  0: [
    { pos: 0, name: 'Depart Dulles IAD', emoji: '✈️', time_label: '5:15 PM', lat: 38.9531, lng: -77.4565, signal_status: 'ok', info: 'EI 0116 · Dulles to Dublin · Overnight flight · Arrives Jun 22 05:15', log: 'Conf: 2JWMSW · Seat 24C · Checked bag included' },
  ],
  1: [
    { pos: 0, name: 'Land Dublin Airport', emoji: '✈️', time_label: '5:15 AM', lat: 53.4264, lng: -6.2499, signal_status: 'ok', info: 'Immigration · Baggage · Enterprise car pickup · Target departure 7am' },
    { pos: 1, name: 'Lough Key Forest Park', emoji: '🌳', time_label: '9:45 AM', duration_minutes: 60, lat: 53.9817, lng: -8.2464, signal_status: 'ok', info: "Island castle ruin (McDermott's Castle) on Lough Key. Drive from Dublin: ~2.5 hrs via N4.", log: 'Free entry · Parking €4 · 5 min walk to lakeshore' },
    { pos: 2, name: "Devil's Chimney (Sruth in Aghaidh An Aird)", emoji: '📷', time_label: '11:45 AM', duration_minutes: 150, drive_override_minutes: 60, lat: 54.340478, lng: -8.393220, signal_status: 'warning', alltrails_url: 'https://www.alltrails.com/trail/ireland/county-leitrim/sruth-in-aghaidh-an-aird-the-devils-chimney?sh=jrrmvi&u=i&utm_medium=trail_share&utm_source=alltrails_virality', info: "Ireland's tallest waterfall. Trailhead at Tormore. 20 min walk to the falls.", log: 'Small roadside layby parking · Free · Boots essential' },
    { pos: 3, name: 'Glencar Waterfall', emoji: '📷', time_label: '2:20 PM', duration_minutes: 60, drive_override_minutes: 5, lat: 54.3402, lng: -8.3685, signal_status: 'ok', info: "15m cascade in lush gorge. Yeats wrote 'The Stolen Child' here. Mossy grotto.", log: 'Free · Small car park · 5 min walk' },
    { pos: 4, name: 'Glencar Castle — Lough Gill', emoji: '📷', time_label: '3:45 PM', duration_minutes: 60, drive_override_minutes: 22, lat: 54.264091, lng: -8.334112, signal_status: 'ok', info: '17th century plantation castle on the water. Strong silhouette potential.', log: '€5 entry · Heritage Ireland site' },
    { pos: 5, name: 'Streedagh Point', emoji: '📷', time_label: '5:30 PM', duration_minutes: 60, drive_override_minutes: 43, lat: 54.404438, lng: -8.560154, signal_status: 'warning', info: 'Rocky headland at north end of Streedagh Beach. Site of 1588 Armada wrecks.', log: 'Free · Beach car park · Check tide' },
    { pos: 6, name: 'Innisfreedom Cabin — Ballintogher', emoji: '🏡', time_label: '7:10 PM', lat: 54.22781, lng: -8.35417, signal_status: 'ok', log: 'Killerry, Ballintogher, F91W577 Sligo · Conf: 5869191106 · +353872168522\nCheck-in from 3pm' },
  ],
  7: [
    { pos: 0, name: 'EI 3226 — DUB → GLA', emoji: '✈️', time_label: '11:30 AM', signal_status: 'ok', info: 'Emerald Airlines. Land Glasgow 12:50.', log: 'Conf: 2FH8WF · Terminal 2 Dublin' },
    { pos: 1, name: 'Castle Stalker — Loch Laich', emoji: '📷', time_label: '4:30 PM', drive_override_minutes: 132, lat: 56.5596, lng: -5.4666, signal_status: 'warning', info: 'Tower house on tidal islet. Best shot from the south shore road layby.', log: 'Roadside pull-off · No entry · Free' },
    { pos: 2, name: 'Buachaille Etive Mòr — River Coupall', emoji: '📷', time_label: '7:15 PM', duration_minutes: 50, drive_override_minutes: 16, lat: 56.647682, lng: -4.866127, signal_status: 'warning', info: "Scotland's most photographed mountain. River Coupall in foreground.", log: 'Roadside layby A82 · Free' },
    { pos: 3, name: 'Check In — Clachaig Inn', emoji: '🏨', time_label: '9:35 PM', lat: 56.66454, lng: -5.05661, signal_status: 'warning', log: 'Glencoe, Ballachulish PH49 4HX · Jun 28-30 · Glencoe Double B&B' },
  ],
  8: [
    { pos: 0, name: 'Lost Valley — Coire Gabhail', emoji: '📷', time_label: '7:30 AM', duration_minutes: 210, lat: 56.6674, lng: -5.0169, signal_status: 'none', alltrails_url: 'https://www.alltrails.com/trail/scotland/highlands/lost-valley-coire-gabhail?sh=jrrmvi', info: 'Hidden hanging valley where the Clan MacDonald hid stolen cattle. 3 river crossings.', log: 'Glencoe Visitor Centre car park · £3 · 4.5km return' },
    { pos: 1, name: 'Etive Mor Waterfall', emoji: '📷', time_label: '11:00 AM', duration_minutes: 60, lat: 56.647682, lng: -4.866127, signal_status: 'warning', info: 'Glen Etive waterfall with Buachaille behind. Classic composition.' },
    { pos: 2, name: 'Signal Rock + Clachaig Falls', emoji: '📷', time_label: '1:30 PM', lat: 56.66203, lng: -5.05597, signal_status: 'warning', info: 'Legendary signal rock of the Glencoe Massacre. Falls nearby.' },
    { pos: 3, name: 'Glencoe Lochan', emoji: '📷', time_label: '3:00 PM', lat: 56.687643, lng: -5.096785, signal_status: 'warning', info: 'Still loch with Pap of Glencoe reflection. Stunning in calm conditions.' },
    { pos: 4, name: 'Loch Achtriochtan', emoji: '📷', time_label: '4:30 PM', lat: 56.664482, lng: -5.038819, signal_status: 'warning', info: 'Classic Three Sisters reflection. Best in still morning or evening.' },
  ],
  9: [
    { pos: 0, name: 'Five Sisters of Kintail', emoji: '📷', time_label: '11:00 AM', drive_override_minutes: 30, lat: 57.1696, lng: -5.2947, signal_status: 'warning', info: 'Five dramatic ridgelines. Best from Glen Shiel layby on A87.' },
    { pos: 1, name: 'Eilean Donan', emoji: '📷', time_label: '1:00 PM', drive_override_minutes: 15, lat: 57.2739, lng: -5.5158, signal_status: 'ok', info: "Scotland's most photographed castle. Tidal causeway.", log: '£10 entry or exterior free · Large car park' },
    { pos: 2, name: 'Sligachan Old Bridge', emoji: '📷', time_label: '3:30 PM', lat: 57.29044, lng: -6.17105, signal_status: 'ok', info: 'Stone arch bridge with Black Cuillin behind. Waders for river position.', log: 'Sligachan Hotel car park · Free' },
    { pos: 3, name: 'Check In — Oor Neuk', emoji: '🏨', time_label: '4:30 PM', lat: 57.45709, lng: -6.29806, signal_status: 'none', log: 'Tole, Staffin, IV51 9PG · Conf: 6926.868.123 · +44 7810 237996\nJun 30 - Jul 3 · 3 nights' },
    { pos: 4, name: 'Staffin Harbour — Dinosaur Footprints', emoji: '🦕', time_label: '6:00 PM', duration_minutes: 60, drive_override_minutes: 30, lat: 57.63313, lng: -6.19815, signal_status: 'warning', info: '170-million-year-old sauropod footprints on the foreshore. Check tide.' },
  ],
  10: [
    { pos: 0, name: 'Old Man of Storr', emoji: '📷', time_label: '7:00 AM', duration_minutes: 240, lat: 57.49933, lng: -6.15843, signal_status: 'warning', alltrails_url: 'https://www.alltrails.com/trail/scotland/highlands/the-old-man-of-storr-circular-walk?sh=jrrmvi', info: '160ft basalt pinnacle. Best at sunrise. 2km hike to the base.', log: 'New car park on A855 · £3 · Busy in summer — arrive early' },
    { pos: 1, name: 'Brothers Point', emoji: '📷', time_label: '11:20 AM', duration_minutes: 30, drive_override_minutes: 20, lat: 57.58717, lng: -6.13910, signal_status: 'none', info: 'Dramatic headland with Staffin Bay views. Short cliff walk.' },
    { pos: 2, name: 'Kilt Rock + Mealt Falls', emoji: '📷', time_label: '12:00 PM', duration_minutes: 30, drive_override_minutes: 10, lat: 57.60946, lng: -6.17384, signal_status: 'warning', info: '55m waterfall straight into the sea. Basalt columns like a kilt.', log: 'Free roadside viewpoint · Small car park' },
    { pos: 3, name: 'Neist Point', emoji: '📷', time_label: '1:45 PM', duration_minutes: 90, drive_override_minutes: 75, lat: 57.42391, lng: -6.78738, signal_status: 'none', info: "Skye's westernmost point. Lighthouse on dramatic headland. Golden hour.", log: 'Free car park · 1km walk to lighthouse · Very exposed — check wind' },
  ],
  11: [
    { pos: 0, name: 'Quiraing Circuit', emoji: '📷', time_label: '7:30 AM', duration_minutes: 210, drive_override_minutes: 30, lat: 57.638, lng: -6.27, signal_status: 'none', alltrails_url: 'https://www.alltrails.com/trail/scotland/highlands/the-quiraing-circuit?sh=jrrmvi', info: 'Landslip landscape on Trotternish Ridge. Sunrise destination. Moody even in cloud.' },
    { pos: 1, name: 'Fairy Pools', emoji: '📷', time_label: '12:15 PM', duration_minutes: 120, drive_override_minutes: 75, lat: 57.249950, lng: -6.27302, signal_status: 'ok', info: 'Crystal blue pools and waterfalls at the base of the Cuillins.', log: 'Forestry Commission car park · Free · 2km each way' },
    { pos: 2, name: 'Talisker Bay', emoji: '📷', time_label: '3:00 PM', duration_minutes: 150, drive_override_minutes: 45, lat: 57.28910, lng: -6.43447, signal_status: 'none', info: 'Black sand beach with sea stacks. Faces west — perfect for evening light.', log: 'Roadside parking · 1km walk to beach · Check tide' },
    { pos: 3, name: '🏌️ Drop James — Isle of Skye Golf Club', emoji: '⛳', time_label: '~6:00 PM', drive_override_minutes: 30, lat: 57.3100817, lng: -6.0950514, signal_status: 'ok', info: 'Drop James at Sconser for 7pm tee time. Ref: BMEG2-XUYQ1-969 · £40 green fee · With Jack Cyr.', log: 'Isle of Skye Golf Club · Sconser IV48 8TD' },
    { pos: 4, name: 'Elgol Beach — Cuillin Panorama', emoji: '📷', time_label: '~6:40 PM', duration_minutes: 140, drive_override_minutes: 40, lat: 57.157, lng: -6.109, signal_status: 'none', info: 'Finest sea-level view of the Black Cuillin rear face across Loch Scavaig. Shoot until 9pm, pick up James ~9:30.', log: 'Elgol village car park · Small fee · Rocky beach — boots essential' },
  ],
  12: [
    { pos: 0, name: 'Check Out — Oor Neuk', emoji: '🏨', time_label: '8:30 AM', lat: 57.45709, lng: -6.29806, signal_status: 'none', log: 'Check out by 10am · Return key to lockbox' },
    { pos: 1, name: 'Corpach Wreck — Old Boat of Caol', emoji: '📷', time_label: '~11:00 AM', duration_minutes: 45, drive_override_minutes: 150, lat: 56.8418828, lng: -5.1160156, signal_status: 'ok', info: 'MV Dayspring — 26m fishing vessel beached 2011. Ben Nevis backdrop. Rusting hull, peeling paint.', log: 'Corpach Basin · PH33 7JH · Free · 10-15 min walk from car park\nBest shot: cross the stream for hull + Ben Nevis' },
    { pos: 2, name: 'St Andrews — Home of Golf', emoji: '⛳', time_label: '~3:15 PM', duration_minutes: 300, drive_override_minutes: 195, lat: 56.3432, lng: -2.8038, signal_status: 'ok', info: 'Full afternoon: lunch, Swilcan Bridge, R&A shop, Links Trust shop, Himalayas Putting, Cathedral ruins.', log: 'SCHEDULE:\n3:15 PM - Lunch: Mitchells Deli or Forgans\n4:15 PM - Swilcan Bridge photos 45 min\n5:00 PM - R&A Golf Shop 30 min\n5:30 PM - Links Trust Golf Shop 30 min\n6:00 PM - Himalayas Putting 45 min\n6:45 PM - Cathedral ruins 30 min\n7:15 PM - Drive to Edinburgh\n\nParking: Links Car Park free · All stops walkable' },
    { pos: 3, name: 'Check In — Fraser Suites Edinburgh', emoji: '🏨', time_label: '~9:15 PM', drive_override_minutes: 90, lat: 55.949999, lng: -3.191898, signal_status: 'ok', log: '12-26 St Giles Street, Edinburgh EH1 1PT\nConf: 52611SG109917 · +44 131 221 7200\nJul 3-5 · 2 nights · 1-bed Premier · £824\nCheck-in 4pm · Check-out 11am' },
  ],
  13: [
    { pos: 0, name: 'Edinburgh Castle — Guided Tour', emoji: '🏰', time_label: '9:30 AM', duration_minutes: 90, lat: 55.9486, lng: -3.1999, signal_status: 'ok', info: 'Official guided tour 9:45-10:15. Argyle Battery for panoramic views. Grounds until 11am.', log: 'Conf: tickets.historic-scotland.gov.uk · £30pp · 3 adults · £90 total\nArrive 9:30 at Ticket Plaza · Tour departs 9:45' },
    { pos: 1, name: 'Castle Exterior Walk', emoji: '📷', time_label: '11:00 AM', duration_minutes: 90, lat: 55.9496, lng: -3.2003, signal_status: 'ok', info: 'Walking circuit: The Vennel steps → Grassmarket → Princes Street Gardens (Ross Fountain) → back to Old Town.', log: 'WALKING ORDER:\n1. The Vennel Steps — staircase framing castle between buildings\n2. Grassmarket — castle looming overhead\n3. Princes Street Gardens — Ross Fountain foreground\n4. Walk east → lunch\n\nAll free · No entry required' },
    { pos: 2, name: 'Lunch + Old Town Wander', emoji: '🍽️', time_label: '12:30 PM', duration_minutes: 150, signal_status: 'ok', info: 'Victoria Street, Royal Mile closes, Grassmarket pubs. Victoria Street is the real Diagon Alley.' },
    { pos: 3, name: "Arthur's Seat — Nether Hill Circular", emoji: '📷', time_label: '5:00 PM', duration_minutes: 90, lat: 55.951133, lng: -3.169840, signal_status: 'ok', alltrails_url: 'https://www.alltrails.com/trail/scotland/edinburgh/arthurs-seat-via-the-nether-hill-circular?sh=jrrmvi&u=i&utm_medium=trail_share&utm_source=alltrails_virality', info: 'Extinct volcano, 251m. 360° city views. Via Nether Hill Circular — 1.6mi, 1-1.5hrs.', log: 'Holyrood Car Park · 55.951133,-3.169840 · Free\nAllTrails: Nether Hill Circular · Rocky summit — good grip footwear essential' },
    { pos: 4, name: 'Calton Hill', emoji: '📷', time_label: '7:00 PM', duration_minutes: 60, lat: 55.9553, lng: -3.1820, signal_status: 'ok', info: 'Dugald Stewart Monument + castle view. Best sunset viewpoint in Edinburgh. Free, 10 min walk from Royal Mile.' },
    { pos: 5, name: 'Greyfriars Kirkyard', emoji: '📷', time_label: '8:30 PM', duration_minutes: 45, lat: 55.9470, lng: -3.1914, signal_status: 'ok', info: 'Atmospheric 17th century graveyard. Tom Riddle gravestone. Greyfriars Bobby. Strong B&W subject.' },
  ],
  14: [
    { pos: 0, name: 'Depart Fraser Suites', emoji: '🏨', time_label: '6:00 AM', lat: 55.949999, lng: -3.191898, signal_status: 'ok', info: '⚠️ Very early start. FR809 departs 07:55. Airport 30-45 min from hotel.', log: 'Taxi to EDI: ~£25-30 / 30 min\nArrange luggage night before if possible' },
    { pos: 1, name: 'FR809 — EDI → DUB', emoji: '✈️', time_label: '7:55 AM', signal_status: 'ok', info: 'Ryanair. Land Dublin 09:00. 3.5 hour connection.', log: 'Conf: U72I6U · Seat 15C · Priority boarding\nDownload Ryanair app — no printed boarding passes' },
    { pos: 2, name: 'Dublin — Connection Layover', emoji: '⏳', time_label: '9:00 AM', lat: 53.4264, lng: -6.2499, signal_status: 'ok', info: 'International to international. Terminal 1 → Terminal 2.', log: 'EI 117 departs 12:35 · Allow time for T2 transfer' },
    { pos: 3, name: 'EI 117 — DUB → IAD — HOME ✅', emoji: '✈️', time_label: '12:35 PM', signal_status: 'ok', info: 'Final leg. Lands Washington Dulles 15:45. Ship film to Praus after landing.', log: 'Conf: 2JWMSW · 8hr 10min flight\n\nPost-trip:\nPraus Productions · Rochester NY\nD-76 1:1 · 4x5 development' },
  ],
};

// ─────────────────────────────────────────
// ACCOMMODATIONS PER DAY
// ─────────────────────────────────────────
const ACCOMMODATIONS = {
  1: { start: { name: 'Dublin Airport', lat: 53.4264, lng: -6.2499 }, end: { name: 'Innisfreedom Cabin', lat: 54.22781, lng: -8.35417 } },
  2: { start: { name: 'Innisfreedom Cabin', lat: 54.22781, lng: -8.35417 }, end: { name: 'Innisfreedom Cabin', lat: 54.22781, lng: -8.35417 } },
  3: { start: { name: 'Innisfreedom Cabin', lat: 54.22781, lng: -8.35417 }, end: { name: 'Innisfreedom Cabin', lat: 54.22781, lng: -8.35417 } },
  4: { start: { name: 'Innisfreedom Cabin', lat: 54.22781, lng: -8.35417 }, end: { name: 'Innisfreedom Cabin', lat: 54.22781, lng: -8.35417 } },
  5: { start: { name: 'Innisfreedom Cabin', lat: 54.22781, lng: -8.35417 }, end: { name: 'Moxy Dublin City', lat: 53.3424, lng: -6.2683 } },
  6: { start: { name: 'Moxy Dublin City', lat: 53.3424, lng: -6.2683 }, end: { name: 'Moxy Dublin City', lat: 53.3424, lng: -6.2683 } },
  7: { start: { name: 'Moxy Dublin City', lat: 53.3424, lng: -6.2683 }, end: { name: 'Clachaig Inn', lat: 56.66454, lng: -5.05661 } },
  8: { start: { name: 'Clachaig Inn', lat: 56.66454, lng: -5.05661 }, end: { name: 'Clachaig Inn', lat: 56.66454, lng: -5.05661 } },
  9: { start: { name: 'Clachaig Inn', lat: 56.66454, lng: -5.05661 }, end: { name: 'Oor Neuk', lat: 57.45709, lng: -6.29806 } },
  10: { start: { name: 'Oor Neuk', lat: 57.45709, lng: -6.29806 }, end: { name: 'Oor Neuk', lat: 57.45709, lng: -6.29806 } },
  11: { start: { name: 'Oor Neuk', lat: 57.45709, lng: -6.29806 }, end: { name: 'Oor Neuk', lat: 57.45709, lng: -6.29806 } },
  12: { start: { name: 'Oor Neuk', lat: 57.45709, lng: -6.29806 }, end: { name: 'Fraser Suites Edinburgh', lat: 55.949999, lng: -3.191898 } },
  13: { start: { name: 'Fraser Suites Edinburgh', lat: 55.949999, lng: -3.191898 }, end: { name: 'Fraser Suites Edinburgh', lat: 55.949999, lng: -3.191898 } },
  14: { start: { name: 'Fraser Suites Edinburgh', lat: 55.949999, lng: -3.191898 }, end: { name: 'Home — Ballston, Arlington VA', lat: 38.8817, lng: -77.1042 } },
};

// ─────────────────────────────────────────
// MIGRATION RUNNER
// ─────────────────────────────────────────
async function migrate() {
  console.log('🚀 Starting migration...\n');

  // 1. Insert trip
  console.log('📦 Creating trip...');
  const { data: trip, error: tripError } = await supabase
    .from('trips')
    .insert(TRIP)
    .select()
    .single();
  if (tripError) throw tripError;
  console.log(`   ✅ Trip created: ${trip.id}\n`);

  // 2. Insert days
  console.log('📅 Creating days...');
  for (const day of DAYS) {
    const { data: dayData, error: dayError } = await supabase
      .from('days')
      .insert({
        trip_id: trip.id,
        day_number: day.day_number,
        date: day.date,
        title: day.title,
        subtitle: day.subtitle,
        region: day.region,
        checked: day.checked,
        map_center_lat: day.mc_lat,
        map_center_lng: day.mc_lng,
        map_zoom: day.mz,
      })
      .select()
      .single();
    if (dayError) throw dayError;

    // Insert stops for this day
    const stops = STOPS_BY_DAY[day.day_number] || [];
    for (const stop of stops) {
      const { error: stopError } = await supabase
        .from('stops')
        .insert({
          day_id: dayData.id,
          trip_id: trip.id,
          position: stop.pos,
          name: stop.name,
          emoji: stop.emoji,
          time_label: stop.time_label,
          duration_minutes: stop.duration_minutes || null,
          drive_override_minutes: stop.drive_override_minutes || null,
          lat: stop.lat || null,
          lng: stop.lng || null,
          alltrails_url: stop.alltrails_url || null,
          signal_status: stop.signal_status || null,
          info: stop.info || null,
          log: stop.log || null,
        });
      if (stopError) throw stopError;
    }

    // Insert accommodations
    const acc = ACCOMMODATIONS[day.day_number];
    if (acc) {
      if (acc.start) {
        await supabase.from('accommodations').insert({
          day_id: dayData.id,
          type: 'start',
          name: acc.start.name,
          lat: acc.start.lat,
          lng: acc.start.lng,
        });
      }
      if (acc.end) {
        await supabase.from('accommodations').insert({
          day_id: dayData.id,
          type: 'end',
          name: acc.end.name,
          lat: acc.end.lat,
          lng: acc.end.lng,
        });
      }
    }

    console.log(`   ✅ Day ${day.day_number}: ${day.title} (${stops.length} stops)`);
  }

  console.log('\n✅ Migration complete!');
  console.log(`\nTrip ID: ${trip.id}`);
  console.log('Save this ID — you may need it for testing.\n');
}

migrate().catch(err => {
  console.error('❌ Migration failed:', err);
  process.exit(1);
});
