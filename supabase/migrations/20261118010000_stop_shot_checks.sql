-- Shots checked off at a stop (Phil, 18 Nov 2026: "hold down / grey out for done", hold again to undo). One row per stop
-- and shot = done. Phil's own checklist only: the planner never reads it (the stop's Missed / Go back / Nailed is what
-- counts). Kept per stop, not per shot, because a shot (scout_vantages row) is shared by the real trip and its practice copy.
create table if not exists public.stop_shot_checks (
  stop_id uuid not null references public.stops(id) on delete cascade,
  vantage_id uuid not null references public.scout_vantages(id) on delete cascade,
  done_at timestamptz not null default now(),
  primary key (stop_id, vantage_id)
);
alter table public.stop_shot_checks enable row level security;
-- the app reads and writes it with the public key, like stops and stop_photos
drop policy if exists app_read on public.stop_shot_checks;
create policy app_read on public.stop_shot_checks for select to anon, authenticated using (true);
drop policy if exists app_write on public.stop_shot_checks;
create policy app_write on public.stop_shot_checks for insert to anon, authenticated with check (true);
drop policy if exists app_undo on public.stop_shot_checks;
create policy app_undo on public.stop_shot_checks for delete to anon, authenticated using (true);
grant select, insert, delete on public.stop_shot_checks to anon, authenticated;
