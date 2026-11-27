-- Find my spot progress (27 Nov 2026, DRAFT: not applied yet).
-- The worker (tools/sun3d/photospot/job.py) posts where its search is to photo-spot action 'step'; the function keeps
-- the newest step here while the job is 'solving': {key: terrain | search | check | refine | lenses, done, of,
-- attempt, attempts, at}. The app's status call returns the whole row, so it reads it from there; old jobs have null.
-- Order: apply this before deploying the new photo-spot function (either order is safe: the function's two writes to
-- this column are on their own and their errors are ignored; without the column the app shows the status steps only).
alter table public.photo_spot_jobs add column if not exists progress jsonb;
