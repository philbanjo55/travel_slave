-- Phil, 8 Nov 2026: read 8 Faroes cameras (one per trip area) with Claude
-- until the Faroes airport-truth question is settled; the other 28 keep
-- saving pictures unread (label_paused).
update webcam_cameras set label_paused = false
 where code in ('F-23-1','F-41','F-42','F-33','F-12','F-38','F-21','F-43');
