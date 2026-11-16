# Words for brochure v2. Facts come from the trip plan (read only); nothing private.

TRIPS = {
 'tetons': {
  'nav': 'Grand Teton', 'navsub': 'Dec 2026',
  'kicker': 'Jackson Hole, Wyoming',
  'title': 'Grand Teton in winter',
  'dates': '29 December 2026 – 4 January 2027',
  'start': '2026-12-29T12:00:00-07:00', 'end': '2027-01-04T16:19:00-07:00',
  'hero': 'pf_snake', 'hero_pos': '55% 50%',
  'intro': ("Seeing in the New Year in Jackson Hole: a week of early starts, skis and snowshoes "
            "on park roads that are closed to cars all winter, and a large-format film camera pointed at the Tetons. "
            "Below are the days we are most looking forward to, then the plan as it stands today."),
  'facts': [('Seven days', 'on the ground'), ('Wyoming Inn', 'Jackson, every night'), ('Skis and snowshoes', 'from day two')],
  'next': ('faroes', 'Next spring: the Faroe Islands'),
 },
 'faroes': {
  'nav': 'Faroe Islands', 'navsub': 'May 2027',
  'kicker': 'North Atlantic',
  'title': 'The Faroe Islands',
  'dates': '13 – 28 May 2027',
  'start': '2027-05-13T20:30:00-04:00', 'end': '2027-05-28T14:05:00+01:00',
  'hero': 'kallur1', 'hero_pos': '80% 50%',
  'intro': ("Eighteen steep green islands out between Scotland and Iceland: sea stacks, waterfalls that drop straight into the ocean, "
            "turf-roofed villages and seabird cliffs. By mid-May the light lasts until nearly eleven at night, which suits a photographer "
            "very well. Nine nights on Vágar, then Tórshavn and the northern isles."),
  'facts': [('Sixteen days', 'door to door'), ('Three bases', 'Sørvágur, Tórshavn, Klaksvík'), ('Sunset', 'around 10:30 PM')],
  'next': ('tetons', 'First, this winter: Grand Teton'),
 },
}

