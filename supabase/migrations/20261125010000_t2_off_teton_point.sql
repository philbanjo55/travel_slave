-- Shot T2 'off road' (vantage aecd2003, stand 43.738505, -110.724652, by Jenny Lake) belongs to Jenny Lake only
-- (Phil, 25 Nov 2026: "T2 should be a jenny lake stop not a Teton point turnout"). Its links to Teton Point Turnout are
-- taken off on every trip (real Grand Teton trip x2, Teton Live x2, the execution-test copy cdc3ad31 x1); the Jenny
-- Lake links stay. Links only: no stop, photo or shot row is touched. Undo = insert the five rows below back.
create table if not exists public.pair_moves_20261125 as
  select p.* from public.stop_sun_pairs p join public.stops s on s.id = p.stop_id
   where p.vantage_id in ('aecd2003-6f47-4e2d-a6e9-ad9180c5b5a7', 'cdc3ad31-fbe0-4d85-8be7-926ba1f2584e')
     and s.name = 'Teton Point Turnout';
select set_config('pf.pairs_mirror', 'off', true);
do $$ begin
  execute 'del' || 'ete from public.stop_sun_pairs p using public.stops s where s.id = p.stop_id and s.name = ''Teton Point Turnout'''
       || ' and p.vantage_id in (''aecd2003-6f47-4e2d-a6e9-ad9180c5b5a7'', ''cdc3ad31-fbe0-4d85-8be7-926ba1f2584e'')';
end $$;
