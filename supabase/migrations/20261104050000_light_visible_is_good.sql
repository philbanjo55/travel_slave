-- Light rating (Phil, 4 Nov 2026: "if it's clear and I can see the mountains I'm taking the photo, and
-- that goes for most trips if not all of them"; Teton Live 3 Nov: Oxbow / Willow Flats / Swan Lake at
-- 10:35-12:15 were "0 of 6" even on a clear forecast, because midday sun capped them at 0.45 and a good
-- shot needs 0.6). Visible subject in daylight = a good shot; light only ranks good shots (golden hour
-- still 1.0, so the planner still chases it when it can).
--   sun on the subject, wanted direction: < 6 deg 1.0, 6-12 0.9, 12-20 0.8, higher 0.7 (was 1 / .85 / .65 / .45)
--   sun from another direction than wanted: x 0.9 (was x 0.35, or x 0.6 with none wanted)
--   no direction / top / in shadow / overcast (no sun on the subject): 0.6, 0.75 when soft light is wanted
--   (was 0.6 / 0.25 / 0.3 / 0.3)
--   blue hour (sun below the horizon): unchanged.
-- Used by every planner build (solver_build_scores, solver_light_terms / solver_light_scores, replay_build).
create or replace function public.solver_light_dir(p_light text, p_alt real, p_sun_visible boolean, p_lw text[])
returns real language sql immutable set search_path to 'public' as $function$
  select (case
    when p_light in ('front', 'side', 'backlit') then
      (case when p_alt < 6 then 1.0 when p_alt < 12 then 0.9 when p_alt < 20 then 0.8 else 0.7 end)
      * (case when (case p_light when 'backlit' then 'back' else p_light end) = any(p_lw) then 1.0
              when p_lw && '{front,side,back}' then 0.9 else 1.0 end)
      * (case when p_light = 'backlit' and p_sun_visible is false then 0.9 else 1.0 end)
    when p_light in ('no direction', 'top', 'in shadow') then
      case when 'soft' = any(coalesce(p_lw, '{}')) then 0.75 else 0.6 end
    else case when 'soft' = any(coalesce(p_lw, '{}')) then 0.4 else 0.3 end  -- blue hour
  end)::real
$function$;

create or replace function public.solver_light_soft(p_alt real, p_lw text[])
returns real language sql immutable set search_path to 'public' as $function$
  select (case when p_alt >= 0 then (case when 'soft' = any(coalesce(p_lw, '{}')) then 0.75 else 0.6 end)
               else (case when 'soft' = any(coalesce(p_lw, '{}')) then 0.4 else 0.15 end) end)::real
$function$;
