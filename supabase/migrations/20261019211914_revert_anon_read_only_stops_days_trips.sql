-- REVERT of anon_read_only_stops_days_trips. The live app (branch `update`)
-- writes days (checked/review, delete, renumber), trips (archive) and stops
-- (drive_override_minutes, time_label, insert/update/delete) with the anon
-- key; the lock broke those. Policies are neutralised to always-true rather
-- than dropped, so nothing is removed; a restrictive policy of true is a no-op.
do $$
declare t text;
begin
  foreach t in array array['stops','days','trips'] loop
    execute format('alter policy anon_no_insert on public.%I with check (true)', t);
    execute format('alter policy anon_no_update on public.%I using (true)', t);
    execute format('alter policy anon_no_delete on public.%I using (true)', t);
  end loop;
end $$;
