-- The aggregate column "n" collided with the function's OUT column "n".
do $$
declare d text;
begin
  d := pg_get_functiondef('public.refresh_model_skill_step(integer)'::regprocedure);
  d := replace(d, 'select model, count(*) n,', 'select model, count(*) cnt,');
  d := replace(d, 'select r.station, model, r.lead, n, round(tmae', 'select r.station, model, r.lead, cnt, round(tmae');
  execute d;
end $$;
