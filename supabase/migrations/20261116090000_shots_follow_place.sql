-- Phil, 16 Nov 2026 ("Sure"): a shot added to, deleted from or starred on one visit of a place does the same on every
-- other visit of that place in the same trip. Before, each visit kept its own shot list, so deleting "your 6x9 spot"
-- on Snake River Overlook's Day 1 visit left it on Day 2 and Day 7, and a Find-spot shot landed on one visit only.
-- Same place = same trip and the same photo_group (how repeat visits already share photos), else the same name.
-- Works for the app, photo_spot_add_shot, solver_apply_plan and training_sync alike (they all write stop_sun_pairs).
-- Session flag pf.pairs_mirror = 'off' while mirroring, so the mirrored writes don't mirror again.

create or replace function public.stop_place_key(p_stop uuid)
returns text language sql stable set search_path = public as $$
  select coalesce(nullif(photo_group, ''), 'name:' || lower(trim(name))) from stops where id = p_stop
$$;

create or replace function public.stop_sun_pairs_mirror()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_trip uuid; v_key text;
begin
  if coalesce(current_setting('pf.pairs_mirror', true), '') = 'off' then return null; end if;
  if tg_op = 'INSERT' then
    select trip_id into v_trip from stops where id = new.stop_id;
    v_key := stop_place_key(new.stop_id);
    if v_trip is null or v_key is null then return null; end if;
    perform set_config('pf.pairs_mirror', 'off', true);
    insert into stop_sun_pairs (stop_id, vantage_id, position)
    select s.id, new.vantage_id, coalesce((select max(p.position) + 1 from stop_sun_pairs p where p.stop_id = s.id), 0)
      from stops s
     where s.trip_id = v_trip and s.id <> new.stop_id and stop_place_key(s.id) = v_key
    on conflict do nothing;
    perform set_config('pf.pairs_mirror', '', true);
  else
    -- a stop or a shot being removed altogether (cascade) is not a "delete this shot from the place"
    if not exists (select 1 from stops where id = old.stop_id) or not exists (select 1 from scout_vantages where id = old.vantage_id) then
      return null;
    end if;
    select trip_id into v_trip from stops where id = old.stop_id;
    v_key := stop_place_key(old.stop_id);
    perform set_config('pf.pairs_mirror', 'off', true);
    delete from stop_sun_pairs p
     using stops s
     where s.trip_id = v_trip and s.id <> old.stop_id and stop_place_key(s.id) = v_key
       and p.stop_id = s.id and p.vantage_id = old.vantage_id;
    perform set_config('pf.pairs_mirror', '', true);
  end if;
  return null;
end $$;

create trigger stop_sun_pairs_mirror
after insert or delete on public.stop_sun_pairs
for each row execute function public.stop_sun_pairs_mirror();

-- Starring: only visits that already have a starred shot follow (a visit left without a star keeps none).
create or replace function public.solver_star_mirror()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_trip uuid; v_key text;
begin
  if coalesce(current_setting('pf.pairs_mirror', true), '') = 'off' then return null; end if;
  if new.star_vantage_id is null or new.star_vantage_id is not distinct from old.star_vantage_id then return null; end if;
  select trip_id into v_trip from stops where id = new.stop_id;
  v_key := stop_place_key(new.stop_id);
  if v_trip is null or v_key is null then return null; end if;
  perform set_config('pf.pairs_mirror', 'off', true);
  update solver_stop_settings ss set star_vantage_id = new.star_vantage_id
    from stops s
   where s.trip_id = v_trip and s.id <> new.stop_id and stop_place_key(s.id) = v_key
     and ss.stop_id = s.id and ss.star_vantage_id is not null and ss.star_vantage_id <> new.star_vantage_id
     and exists (select 1 from stop_sun_pairs p where p.stop_id = s.id and p.vantage_id = new.star_vantage_id);
  perform set_config('pf.pairs_mirror', '', true);
  return null;
end $$;

create trigger solver_star_mirror
after update of star_vantage_id on public.solver_stop_settings
for each row execute function public.solver_star_mirror();

revoke all on function public.stop_sun_pairs_mirror() from public, anon, authenticated;
revoke all on function public.solver_star_mirror() from public, anon, authenticated;
