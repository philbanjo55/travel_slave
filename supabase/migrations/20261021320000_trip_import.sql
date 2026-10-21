-- trip_import(json): phase 1 of docs/NEW_TRIP_SOP.md in one call. Claude
-- turns Phil's itinerary (any form) into this JSON and runs it; everything is
-- checked first and nothing is written if anything is wrong. Insert only:
-- never updates or deletes an existing row.
--
--   select trip_import('{
--     "trip": {"title": "...", "start_date": "2027-05-13", "end_date": "2027-05-28",
--              "timezone": "Atlantic/Faroe", "metar_station": "EKVG",
--              "travelers": ["Phil"], "subtitle": "..."},
--     "days": [{"date": "2027-05-14", "title": "...",
--               "stops": [{"name": "...", "lat": 62.1, "lng": -7.4, "time_label": "5:50 AM",
--                          "duration_minutes": 60, "shot_type": "waterfall", "time_locked": false,
--                          "emoji": "📷", "info": "...", "google_maps_url": "...", "alltrails_url": "..."}]}],
--     "accommodations": [{"name": "...", "lat": 62.07, "lng": -7.3,
--                         "check_in": "2027-05-14", "check_out": "2027-05-23", "booked_via": "..."}]
--   }'::jsonb, true);   -- true = dry run: check and report, write nothing
--
-- {"trip_id": "<existing>", "days": [...], "accommodations": [...]} appends to
-- a trip: new dates become new days, stops on an existing date go after its
-- last stop; the trip row is left as it is.
-- time_label "17:50" is written as "5:50 PM" (the app reads h:mm AM/PM).
-- New days get the hotel as a logistics stop at the start (last night's
-- place) and end (tonight's) unless a stop is already within 500 m: the
-- solver starts and ends each day there. "hotel_stops": false turns it off.
-- Afterwards: select * from trip_readiness('<trip_id>').

create or replace function public.trip_import(p jsonb, p_dry_run boolean default false)
returns jsonb language plpgsql set search_path = public as $$
declare
  errs text[] := '{}';
  warns text[] := '{}';
  t jsonb := p->'trip';
  v_trip uuid := nullif(p->>'trip_id', '')::uuid;
  v_start date; v_end date; v_tz text;
  d jsonb; s jsonb; a jsonb;
  v_date date; v_day uuid; v_dayno int; v_pos int;
  n_days int := 0; n_stops int := 0; n_acc int := 0; n_hotel int := 0;
  v_label text; v_m text[];
  v_hotels boolean := coalesce((p->>'hotel_stops')::boolean, true);
  stops_out jsonb; first_s jsonb; last_s jsonb; h_am record; h_pm record;
begin
  -- Trip -----------------------------------------------------------------------
  if v_trip is not null then
    select start_date, end_date, timezone into v_start, v_end, v_tz from trips where id = v_trip;
    if not found then errs := errs || format('trip_id %s does not exist', v_trip); end if;
  else
    if t is null then errs := errs || 'trip is required (or trip_id to append)'::text; end if;
    if coalesce(t->>'title', '') = '' then errs := errs || 'trip.title is required'::text; end if;
    begin
      v_start := (t->>'start_date')::date; v_end := (t->>'end_date')::date;
    exception when others then errs := errs || 'trip.start_date / end_date must be YYYY-MM-DD'::text; end;
    if v_start is null or v_end is null or v_end < v_start then errs := errs || 'trip needs start_date <= end_date'::text; end if;
    v_tz := t->>'timezone';
    if v_tz is null then errs := errs || 'trip.timezone is required (IANA, e.g. America/Denver)'::text;
    else begin perform now() at time zone v_tz; exception when others then errs := errs || format('trip.timezone %s is not a valid IANA zone', v_tz); end;
    end if;
    if coalesce(t->>'metar_station', '') = '' then warns := warns || 'no trip.metar_station: the scoreboard needs an airport within 30 km'::text; end if;
  end if;

  -- Days and stops ---------------------------------------------------------------
  for d in select * from jsonb_array_elements(coalesce(p->'days', '[]')) loop
    begin v_date := (d->>'date')::date; exception when others then v_date := null; end;
    if v_date is null then errs := errs || format('day %s: date must be YYYY-MM-DD', coalesce(d->>'date', '?')); continue; end if;
    if v_start is not null and (v_date < v_start or v_date > v_end) then
      errs := errs || format('day %s is outside the trip (%s to %s)', v_date, v_start, v_end);
    end if;
    for s in select * from jsonb_array_elements(coalesce(d->'stops', '[]')) loop
      if coalesce(s->>'name', '') = '' then errs := errs || format('day %s: a stop has no name', v_date); end if;
      if s->>'lat' is null or s->>'lng' is null then
        warns := warns || format('%s (%s): no coordinates, so no weather, map, drive or sun', s->>'name', v_date);
      elsif jsonb_typeof(s->'lat') <> 'number' or jsonb_typeof(s->'lng') <> 'number'
            or abs((s->>'lat')::float8) > 90 or abs((s->>'lng')::float8) > 180 then
        errs := errs || format('%s (%s): lat/lng must be numbers in range', s->>'name', v_date);
      end if;
      v_label := btrim(coalesce(s->>'time_label', ''));
      if v_label <> '' and v_label !~* '^~?\s*\d{1,2}:\d{2}\s*(AM|PM)$' and v_label !~ '^~?\s*([01]?\d|2[0-3]):[0-5]\d$' then
        errs := errs || format('%s (%s): time_label "%s" must be h:mm AM/PM or HH:MM', s->>'name', v_date, v_label);
      end if;
      if s->>'shot_type' is null then
        warns := warns || format('%s (%s): no shot_type (use logistics for airports, hotels, food)', s->>'name', v_date);
      end if;
    end loop;
  end loop;

  for a in select * from jsonb_array_elements(coalesce(p->'accommodations', '[]')) loop
    if coalesce(a->>'name', '') = '' or a->>'lat' is null or a->>'lng' is null then
      errs := errs || format('accommodation %s: name, lat and lng are required', coalesce(a->>'name', '?'));
    end if;
    begin
      if (a->>'check_out')::date <= (a->>'check_in')::date then
        errs := errs || format('accommodation %s: check_out must be after check_in', a->>'name');
      end if;
    exception when others then errs := errs || format('accommodation %s: check_in / check_out must be YYYY-MM-DD', a->>'name'); end;
  end loop;

  if array_length(errs, 1) > 0 then
    return jsonb_build_object('ok', false, 'written', false, 'errors', to_jsonb(errs), 'warnings', to_jsonb(warns));
  end if;
  if p_dry_run then
    return jsonb_build_object('ok', true, 'written', false, 'dry_run', true, 'warnings', to_jsonb(warns),
      'days', jsonb_array_length(coalesce(p->'days', '[]')),
      'stops', (select count(*) from jsonb_array_elements(coalesce(p->'days', '[]')) x, jsonb_array_elements(coalesce(x->'stops', '[]'))),
      'accommodations', jsonb_array_length(coalesce(p->'accommodations', '[]')));
  end if;

  -- Write ---------------------------------------------------------------------------
  if v_trip is null then
    insert into trips (title, subtitle, start_date, end_date, timezone, metar_station, travelers, archived)
    values (t->>'title', t->>'subtitle', v_start, v_end, v_tz, nullif(t->>'metar_station', ''),
            case when jsonb_typeof(t->'travelers') = 'array' then array(select jsonb_array_elements_text(t->'travelers')) end, false)
    returning id into v_trip;
  end if;

  for a in select * from jsonb_array_elements(coalesce(p->'accommodations', '[]')) loop
    insert into accommodations (trip_id, name, lat, lng, check_in, check_out, nights, booked_via, map_url, lodging_type)
    values (v_trip, a->>'name', (a->>'lat')::float8, (a->>'lng')::float8, (a->>'check_in')::date, (a->>'check_out')::date,
            (a->>'check_out')::date - (a->>'check_in')::date, a->>'booked_via', a->>'map_url', a->>'lodging_type');
    n_acc := n_acc + 1;
  end loop;

  for d in select * from jsonb_array_elements(coalesce(p->'days', '[]')) order by (value->>'date') loop
    v_date := (d->>'date')::date;
    select id into v_day from days where trip_id = v_trip and date = v_date order by day_number limit 1;
    stops_out := coalesce(d->'stops', '[]');
    if v_day is null then
      select coalesce(max(day_number), 0) + 1 into v_dayno from days where trip_id = v_trip;
      insert into days (trip_id, day_number, date, title, subtitle, region)
      values (v_trip, v_dayno, v_date, coalesce(d->>'title', to_char(v_date, 'Dy DD Mon')), d->>'subtitle', d->>'region')
      returning id into v_day;
      n_days := n_days + 1;
      -- The hotel at both ends of a new day, unless a stop is already there.
      if v_hotels then
        select ac.name, ac.lat, ac.lng into h_am from accommodations ac
         where ac.trip_id = v_trip and ac.check_in <= v_date - 1 and ac.check_out > v_date - 1 and ac.lat is not null limit 1;
        select ac.name, ac.lat, ac.lng into h_pm from accommodations ac
         where ac.trip_id = v_trip and ac.check_in <= v_date and ac.check_out > v_date and ac.lat is not null limit 1;
        first_s := stops_out->0; last_s := stops_out -> (jsonb_array_length(stops_out) - 1);
        if h_am.name is not null and (first_s is null or first_s->>'lat' is null
             or gc_km(h_am.lat, h_am.lng, (first_s->>'lat')::float8, (first_s->>'lng')::float8) > 0.5) then
          stops_out := jsonb_build_array(jsonb_build_object('name', h_am.name, 'lat', h_am.lat, 'lng', h_am.lng,
                         'shot_type', 'logistics', 'emoji', '🏨')) || stops_out;
          n_hotel := n_hotel + 1;
        end if;
        if h_pm.name is not null and (last_s is null or last_s->>'lat' is null
             or gc_km(h_pm.lat, h_pm.lng, (last_s->>'lat')::float8, (last_s->>'lng')::float8) > 0.5) then
          stops_out := stops_out || jsonb_build_array(jsonb_build_object('name', h_pm.name, 'lat', h_pm.lat, 'lng', h_pm.lng,
                         'shot_type', 'logistics', 'emoji', '🏨'));
          n_hotel := n_hotel + 1;
        end if;
      end if;
    end if;
    select coalesce(max(position), -1) + 1 into v_pos from stops where day_id = v_day;
    for s in select * from jsonb_array_elements(stops_out) loop
      v_label := nullif(btrim(coalesce(s->>'time_label', '')), '');
      v_m := regexp_match(coalesce(v_label, ''), '^(~?)\s*([01]?\d|2[0-3]):([0-5]\d)$');
      if v_m is not null then
        v_label := v_m[1] || ((v_m[2]::int + 11) % 12 + 1) || ':' || v_m[3] || case when v_m[2]::int < 12 then ' AM' else ' PM' end;
      end if;
      insert into stops (trip_id, day_id, position, name, lat, lng, time_label, duration_minutes, shot_type,
                         time_locked, emoji, info, google_maps_url, alltrails_url, photo_note)
      values (v_trip, v_day, v_pos, s->>'name', (s->>'lat')::float8, (s->>'lng')::float8, v_label,
              (s->>'duration_minutes')::int, s->>'shot_type', coalesce((s->>'time_locked')::boolean, false),
              coalesce(s->>'emoji', '📷'), s->>'info', s->>'google_maps_url', s->>'alltrails_url', s->>'photo_note');
      v_pos := v_pos + 1; n_stops := n_stops + 1;
    end loop;
  end loop;

  return jsonb_build_object('ok', true, 'written', true, 'trip_id', v_trip, 'days', n_days, 'stops', n_stops,
                            'hotel_stops_added', n_hotel, 'accommodations', n_acc, 'warnings', to_jsonb(warns),
                            'next', format('select * from trip_readiness(%L);', v_trip));
end $$;

revoke execute on function public.trip_import(jsonb, boolean) from public, anon, authenticated;
