// Tell T: what a note would cost. The rest of the trip is planned twice from light only (as the week draft is):
// as things stand, and with the note's rules added; planner_t_whatif_result compares the two and removes them.
// The runs are driven from here, one planner step at a time (status 'whatif': the scheduler leaves them alone).
// deno-lint-ignore no-explicit-any
export async function whatIf(db: any, tripId: string, rules: unknown[], solverUrl: string, headers: Record<string, string>, force = false) {
  const { data: st, error } = await db.rpc('planner_t_whatif_start', { p_trip: tripId, p_rules: rules, p_force: force });
  if (error || !st?.ok) return { status: 'none', why: error?.message ?? st?.error ?? 'could not start' };
  const drive = async (run: number) => {
    let fails = 0;
    for (let i = 0; i < st.nights * 6 + 6; i++) {
      const res = await fetch(solverUrl, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ run_id: run, kind: 'mrmc' }) });
      await res.text();
      if (!res.ok && ++fails > 3) return false;
      const { data: sp } = await db.rpc('planner_t_whatif_step', { p_run: run });
      if (sp?.done) return true;
    }
    return false;
  };
  const [a, b] = await Promise.all([drive(st.a), drive(st.b)]);
  const { data: out, error: e2 } = await db.rpc('planner_t_whatif_result', { p_a: st.a, p_b: st.b });
  if (e2 || !out?.ok) return { status: 'none', why: e2?.message ?? out?.error ?? 'could not compare' };
  return { status: a && b ? 'done' : 'partial', nights: st.nights, ...out };
}

// The lines Phil sees under the preview: what the note would make T give up, in plain words.
// deno-lint-ignore no-explicit-any
export function costLines(c: any): string[] {
  if (!c || (c.status !== 'done' && c.status !== 'partial')) return [];
  const L: string[] = [], list = (a: string[]) => a.length <= 1 ? (a[0] ?? '') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`;
  const lost = [...new Set([...(c.lost ?? []), ...(c.dropped ?? [])])] as string[];
  if (lost.length) L.push(`With this note the rest of the trip loses ${list(lost)}.`);
  for (const x of (c.cannot ?? []).slice(0, 4)) L.push(`Can't be done as asked: ${x.what}.`);
  if ((c.no_route ?? []).length) L.push(`T found no workable day on ${(c.no_route as string[]).join(', ')} with this note.`);
  if (!L.length) L.push(Object.keys(c.by_day ?? {}).length ? 'Nothing is lost: T just moves things around.' : 'No change to the days after today.');
  return L;
}
