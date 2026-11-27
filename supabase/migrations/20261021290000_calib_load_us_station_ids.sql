-- Iowa Mesonet names US stations without the leading K (JAC for KJAC), so
-- calib_load_history matched no lines for KJAC. Accept both.
do $do$
declare d text := pg_get_functiondef('public.calib_load_history'::regproc); n text;
begin
  n := replace(d,
$a$         where l like q.site || ',%'$a$,
$b$         where l like q.site || ',%' or (q.site ~ '^K[A-Z0-9]{3}$' and l like substr(q.site, 2) || ',%')$b$);
  if n = d then raise exception 'calib_load_history text not matched'; end if;
  execute n;
end $do$;

-- Loaded 21 Oct 2026: KJAC METAR Dec 2016-2025 + Jan 2017-2026 (calib_queue_month,
-- two at a time), ECMWF archive Dec 2024/2025 + Jan 2025/2026; fitted with
-- solver_fit_calibration_months('KJAC', 'history_winter', '{12,1}').
