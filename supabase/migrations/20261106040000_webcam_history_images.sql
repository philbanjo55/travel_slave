-- Phil, 6 Nov 2026: keep copies of the past camera pictures the history reader labelled
-- (webcam-history v3 {save: n}, Storage bucket webcams, history/<code>/<date>/<HH-mm>.jpg).
alter table webcam_history_labels
  add column if not exists image_path text,
  add column if not exists image_bytes integer,
  add column if not exists image_url text,
  add column if not exists save_error text;
