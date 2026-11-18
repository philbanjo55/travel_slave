-- The app talks to the database as anon, which Supabase caps at 3 s per
-- request. Saving a shot builds terrain for new pins (about 1-3 s, more when
-- the database is cold), so saves failed at random and worked on a retry.
-- 15 s matches the app's own timeout for the planner download.
-- Undo: alter role anon set statement_timeout = '3s'; notify pgrst, 'reload config';
alter role anon set statement_timeout = '15s';
notify pgrst, 'reload config';
