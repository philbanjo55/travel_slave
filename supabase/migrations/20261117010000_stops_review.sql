-- Stops page marks (Phil, 17 Nov 2026): long-press a place on the Stops page, like the day tabs: green = reviewed /
-- good to go (stops.checked, already there and unused), yellow = working on it (stops.review, new). A place with
-- repeat visits marks every visit. The app writes them with the public key, as it writes days.checked / review.
alter table public.stops add column if not exists review boolean not null default false;
