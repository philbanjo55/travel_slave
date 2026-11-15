"""A TEST COPY of solver-replay for the one-pass bench (never deploy it): light-only rows of pruned past dates come
from LIGHT_DIR files (light_fetch.py; the weekly solver-light-prune removes past dates from solver_light_cache), and
the drive matrix is kept per trip in the isolate (a Faroes request paged it 8 times). Plans are unchanged.
usage: make_test_copy.py <solver-replay dir> <out dir>   (then start.sh with LIGHT_DIR=... set)"""
import sys, os, shutil
src, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
shutil.copy(os.path.join(src, 't2.ts'), out)
s = open(os.path.join(src, 'index.ts')).read()
old = "return all<any>((a, b) => db.rpc('solver_light_terms', { p_trip_id: tripId, p_dates: [date] }).order('slot_at').order('stop_id').range(a, b))"
assert s.count(old) == 1
s = s.replace(old, "return (LOCAL_LIGHT(tripId, date) ?? all<any>((a, b) => db.rpc('solver_light_terms', { p_trip_id: tripId, p_dates: [date] }).order('slot_at').order('stop_id').range(a, b)))")
old = """    const dm = await all<any>((a, b) => db.from('solver_drive_matrix').select('from_stop_id, to_stop_id, minutes')
      .eq('trip_id', tripId).in('from_stop_id', ids).in('to_stop_id', ids).range(a, b));"""
assert s.count(old) == 1
s = s.replace(old, """    const dmKey = tripId + '|' + ids.join(',');
    const dm = DM_CACHE.get(dmKey) ?? await all<any>((a, b) => db.from('solver_drive_matrix').select('from_stop_id, to_stop_id, minutes')
      .eq('trip_id', tripId).in('from_stop_id', ids).in('to_stop_id', ids).range(a, b));
    DM_CACHE.set(dmKey, dm);""")
s = s.replace("const DEFAULTS = {", """// TEST COPY ONLY (tools/one_pass/make_test_copy.py).
const DM_CACHE = new Map<string, any[]>();
const LOCAL_LIGHT = (trip: string, date: string): Promise<any[]> | null => {
  const dir = Deno.env.get('LIGHT_DIR'); if (!dir) return null;
  try { return Promise.resolve(JSON.parse(Deno.readTextFileSync(`${dir}/${trip}_${date}.json`))); } catch { return null; }
};
const DEFAULTS = {""", 1)
open(os.path.join(out, 'index.ts'), 'w').write(s)
print('test copy in', out)
