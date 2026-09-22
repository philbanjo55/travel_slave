// Capture errors that happen BEFORE React mounts.
//
// The existing ErrorBoundary only catches throws during render, inside a tree
// that is already mounted. A module that throws while it is being imported
// kills App.tsx's own evaluation, so the root component never registers and
// the native side shows a bare reload screen with no text on it. That is the
// screen we are looking at, and no boundary can reach it.
//
// So: install a global handler as the very first thing the bundle does, keep
// whatever it catches in memory, and let the app render it. Deliberately has
// no imports — anything this file required could itself be the thing failing.
export type Captured = { message: string; stack: string | null; phase: string; at: number };

const captured: Captured[] = [];
const listeners = new Set<() => void>();

export function captureError(e: any, phase: string): void {
  try {
    captured.push({
      message: String(e?.message ?? e),
      stack: typeof e?.stack === 'string' ? e.stack : null,
      phase,
      at: Date.now(),
    });
    listeners.forEach(l => { try { l(); } catch {} });
  } catch {}
}

export function getCapturedErrors(): Captured[] { return captured; }

export function subscribeCapturedErrors(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

// The default handler tears the app down, which is exactly what stops the
// error being readable. For a diagnostic build, staying alive to render the
// message is worth more than the default behaviour.
try {
  const g: any = globalThis as any;
  if (g?.ErrorUtils?.setGlobalHandler) {
    g.ErrorUtils.setGlobalHandler((error: any, isFatal?: boolean) => {
      captureError(error, isFatal ? 'fatal' : 'error');
    });
  }
} catch {}

try {
  const g: any = globalThis as any;
  if (typeof g?.addEventListener === 'function') {
    g.addEventListener('unhandledrejection', (ev: any) => {
      captureError(ev?.reason ?? ev, 'promise');
    });
  }
} catch {}
