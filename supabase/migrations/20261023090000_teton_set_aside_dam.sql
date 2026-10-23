-- Phil, 23 Oct 2026: take out Jackson Lake Dam (Teton day 4). Set aside (no
-- day, no tier), real trip and Teton Live; Colter Bay follows Willow Flats.
update stops set day_id = null, position = 0 where id in ('f64e9190-14bb-4d8c-95d3-9e011f4cde48', '18eb14c7-ffe6-4e41-aff2-0e45f33c7a57');
update solver_stop_settings set tier = null, source = 'phil', note = 'Removed from the trip by Phil, 23 Oct 2026 (unscheduled, kept for its notes)'
 where stop_id in ('f64e9190-14bb-4d8c-95d3-9e011f4cde48', '18eb14c7-ffe6-4e41-aff2-0e45f33c7a57');
update stops set position = 6, drive_override_minutes = 13 where id in ('f3240a23-baea-419e-af8c-957b1c713d2f', 'e2177d94-5f77-42f5-9adc-45d73608fe52');
update stops set position = 7 where id in ('8a32f2d1-4fa3-4662-9ec3-52c84f9359ff', 'ef208b7c-e88d-4045-ba37-bf9a42abc824');
