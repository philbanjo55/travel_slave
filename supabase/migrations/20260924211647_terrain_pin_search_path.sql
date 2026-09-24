-- Pin search_path on the terrain/sun functions (Supabase security advisor),
-- and retire the Open-Meteo queue cron from scout_terrain_and_sun.
alter function public.dem_cell(double precision, double precision) set search_path = public;
alter function public.dem_elevation(double precision, double precision) set search_path = public;
alter function public.geo_bearing(double precision, double precision, double precision, double precision) set search_path = public;
alter function public.geo_distance_m(double precision, double precision, double precision, double precision) set search_path = public;
alter function public.compass_point(double precision) set search_path = public;
alter function public.terrain_distances() set search_path = public;
alter function public.terrain_sample_coord(double precision, double precision, double precision, double precision) set search_path = public;
alter function public.terrain_horizon(uuid, double precision) set search_path = public;
alter function public.horizon_at(double precision[], double precision) set search_path = public;
alter function public.sun_position(timestamptz, double precision, double precision) set search_path = public;
alter function public.vantage_light(uuid, date, integer, text) set search_path = public;
select cron.unschedule(jobid) from cron.job where jobname = 'terrain-refresh';
