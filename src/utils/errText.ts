// Plain words for any thrown value. Supabase errors are plain objects, and a failed request can
// come back as a JSON body with no `message` (the read-only emulator test's 403 {ok, error}), so
// String(e) printed "[object Object]" on the Plans tab (emulator test, 9 Nov 2026).
export function errText(e: unknown, fallback = 'Something went wrong. Try again in a minute.'): string {
  if (e == null) return fallback;
  if (typeof e === 'string') return e || fallback;
  const o = e as any;
  for (const k of ['message', 'error_description', 'error', 'details', 'hint']) {
    const v = o?.[k];
    if (typeof v === 'string' && v.trim()) return v;
    if (v && typeof v === 'object' && typeof v.message === 'string' && v.message.trim()) return v.message;
  }
  const s = String(e);
  return s && s !== '[object Object]' ? s : fallback;
}
