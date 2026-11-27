// Plain words for any thrown value. Supabase errors are plain objects, and a failed request can
// come back as a JSON body with no `message` (the read-only emulator test's 403 {ok, error}), so
// String(e) printed "[object Object]" on the Plans tab (emulator test, 9 Nov 2026).
// No signal (27 Nov 2026, emulator no-signal test): Android's fetch says "fetch failed: java.net.UnknownHostException:
// Unable to resolve host ..." or "Network request failed"; say it in plain words instead.
export const NO_SIGNAL_TEXT = 'No signal: could not reach the server. Try again when you have signal.';
const NETWORK = /network request failed|failed to fetch|fetch failed|unknownhost|unable to resolve host|no address associated|aborterror|connection (refused|reset)/i;
export const isNoSignal = (text: string) => NETWORK.test(text);

export function errText(e: unknown, fallback = 'Something went wrong. Try again in a minute.'): string {
  const raw = rawText(e, fallback);
  return isNoSignal(raw) ? NO_SIGNAL_TEXT : raw;
}

function rawText(e: unknown, fallback: string): string {
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
