-- Open-Meteo emits {"latitude":nan,...} — not valid JSON — when a model has
-- no grid covering the requested point. That is a useful signal, not an
-- error, so parse defensively and record it as "does not serve this stop".
create or replace function public.try_jsonb(t text)
returns jsonb language plpgsql immutable as $$
begin
  return t::jsonb;
exception when others then
  return null;
end $$;;
