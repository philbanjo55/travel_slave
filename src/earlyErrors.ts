// Report uncaught errors, then get out of the way.
//
// Installed as the first thing the bundle does. Whatever the app throws that
// nothing catches - a render error outside a boundary, a rejected promise
// nobody awaited - is posted to app_logs, the table the device already writes
// to, and then handed to the handler that was there before. So the app still
// crashes, restarts, or rolls back an update exactly as it would have; the
// only difference is that the error is readable afterwards from a query
// instead of being gone with the process.
//
// This replaces a diagnostic version that swallowed fatal errors to keep a
// screen alive. That was the wrong trade for production: expo-updates relies
// on a fatal error to know an update is bad and roll it back, and an app kept
// half-alive after one is in a state nothing was written for.
import { supabase } from './services/supabase';

function report(e: any, phase: string): void {
  try {
    const message = String(e?.message ?? e);
    console.warn(`[${phase}]`, message);
    supabase.from('app_logs').insert({
      level: 'error',
      message: `[${phase}] ${message}`.slice(0, 300),
      data: { stack: String(e?.stack ?? '').slice(0, 1200) },
    }).then(() => {}, () => {});
  } catch {}
}

try {
  const g: any = globalThis as any;
  const previous = g?.ErrorUtils?.getGlobalHandler?.();
  if (g?.ErrorUtils?.setGlobalHandler) {
    g.ErrorUtils.setGlobalHandler((error: any, isFatal?: boolean) => {
      report(error, isFatal ? 'fatal' : 'error');
      // Best effort: a fatal error ends the process and the insert above may
      // not make it out. Non-fatal ones will. Either way, behave as before.
      if (typeof previous === 'function') previous(error, isFatal);
    });
  }
} catch {}

try {
  const g: any = globalThis as any;
  if (typeof g?.addEventListener === 'function') {
    g.addEventListener('unhandledrejection', (ev: any) => report(ev?.reason ?? ev, 'promise'));
  }
} catch {}
