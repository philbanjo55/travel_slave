-- Fog is a global penalty in the solver; fog_wanted flips it to a bonus for
-- stops whose shot needs it (fog in the gorge, standing above the cloud).
alter table public.solver_stop_settings add column fog_wanted boolean not null default false;
comment on column public.solver_stop_settings.fog_wanted is 'Fog is a global penalty; true flips it to a bonus for this stop (fog-in-the-gorge, above-the-cloud shots).';

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
       coalesce(ss.source, 'unset') as source,
       coalesce(ss.fog_wanted, false) as fog_wanted
  from public.stops s
  left join public.days d on d.id = s.day_id
  left join public.solver_stop_settings ss on ss.stop_id = s.id;