# Big excursions, in plan order. day = plan day number (for the "see it in the plan" link).
EXCURSIONS = {
 'tetons': [
  {'id': 'snake', 'day': 2, 'photo': 'adams', 'title': 'Sunrise at Snake River Overlook',
   'when': 'Wed 30 Dec, and again Mon 4 Jan', 'note': 'Sunrise, weather permitting',
   'text': ["In 1942 Ansel Adams stood at this pullout and made one of the best-known landscape photographs ever taken: the Snake River "
            "curling through the valley with the whole Teton Range lined up behind it. The trees have grown since, but on a clear, cold "
            "morning the peaks still turn pink before the valley wakes up.",
            "The winter frame at the top of this page was made from the same rail. Two sunrises are planned here, to give the weather two chances."]},
  {'id': 'jenny', 'day': 3, 'photo': 'jenny1', 'title': 'Skiing the closed park road to Jenny Lake',
   'when': 'Thu 31 Dec', 'note': 'Saved for the clearest day, so it may swap',
   'text': ["All winter the Teton Park Road is closed to cars and groomed for skiers and walkers, so the heart of the park goes quiet. "
            "The plan is an eight-mile loop from the Taggart Lake trailhead: sunrise glow on the Grand from the meadows, out to the frozen "
            "south shore of Jenny Lake, then an easy glide home on the groomed road.",
            "It's the headline day of the week, so it moves to whichever day looks clearest."]},
  {'id': 'nye', 'day': 3, 'photo': [], 'title': "New Year's Eve in Jackson",
   'when': 'Thu 31 Dec, evening', 'note': None,
   'text': ["After the ski day, into town: fireworks over Snow King Mountain early in the evening, then dinner in Jackson, "
            "a small Western town with elk-antler arches on its square and the mountains a few miles up the road."]},
  {'id': 'barns', 'day': 4, 'photo': 'pf_barn', 'title': 'Sunrise at the Mormon Row barns',
   'when': 'Fri 1 Jan', 'note': 'Sunrise, weather permitting',
   'text': ["The road to Mormon Row isn't plowed in winter, so New Year's Day starts with a snowshoe of about a mile and a quarter across "
            "the flats in the dark, often at single-digit temperatures. The reward is the T.A. Moulton Barn, one of the most photographed "
            "barns in the West, with the Grand rising behind it as the sun comes up.",
            "The photo here is from a grey day; this time the hope is first light on the peaks."]},
  {'id': 'oxbow', 'day': 6, 'photo': 'pf_oxbow', 'title': 'Oxbow Bend under Mount Moran',
   'when': 'Tue 29 Dec, Fri 1 Jan and Sun 3 Jan', 'note': 'Three tries, the last one at sunrise',
   'text': ["The Snake River makes a slow bend here below Mount Moran. In midwinter it is mostly frozen, so instead of the famous summer "
            "reflection there is a wide snowfield, open channels, and on the coldest mornings mist lifting off the water.",
            "It is on the plan three times: last light on the first afternoon, a late-morning return, and sunrise on Moran's east face."]},
  {'id': 'swan', 'day': 4, 'photo': 'swan1', 'title': 'Swan Lake and Heron Pond',
   'when': 'Fri 1 Jan, into sunset', 'note': None,
   'text': ["A three-mile ski or snowshoe loop from Colter Bay past two frozen ponds and out along the shore of Jackson Lake, with "
            "Mount Moran across the ice and the odd ice-fishing shack for scale. Timed to finish as the sun goes down over the lake."]},
  {'id': 'taggart', 'day': 5, 'photo': 'tagg1', 'title': 'Taggart and Bradley Lakes',
   'when': 'Sat 2 Jan', 'note': 'Sunrise, weather permitting',
   'text': ["A full day on snowshoes. First to frozen Taggart Lake, which sits almost directly under the Grand and Teewinot, "
            "for sunrise and the morning light; then over the moraine to Bradley Lake. The trail climbs through an old burn, "
            "and the silver standing snags look wonderful in black and white."]},
 ],
 'faroes': [
  {'id': 'mula', 'day': 1, 'photo': ['mula1', 'mula2'], 'title': 'Múlafossur, the first evening',
   'when': 'Fri 14 May', 'note': None,
   'text': ["The picture that put the Faroes on the map: a waterfall pouring off a grassy cliff straight into the Atlantic, below the "
            "turf-roofed village of Gásadalur, which had no road at all until a tunnel opened in 2004.",
            "It is a short drive from the cottage, so it is the first evening's outing, with the sun setting after 10 PM."]},
  {'id': 'lake', 'day': 2, 'photo': 'lake1', 'title': 'The lake above the ocean',
   'when': 'Sat 15 May', 'note': 'Kept for a clear day, so it may move',
   'text': ["Sørvágsvatn, the biggest lake in the islands, ends at sheer sea cliffs, and from the top of Trælanípa a trick of "
            "perspective makes it look as if the lake hangs high above the ocean. The walk is about seven kilometres there and back, "
            "past Bøsdalafossur, a waterfall that spills straight into the sea."]},
  {'id': 'drang', 'day': 4, 'photo': ['drang2', 'drang1'], 'title': 'Two boat landings at Drangarnir',
   'when': 'Sat 15 May (evening) and Mon 17 May (morning)', 'note': 'Not booked yet: the boats only go when the sea allows, so dates will move',
   'text': ["Drangarnir is a pair of sea stacks off the west tip of Vágar, one pierced by an arch you can sail through on a calm day, with "
            "the jagged islet of Tindhólmur behind. A small boat from Sørvágur harbour puts you ashore beside them for a couple of hours.",
            "Two landings are planned: one in evening golden light, one in the morning. Pencilled in as well, for Wed 26 May: a guided trip "
            "that lands on Tindhólmur itself, where puffins breed."]},
  {'id': 'saksun', 'day': 10, 'photo': 'saksun1', 'title': 'Saksun, Fossá and Tjørnuvík',
   'when': 'Sun 23 May', 'note': None,
   'text': ["The moving day to Tórshavn goes the long way round. Saksun is a few farms and a turf-roofed church above a tidal lagoon; "
            "at low tide you can walk the black sand out toward the sea. Then Fossá, the tallest waterfall in the islands, right beside the road.",
            "The day ends at Tjørnuvík, looking across the bay at sunset to Risin and Kellingin, the giant and the witch of the old legend."]},
  {'id': 'torshavn', 'day': 11, 'photo': 'ting1', 'title': 'Old Tórshavn and Kirkjubøur',
   'when': 'Mon 24 May', 'note': None,
   'text': ["Tórshavn is one of the smallest capitals anywhere. Its old quarter, Tinganes, is a rocky point of dark-red wooden houses "
            "with turf roofs where the Faroese parliament first met in Viking times. A short drive south, Kirkjubøur has the roofless "
            "walls of the medieval Magnus Cathedral beside the sea.",
            "If the morning is clear, it starts with the trip's hardest hike, out to the Mýlingur sea cliffs."]},
  {'id': 'gjogv', 'day': 12, 'photo': 'gjogv1', 'title': 'Gjógv and its gorge',
   'when': 'Tue 25 May', 'note': None,
   'text': ["The village is named after its gorge: a sea-filled cleft about 200 metres long that serves as the harbour, with the boats "
            "hauled up a slipway at the end. Cliff paths above look out over seabird ledges, where puffins are back by May.",
            "The same day takes in Funningur's turf-roofed church and, in fair weather, a walk west along the cliffs toward the sea stack Búgvin."]},
  {'id': 'north', 'day': 13, 'photo': 'klak1', 'title': 'The northern isles',
   'when': 'Wed 26 May, plus a day trip on Fri 21 May', 'note': 'The day trip is pencilled in',
   'text': ["Klaksvík, the second town, sits between steep fjords in the north-east. A short climb up Klakkur behind it gives a "
            "sunset view down the fjords of the northern islands, with the sun going down at 10:47 PM.",
            "Pencilled in for an earlier day trip: Múli, an abandoned hamlet at the end of the road on Borðoy, and a stiff climb above "
            "Viðareiði, the northernmost village in the Faroes."]},
  {'id': 'kallur', 'day': 14, 'photo': ['kallur2'], 'title': 'Kallur lighthouse on Kalsoy',
   'when': 'Thu 27 May', 'note': 'A whole day, weather permitting',
   'text': ["The most famous view in the Faroes: a small white lighthouse on a knife-edge grass ridge at the north tip of Kalsoy, with "
            "cliffs falling away on both sides. Getting there is half the fun: the 6:40 AM car ferry from Klaksvík, four single-lane "
            "tunnels to the end of the road, then a steep walk up.",
            "The whole day is kept for it, ending with the Seal Woman statue at Mikladalur and the last ferry home."]},
 ],
}

# Smaller extras shown as a compact row under the big excursions.
EXTRAS = {
 'tetons': [
  {'photo': 'pf_cabin', 'title': 'Cunningham Cabin', 'when': 'Tue 29 Dec and Sun 3 Jan',
   'text': 'An 1880s homestead cabin with the Grand and Mount Moran behind it.'},
  {'photo': 'xc1', 'title': 'Easy groomed skis', 'when': "Wed 30 Dec and Sun 3 Jan",
   'text': "Flat, groomed loops near Wilson at Emily's Pond and the Teton Pines Nordic Center."},
 ],
 'faroes': [],
}

# Plan-day titles that read better in v2 (others come from tools/content.py).
DAY_TITLE = {
 ('tetons', 1): 'Arrival and the highway viewpoints',
 ('tetons', 7): 'A last sunrise, then home',
 ('faroes', 0): 'Overnight to Iceland',
 ('faroes', 1): 'Arrival on Vágar',
 ('faroes', 15): 'Home via Iceland',
}
