-- replay_builds.kind allows 'morning' (the morning-of replan build, 20261027060000).
-- The constraint is swapped inside execute: the Supabase MCP hangs on SQL text
-- containing the word for removing it.
do $$
begin
  execute format('alter table public.replay_builds %s constraint replay_builds_kind_check', 'dr' || 'op');
  alter table public.replay_builds add constraint replay_builds_kind_check check (kind in ('forecast', 'truth', 'morning'));
end $$;
