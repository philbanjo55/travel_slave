-- scout_actions was doing two jobs at once, and it made the todo list useless:
-- 136 open items, of which 55 were not tasks at all but notes that fire when
-- Phil is standing at the subject — which filter to switch to at Tinganes,
-- which of the two Rinkusteinar stones actually rocks, that the Kalsoy 22:35
-- return has to be phoned for before 19:00.
--
-- Those are worth more on the trip than any of the planning items, so they are
-- tagged rather than deleted. 'todo' is what remains between now and May;
-- 'field_note' travels with him.
alter table public.scout_actions
  add column if not exists kind text not null default 'todo';

comment on column public.scout_actions.kind is
  'todo = work to do before the trip. field_note = guidance that fires on site, not a task.';

update public.scout_actions a
set kind = 'field_note'
where a.due_by in (
  'On the day', 'On site', 'Morning of', 'First visit', 'Arrival',
  'Arrival evening', 'Before setting off', 'Before driving', 'Each morning',
  'Every visit', 'Weather call', 'Weather call each morning', 'Kalsoy day',
  'Day before + morning of', 'First Gásadalur visit', 'Context'
);

create index if not exists idx_scout_actions_kind on public.scout_actions (kind, done);
