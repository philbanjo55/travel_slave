-- Worksheet E2 (Phil, 6 Nov 2026): the usual share of daylight hours with the peaks hidden at a place in
-- that part of the year (its month group), from the same counts the odds are learned from (camera vote rows
-- when p_vote), for days past the forecast (solver-replay run config far_hidden).
create or replace function replay_clim_hidden(p_trip uuid, p_date date, p_vote boolean default false)
returns real language sql stable set search_path = public as $$
  select coalesce(
    (select (sum(hits)::real / nullif(sum(n), 0)) from replay_hidden_counts
      where trip_id = p_trip and mg = replay_month_group(p_date) and hb = case when p_vote then 10 else 0 end),
    (select (sum(hits)::real / nullif(sum(n), 0)) from replay_hidden_counts
      where trip_id = p_trip and hb = case when p_vote then 10 else 0 end)) $$;
