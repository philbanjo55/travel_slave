-- The model list, moved out of the edge function so a new trip in a new
-- region needs a row, not a redeploy.
--
-- NOTE on scope: 'regional' vs 'global' is only a hint used to avoid
-- pointless requests. Whether a model actually serves a given stop is
-- MEASURED, not declared — see model_grid_points.has_data. Remembered
-- bounding boxes go stale; a probe does not.
create table if not exists public.weather_models (
  model          text primary key,
  centre         text not null,
  label          text not null,
  resolution_km  numeric,
  scope          text not null check (scope in ('global','regional')),
  is_blend       boolean not null default false,
  blend_note     text,
  serves_cloud_base boolean not null default false,
  active         boolean not null default true,
  sort_order     integer not null default 100,
  notes          text
);

alter table public.weather_models enable row level security;
do $$
begin
  if not exists (select 1 from pg_policy p join pg_class c on c.oid=p.polrelid
                 join pg_namespace n on n.oid=c.relnamespace
                 where n.nspname='public' and c.relname='weather_models'
                   and p.polname='full_access') then
    create policy full_access on public.weather_models
      for all using (true) with check (true);
  end if;
end $$;

insert into public.weather_models
  (model, centre, label, resolution_km, scope, is_blend, blend_note, serves_cloud_base, sort_order, notes)
values
  ('dmi_harmonie_arome_europe','DMI/KNMI HARMONIE','DMI HARMONIE AROME',2,'regional',false,null,true,10,
   'UWC-West DINI. Denmark and the Netherlands run ONE shared model; this and knmi_harmonie_arome_europe are the same run under two labels. ~70h horizon.'),
  ('dmi_seamless','DMI/KNMI HARMONIE','DMI seamless',2,'regional',true,'HARMONIE inside ~70h, then ECMWF',true,11,null),
  ('knmi_harmonie_arome_europe','DMI/KNMI HARMONIE','KNMI HARMONIE AROME',2,'regional',false,null,true,12,
   'Same DINI run as DMI. Not an independent opinion.'),
  ('metno_seamless','MET Norway','MET Norway',25,'global',true,'MEPS where it reaches, ECMWF elsewhere',false,20,
   'MEPS does not cover the Faroes, so at 62N this is ECMWF-derived, not a local model.'),
  ('ukmo_seamless','UK Met Office','UKMO seamless',10,'global',true,'UKV over the UK, UKMO global elsewhere',true,30,null),
  ('ukmo_global_deterministic_10km','UK Met Office','UKMO global 10km',10,'global',false,null,true,31,null),
  ('icon_eu','DWD ICON','ICON-EU',7,'regional',false,null,true,40,
   'Strongest independent European model after HARMONIE. ~5 day horizon.'),
  ('icon_seamless','DWD ICON','ICON seamless',7,'global',true,'ICON-D2/EU/global blended',true,41,null),
  ('icon_global','DWD ICON','ICON global',13,'global',false,null,false,42,null),
  ('ecmwf_ifs025','ECMWF','ECMWF IFS',25,'global',false,null,false,50,
   'The benchmark global model and the long-horizon backbone. Serves no visibility.'),
  ('ecmwf_aifs025_single','ECMWF AIFS','ECMWF AIFS (ML)',25,'global',false,null,false,51,
   'Machine-learning model. Genuinely different failure modes from physics models, which is why it is worth keeping separate from ECMWF IFS.'),
  ('gfs_seamless','NOAA GFS','NOAA GFS',13,'global',true,'HRRR/GFS blended',true,60,null),
  ('gem_seamless','Env. Canada','GEM seamless',15,'global',true,null,false,70,null),
  ('gem_global','Env. Canada','GEM global',15,'global',false,null,false,71,null),
  ('meteofrance_seamless','Meteo-France','Meteo-France seamless',25,'global',true,'AROME over France, ARPEGE elsewhere',false,80,null),
  ('meteofrance_arpege_europe','Meteo-France','ARPEGE Europe',11,'regional',false,null,false,81,null),
  ('jma_seamless','JMA','JMA',55,'global',true,null,false,90,
   'Coarse, but a genuinely independent centre. Serves no gusts.'),
  ('cma_grapes_global','CMA','CMA GRAPES',15,'global',false,null,true,95,null)
on conflict (model) do nothing;;
