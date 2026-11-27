-- Worksheet C1 (Phil, 6 Nov 2026): a SET search_path stops Postgres from inlining these one-line SQL
-- helpers, so every planner build called them row by row (the deep dive measured 69% of database
-- time). Their bodies use only built-ins, so the setting does nothing for safety. Same bodies, same
-- answers (fingerprint md5 dbb2898f... over 11,928 inputs before and after).
alter function solver_light_dir(text, real, boolean, text[]) reset search_path;
alter function solver_light_soft(real, text[]) reset search_path;
