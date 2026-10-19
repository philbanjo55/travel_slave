-- The repo is public and ships the anon/publishable key, and stops/days/trips
-- had full_access FOR ALL. A stop delete cascades to stop_photos and the
-- forecast archive. RESTRICTIVE policies are ANDed with the permissive
-- full_access, so anon/authenticated keep SELECT but can no longer write.
-- Edge functions (service role), pg_cron jobs (postgres) and SECURITY DEFINER
-- functions are unaffected. Undo: drop the three policies per table.
do $$
declare t text;
begin
  foreach t in array array['stops','days','trips'] loop
    execute format('create policy anon_no_insert on public.%I as restrictive for insert to anon, authenticated with check (false)', t);
    execute format('create policy anon_no_update on public.%I as restrictive for update to anon, authenticated using (false)', t);
    execute format('create policy anon_no_delete on public.%I as restrictive for delete to anon, authenticated using (false)', t);
  end loop;
end $$;
