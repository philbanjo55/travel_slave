select cron.schedule('model-skill-refresh', '*/10 * * * *', $$select public.refresh_model_skill_step();$$);
