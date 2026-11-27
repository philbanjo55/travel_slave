-- TetonCam's live panorama host (images.tetoncam.com) never answers from
-- Supabase; its public Google Cloud archive does, one file per 15 min named
-- by Idaho local time. webcam-archive v13 fills the template.
update public.webcam_cameras
   set image_url = 'https://storage.googleapis.com/tetoncam-images/{YYYY}/{MM}/{DD}/{HHmm}.jpg', active = true
 where code = 'GT-TETONIA';
