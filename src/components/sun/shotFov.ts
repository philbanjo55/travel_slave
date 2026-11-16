import type { Pair } from '../../utils/sunEngine';

// A shot's framing as seen from above (the Overhead tab): which way it points and how wide the lens sees, across.
// Same lenses as the 3D view (Sun3DPanel LENSES): 4x5 film 120 x 96 mm, the Fuji GW690 82.6 x 56 mm.
const LENS_MM: Record<string, { f: number; long: number; short: number }> = {
  '75': { f: 75, long: 120, short: 96 },
  '90': { f: 90, long: 120, short: 96 },
  '135': { f: 135, long: 120, short: 96 },
  '300': { f: 300, long: 120, short: 96 },
  gw690: { f: 90, long: 82.6, short: 56 },
};

export type ShotFov = { aim: number | null; fov: number; framed: boolean };

export function shotFov(p: Pair): ShotFov {
  const fr = p.framing ?? null;
  const lens = LENS_MM[fr?.lens ?? '135'] ?? LENS_MM['135'];
  const across = fr?.orient === 'portrait' ? lens.short : lens.long;
  const fov = (2 * Math.atan(across / 2 / lens.f) * 180) / Math.PI;
  return { aim: fr?.heading ?? p.bearing ?? null, fov, framed: !!fr };
}
