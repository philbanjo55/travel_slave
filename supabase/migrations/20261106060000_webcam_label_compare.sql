-- Worksheet F1 (Phil, 6 Nov 2026): Haiku vs Opus camera labels on the saved past pictures.
create table if not exists webcam_label_compare (
  camera_code text not null, taken_at timestamptz not null, model text not null,
  status text, served_model text, label text, hills_visible boolean, cloud_on_hills text, sun_on_land boolean,
  confidence real, note text, error text, cost_usd real, updated_at timestamptz default now(),
  primary key (camera_code, taken_at, model));
-- Next saved, Opus-labelled frames not yet labelled by p_model: spread over cameras and both winters.
create or replace function webcam_compare_next(p_model text, p_n int)
returns table (camera_code text, taken_at timestamptz, local_time text, image_path text)
language sql set search_path = public as $$
  select h.camera_code, h.taken_at, h.local_time, h.image_path
    from webcam_history_labels h
   where h.status = 'done' and h.image_path is not null and h.hills_visible is not null
     and not exists (select 1 from webcam_label_compare c where c.camera_code = h.camera_code and c.taken_at = h.taken_at and c.model = p_model)
   order by md5(h.camera_code || h.taken_at::text) limit p_n $$;
revoke all on function webcam_compare_next(text, int) from anon, authenticated;
