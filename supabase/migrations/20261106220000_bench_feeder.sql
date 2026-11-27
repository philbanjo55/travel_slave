select cron.schedule('bench-feeder', '*/10 * * * *', $job$
  select replay_bench_retry(c) from unnest(array['vp56','cf56','sun56','Tfix56','cons56','pol10v56','farh56','hs56v','blj56','blue56']) c;
  update replay_runs set status = 'queued', updated_at = now()
   where status = 'held' and config->>'name' in ('pol10v56','farh56','hs56v','blj56','blue56')
     and not exists (select 1 from replay_runs where status in ('queued','running') and config->>'name' in ('vp56','cf56','sun56','Tfix56','cons56'));
  select cron.unschedule('bench-feeder')
   where not exists (select 1 from replay_runs where status in ('queued','running','held')
                      and config->>'name' in ('vp56','cf56','sun56','Tfix56','cons56','pol10v56','farh56','hs56v','blj56','blue56'));
$job$);
