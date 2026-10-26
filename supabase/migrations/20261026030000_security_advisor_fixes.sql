-- Supabase security advisor fixes (Phil, 25 Oct 2026: "review all my security
-- warnings and address"). Nothing here changes what the app (anon key) can do:
-- checked against src/ on branches update and ccr-dba965ff-afy6cz, faroes-web,
-- iceland-web and supabase/functions.
--
-- 1. Views that ran with their owner's rights (security definer views):
--    trip views switch to the caller's rights. latest_weather_per_stop is read
--    by the app, and its tables (weather_forecasts, stops, trips) are fully
--    readable by anon anyway, so the app sees the same rows. The others are
--    backend-only and are also closed to anon / signed-in callers.
--    Not touched: cv, calendar_upcoming, calendar_sunday_sessions, v_print_*
--    (Phil's other projects, not in this repo: asked Phil first).
-- 2. Backend-only SECURITY DEFINER functions that anyone with the public key
--    could call over /rest/v1/rpc: execute revoked from public/anon/
--    authenticated (cron runs them as postgres; triggers are unaffected).
--    Kept callable: the sun-planner RPCs the app uses (sun_pair_link,
--    sun_pair_remove, sun_shot_save, sun_stop_pairs, sun_trip_shots,
--    sun_vantage_set_photo, trip_sun_plan) and claude_spend_summary (TEST app,
--    totals only). sun_pair_save is no longer called by the app: closed.
-- 3. Fixed search_path on functions flagged "role mutable search_path",
--    except small SQL helpers that Postgres inlines into per-row queries (a
--    SET clause stops inlining): weather_display (the app's weather view),
--    solver_realized, sun_code_letter, metar_cloud_pct, metar_visibility_m,
--    gc_km, km_between and the replay_* math helpers. They read no tables
--    (weather_display only formats its input row), so there is nothing to
--    hijack.
-- Left as is: "RLS enabled, no policy" (77 tables, informational: that is the
-- locked-down default, so the public key reads nothing there), and pg_net in
-- the public schema (Supabase-managed; moving it means reinstalling it and
-- breaks every cron job that calls net.http_post).

alter view public.latest_weather_per_stop set (security_invoker = true);
alter view public.model_skill_ranked set (security_invoker = true);
alter view public.stop_cell_map set (security_invoker = true);
alter view public.may_climatology set (security_invoker = true);
alter view public.metar_history_events set (security_invoker = true);
alter view public.metar_climatology set (security_invoker = true);
revoke select on public.model_skill_ranked, public.stop_cell_map, public.may_climatology,
  public.metar_history_events, public.metar_climatology from anon, authenticated;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public'
              and p.proname in ('prune_weather_forecasts', 'rls_auto_enable', 'scout_warm_skyline', 'stop_sun_pairs_warm',
                                'training_autocreate', 'training_trip_roll', 'sun_pair_save') loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
  end loop;

  for f in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.prokind = 'f'
              and p.proname in ('try_jsonb', 'weather_score',
                                'weather_forecasts_stamp_score', 'weather_centre_scores', 'claude_spend_month',
                                'replay_setup', 'replay_fetch_tick', 'replay_fit_hidden', 'replay_build',
                                'replay_enqueue', 'replay_summary', 'replay_tick', 'replay_clear_light', 'replay_mark_light',
                                'replay_runs_setup', 'replay_run_summary', 'replay_run_tick', 'replay_fit_sun', 'replay_fit_sun_step',
                                'refresh_model_grid_points_step', 'refresh_stop_elevations_step', 'weather_model_scores') loop
    execute format('alter function %s set search_path = public, extensions', f.sig);
  end loop;
end $$;
