-- Tell T (worksheet g4, Phil 10 Nov 2026): notes Phil types on a trip day, read by Claude (edge function t-notes)
-- into rules the planner follows (solver-replay run config tell). A note never changes stops, ticks or stop
-- settings: it only changes what T plans. Status: draft (read, waiting for Phil's OK), asking (Claude asked a
-- question back), active (in force), cleared (deleted by Phil). rules = the planner's rule list (stop ids, HH:MM
-- in the trip's time zone, dates), say = the plain-words lines shown before the OK, info = what T can't use.
create table if not exists public.t_notes (
  id          bigint generated always as identity primary key,
  trip_id     uuid not null references public.trips(id) on delete cascade,
  created_at  timestamptz not null default now(),
  typed_on    date not null,
  text        text not null,
  source      text not null default 'typed' check (source in ('typed', 'quick')),
  status      text not null default 'draft' check (status in ('draft', 'asking', 'active', 'cleared')),
  rules       jsonb not null default '[]'::jsonb,
  say         jsonb not null default '[]'::jsonb,
  info        jsonb not null default '[]'::jsonb,
  ask         jsonb,
  from_date   date,
  to_date     date,
  cost_usd    numeric,
  model       text,
  saved_at    timestamptz,
  cleared_at  timestamptz
);
create index if not exists t_notes_trip_status on public.t_notes (trip_id, status);
alter table public.t_notes enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 't_notes' and policyname = 'app_read') then
    create policy app_read on public.t_notes for select using (true);
  end if;
end $$;
