-- Glacier View Turnout on the last day was locked at 2:05 PM (from the original
-- itinerary; its own note says MOVABLE). Phil, 27 Oct 2026: "Unlocked. The only
-- thing that's locked is making it to my flight." The planner now places it by
-- the weather like any other stop. Main trip, its Teton Live training copy and the
-- #7 execution-test scratch copy. (JAC arrive / depart stay locked.)
update public.stops set time_locked = false
 where id in ('10c370a1-acfb-46a2-8db0-bf738b304f63',   -- Grand Teton Winter 2026
              '75d5662a-1978-4c23-9e44-977f642f00e4',   -- Teton Live
              '2c219c0d-f3e5-4334-89ad-8b43beddf918')   -- execution test copy
   and name = 'Glacier View Turnout' and time_locked;
