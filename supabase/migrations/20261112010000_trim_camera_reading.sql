-- Camera reading trimmed (Phil, 11 Nov 2026: "Trim the 10 cameras"): the paid Claude reading stops on the 8 Faroes
-- cameras that were read again since 8 Nov (that question, the Faroes airport rule, was settled 10 Nov) and on the 2
-- Teton resort cameras that do not vote. Pictures are still saved every hour; only the reading is paused
-- (label_paused, as on the other 28 Faroes cameras). Saves about $1 a day of ~$2.90. To read one again: label_paused false.
update webcam_cameras set label_paused = true
 where code in ('F-12', 'F-21', 'F-23-1', 'F-33', 'F-38', 'F-41', 'F-42', 'F-43', 'GT-JHMR-CODYBOWL', 'GT-JHMR-TETONLIFT')
   and not coalesce(label_paused, false);
