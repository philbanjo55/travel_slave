-- Phil, 6 Nov 2026: read the Jackson Hole resort cameras' past winter pictures (the resort says past pictures
-- are public and fine to use) so past winters get a camera vote, all at once; and stop paying Claude to read
-- the 7 Faroes cameras until spring (their pictures are still saved; only the off-season practice trip uses them).

alter table webcam_cameras add column if not exists label_paused boolean not null default false;
alter table webcam_cameras add column if not exists history_url text;

update webcam_cameras set label_paused = true where region = 'Faroe Islands' and active;

update webcam_cameras set history_url = 'https://storage2.roundshot.com/5bb001fbc12a96.62099523/{YYYY}-{MM}-{DD}/{HH}-{mm}-00/{YYYY}-{MM}-{DD}-{HH}-{mm}-00_quarter.jpg'
 where code = 'GT-JHMR-SUMMIT';
update webcam_cameras set history_url = 'https://storage4.roundshot.com/57d49b814370e9.88473849/{YYYY}-{MM}-{DD}/{HH}-{mm}-00/{YYYY}-{MM}-{DD}-{HH}-{mm}-00_quarter.jpg'
 where code = 'GT-JHMR-RENDEZVOUS';

-- Hourly 08:00-16:00 Jackson time, 1 Dec - 31 Jan of both bench winters (as done for TetonCam).
insert into webcam_history_labels (camera_code, taken_at, local_time, status)
select c.code, (d + make_interval(hours => h)) at time zone 'America/Denver', to_char(d + make_interval(hours => h), 'YYYY-MM-DD HH24:MI'), 'queued'
  from unnest(array['GT-JHMR-SUMMIT', 'GT-JHMR-RENDEZVOUS']) c(code)
  cross join (select generate_series(date '2024-12-01', date '2025-01-31', interval '1 day')::timestamp d
              union all select generate_series(date '2025-12-01', date '2026-01-31', interval '1 day')::timestamp) dd
  cross join generate_series(8, 16) h
on conflict do nothing;
