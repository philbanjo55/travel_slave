import type { LightLabel } from '../../utils/sunEngine';

// Colours and wording shared by the planner's map, horizon and readout.
// Same as the approved mockups.
export const LABELS: Record<LightLabel, { text: string; bg: string; fg: string; detail: string }> = {
  'front':        { text: 'FRONT',     bg: '#F0B04A', fg: '#000000', detail: 'Sun behind you' },
  'side':         { text: 'SIDE',      bg: '#86632A', fg: '#FFFFFF', detail: 'Sun to the side' },
  'backlit':      { text: 'BACKLIT',   bg: '#4468C4', fg: '#FFFFFF', detail: 'Sun beyond the subject' },
  'top':          { text: 'TOP LIGHT', bg: '#E6E6E6', fg: '#000000', detail: 'Sun high overhead' },
  'in shadow':    { text: 'SHADE',     bg: '#3B3B3B', fg: '#FFFFFF', detail: 'A ridge shades the subject' },
  'no sun':       { text: 'NO SUN',    bg: '#1A1A1A', fg: '#888888', detail: 'Sun below the horizon' },
  'no direction': { text: 'SUN',       bg: '#3B3B3B', fg: '#FFFFFF', detail: 'Vantage and subject pins are too close' },
};

export const PHASE_COLORS = {
  night: '#050505',
  blue: '#1B2B4D',
  golden: '#6B4A12',
  day: '#2A2A2A',
} as const;

export const SUN = '#F0B04A';
export const SUNSET = '#E0662B';
export const MOON = '#7FA7F5';
export const SHADED_SUN = '#bbbbbb';

export function compassPoint(d: number): string {
  return ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'][
    Math.floor((((d % 360) + 360 + 11.25) % 360) / 22.5)
  ];
}

// "Drangarnir (Stóri Drangur + Lítli Drangur)" -> "Drangarnir"
export function shortName(name: string | null | undefined): string {
  return String(name ?? '').replace(/\s*\(.*$/, '').trim() || '—';
}
