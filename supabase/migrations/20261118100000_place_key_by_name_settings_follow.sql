-- Repeat visits of one place stay the same everywhere (Phil, 18 Nov 2026: "If I save on one stop, it should save
-- automatically??").
-- 1. "Same place" is the stop's name only. stop_place_key used the photo group first, but photo groups also join
--    different places that only share photos (Chapel of the Transfiguration + Menor's Ferry, the two Moulton barns +
--    Antelope Flats, the two Drangarnir boats, Bøur's viewpoints), so a shot added or starred at one of them would
--    have been copied to the other. Checked 18 Nov: no such copy had happened yet (each kept its own shots).
-- 2. Stop settings follow too: tier, light wanted, fog wanted and "fine under cloud" (needs_peaks) saved on one visit
--    copy to the other visits of the same place in the same trip. A set-aside visit (tier null) is never set aside or
--    brought back by it; only visits that have a tier take a new tier.
create or replace function public.stop_place_key(p_stop uuid)
 returns text
 language sql
 stable
 set search_path to 'public'
as $$
  select 'name:' || lower(trim(name)) from stops where id = p_stop
$$;

create or replace function public.solver_settings_mirror()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_trip uuid; v_key text;
begin
  if coalesce(current_setting('pf.pairs_mirror', true), '') = 'off' then return null; end if;
  if (new.tier, new.light_wanted, new.fog_wanted, new.needs_peaks) is not distinct from
     (old.tier, old.light_wanted, old.fog_wanted, old.needs_peaks) then return null; end if;
  select trip_id into v_trip from stops where id = new.stop_id;
  v_key := stop_place_key(new.stop_id);
  if v_trip is null or v_key is null then return null; end if;
  perform set_config('pf.pairs_mirror', 'off', true);
  update solver_stop_settings ss
     set tier = case when new.tier is not null and ss.tier is not null then new.tier else ss.tier end,
         light_wanted = new.light_wanted, fog_wanted = new.fog_wanted, needs_peaks = new.needs_peaks,
         source = case when new.source = 'phil' then 'phil' else ss.source end
    from stops s
   where s.trip_id = v_trip and s.id <> new.stop_id and stop_place_key(s.id) = v_key and ss.stop_id = s.id
     and (ss.tier, ss.light_wanted, ss.fog_wanted, ss.needs_peaks) is distinct from
         (case when new.tier is not null and ss.tier is not null then new.tier else ss.tier end, new.light_wanted, new.fog_wanted, new.needs_peaks);
  perform set_config('pf.pairs_mirror', '', true);
  return null;
end $$;

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'solver_settings_mirror' and tgrelid = 'public.solver_stop_settings'::regclass) then
    create trigger solver_settings_mirror after update of tier, light_wanted, fog_wanted, needs_peaks on public.solver_stop_settings
      for each row execute function public.solver_settings_mirror();
  end if;
end $$;
