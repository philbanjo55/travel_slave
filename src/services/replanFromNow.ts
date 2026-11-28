import { OnePassStart, startOnePass } from './onePass';

// "Re-plan from now on" (planner redesign option 3, Phil 28 Nov 2026): one request that plans from right now to the
// end of the trip. Today, while stops are left: the rest of today with this hour's camera pictures, then every later
// day around it (one-pass, RPC planner_t_replan_one); once today's stops are over: tomorrow on. Every caller goes
// through here, so the backend's single "from now on" call is a one-line swap.
export function replanFromNow(tripId: string, title?: string): Promise<OnePassStart> {
  return startOnePass(tripId, title);
}
