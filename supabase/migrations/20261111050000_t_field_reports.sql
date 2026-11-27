-- Tell T, word from the field, part 1 of 2: new things only (worksheet g4; Phil, 10 Nov 2026: "I wanna be able to
-- give weather reports in the field too"). Nothing existing changes here; part 2 (docs/solver/pending/20261111060000_t_field_reports_live.sql) has the two edits
-- to live functions (t_truth, replay_run_tick) and waits for Phil's OK.
--  t_reports: what Phil says the sky is doing where he is ("peaks are out", "socked in"). t_truth puts his word for
--    that hour above the cameras (key a; cam_a = the cameras' own majority, phil = his word), so it is the look for
--    a Re-plan now and the truth the day check uses for that hour.
--  planner_t_now.here: where Phil really is, sent with a Re-plan now request ({stop_id?, late_min?, stay_min?,
--    sky?}); planner_t_now_here(trip, here) queues the request with it (backend only), and the tick passes it on
--    and skips the wait for camera pictures.
--  t_notes.now: what a note said about right now; such a note is 'done' once sent (it holds no lasting rule).
create table if not exists public.t_reports (
  id         bigint generated always as identity primary key,
  trip_id    uuid not null references public.trips(id) on delete cascade,
  at         timestamptz not null default now(),
  sky        text not null check (sky in ('out', 'hidden', 'mixed')),
  place      text,
  text       text,
  note_id    bigint references public.t_notes(id) on delete set null,
  void       boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists t_reports_trip_at on public.t_reports (trip_id, at);
alter table public.t_reports enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 't_reports' and policyname = 'app_read') then
    create policy app_read on public.t_reports for select using (true);
  end if;
end $$;

alter table public.t_notes add column if not exists now jsonb;
-- recap: what a note said happened at places (proposed ticks, set only after Phil's OK); answer: T's answer to a
-- question (Ask T: a note that changes nothing).
alter table public.t_notes add column if not exists recap jsonb;
alter table public.t_notes add column if not exists answer jsonb;
alter table public.t_notes drop constraint if exists t_notes_status_check;
alter table public.t_notes add constraint t_notes_status_check check (status in ('draft', 'asking', 'active', 'cleared', 'done', 'answer'));
alter table public.planner_t_now add column if not exists here jsonb;

create or replace function public.planner_t_now_here(p_trip uuid, p_here jsonb)
 returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare v jsonb;
begin
  v := planner_t_now(p_trip);
  if coalesce((v ->> 'ok')::boolean, false) and p_here is not null then
    update planner_t_now set here = p_here where id = (v ->> 'id')::bigint and status = 'queued';
    if not found then return jsonb_build_object('ok', false, 'error', 'T is already re-planning: try again in a minute'); end if;
  end if;
  return v;
end $function$;
revoke all on function public.planner_t_now_here(uuid, jsonb) from public, anon, authenticated;
