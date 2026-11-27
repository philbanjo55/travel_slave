-- Undone the same day (Phil, 9 Nov 2026: test and decide first). The 10 cameras are back on the API
-- labeller; the session functions stay for the side-by-side test; scheduled task
-- "Camera labels (Claude session)" is switched off.
update public.webcam_cameras set label_by = 'api', label_paused = false where label_by = 'session';
