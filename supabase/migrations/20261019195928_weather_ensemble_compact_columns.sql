-- Free plan: real[] members made ~1.6 MB per pull (~355 MB by May). New pulls
-- write value x 10 into smallint[] columns instead. The real[] columns stay
-- for the first test pull only and are NULL from now on (no space used).
alter table public.weather_ensemble
  add column if not exists temp_c10 smallint[],
  add column if not exists dew_c10 smallint[],
  add column if not exists wind_kmh10 smallint[],
  add column if not exists gust_kmh10 smallint[],
  add column if not exists precip_mm10 smallint[];
comment on table public.weather_ensemble is
  'Nightly ensemble archive (weather-ensemble-pull). Arrays are members, element 1 = control (Postgres arrays are 1-based). *_c10, *_kmh10, *_mm10 are value x 10 (temp, dew, wind, gust, precip real[] columns are legacy, first test pull only). vis and cloud_base in metres.';
