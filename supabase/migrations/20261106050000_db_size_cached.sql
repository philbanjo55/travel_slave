-- Worksheet C3 (Phil, 6 Nov 2026): the bench tick read pg_database_size (~0.9 s) on every 20-s tick,
-- once per candidate day inside a loop. Read it at most once an hour instead.
create table if not exists db_size_cache (id int primary key default 1, bytes bigint not null, at timestamptz not null);
create or replace function db_size_cached() returns bigint language plpgsql set search_path = public as $$
declare b bigint; t timestamptz;
begin
  select bytes, at into b, t from db_size_cache where id = 1;
  if b is null or t < now() - interval '1 hour' then
    b := pg_database_size(current_database());
    insert into db_size_cache (id, bytes, at) values (1, b, now())
      on conflict (id) do update set bytes = excluded.bytes, at = excluded.at;
  end if;
  return b;
end $$;
revoke all on function db_size_cached() from anon, authenticated;
