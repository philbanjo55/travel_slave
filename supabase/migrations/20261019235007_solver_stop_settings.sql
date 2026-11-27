-- Solver inputs per stop, kept apart from the app's tables so the app never
-- reads or writes them (no SELECT policy: RLS is on via ensure_rls, so anon
-- sees nothing). Phil's model: the stop is the unit; he rates it with a tier,
-- stars one of its shots, and says which light he wants on that shot.
-- Fog, rain and wind are global penalties in the solver, not settings here.
-- Waterfall stops (stops.shot_type = 'waterfall') get a rained-yesterday bonus.

create table public.solver_stop_settings (
  stop_id uuid primary key references public.stops(id) on delete cascade,
  tier text check (tier in ('GOD','S','A','B','C','D','F')),
  -- The shot whose stand spot + aim point score the light. Null: first shot.
  star_vantage_id uuid references public.scout_vantages(id) on delete set null,
  -- Light on the starred shot, as vantage_light() names it relative to the
  -- camera: front (sun behind you), side, back (into the sun); soft = overcast
  -- or flat light is fine.
  light_wanted text[] check (light_wanted <@ array['front','side','back','soft']),
  -- Booked or fixed-time stops the solver must not move.
  time_locked boolean not null default false,
  -- 'suggested' = pre-filled by Claude from notes/research, 'phil' = confirmed.
  source text not null default 'phil' check (source in ('suggested','phil')),
  note text,
  updated_at timestamptz not null default now()
);

create or replace function public.solver_stop_settings_check() returns trigger
language plpgsql set search_path to 'public' as $$
begin
  if new.star_vantage_id is not null and not exists (
       select 1 from public.stop_sun_pairs where stop_id = new.stop_id and vantage_id = new.star_vantage_id) then
    raise exception 'The starred shot is not on this stop';
  end if;
  new.updated_at := now();
  return new;
end $$;

create trigger solver_stop_settings_check before insert or update on public.solver_stop_settings
for each row execute function public.solver_stop_settings_check();

-- What the solver reads: every stop with its settings resolved (star falls
-- back to the first shot, tier to its weight). Security invoker, so it is as
-- closed as the table underneath.
create or replace view public.solver_stop_inputs with (security_invoker = true) as
select s.id as stop_id, s.trip_id, s.day_id, d.date, s.position, s.name, s.shot_type,
       s.duration_minutes, s.lat, s.lng,
       ss.tier,
       case ss.tier when 'GOD' then 10 when 'S' then 5 when 'A' then 2
                    when 'B' then 1 when 'C' then 1 when 'D' then 0.5 else 0 end::numeric as tier_weight,
       coalesce(ss.star_vantage_id,
                (select p.vantage_id from public.stop_sun_pairs p
                  where p.stop_id = s.id order by p.position, p.created_at limit 1)) as star_vantage_id,
       ss.star_vantage_id is null as star_is_default,
       ss.light_wanted,
       s.shot_type = 'waterfall' as rain_bonus,
       coalesce(ss.time_locked, false) as time_locked,
       coalesce(ss.source, 'unset') as source
  from public.stops s
  left join public.days d on d.id = s.day_id
  left join public.solver_stop_settings ss on ss.stop_id = s.id;
