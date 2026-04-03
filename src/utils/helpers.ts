import { format, parseISO } from 'date-fns';

// ─────────────────────────────────────────
// TIME
// ─────────────────────────────────────────
export function formatDayHeader(dateStr: string): string {
  try {
    return format(parseISO(dateStr), 'EEE, MMM d');
  } catch {
    return dateStr;
  }
}

export function minutesToHoursMin(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

export function addMinutesToTimeLabel(timeLabel: string, minutes: number): string {
  // Parse "3:45 PM" or "~3:45 PM" style labels
  const cleaned = timeLabel.replace(/^~\s*/, '');
  const match = cleaned.match(/^(\d+):(\d+)\s*(AM|PM)$/i);
  if (!match) return timeLabel;

  let [, h, m, period] = match;
  let hours = parseInt(h);
  let mins = parseInt(m);

  if (period.toUpperCase() === 'PM' && hours !== 12) hours += 12;
  if (period.toUpperCase() === 'AM' && hours === 12) hours = 0;

  const totalMins = hours * 60 + mins + minutes;
  const newHours = Math.floor(totalMins / 60) % 24;
  const newMins = totalMins % 60;

  const newPeriod = newHours >= 12 ? 'PM' : 'AM';
  const displayHours = newHours > 12 ? newHours - 12 : newHours === 0 ? 12 : newHours;

  return `${displayHours}:${String(newMins).padStart(2, '0')} ${newPeriod}`;
}

// ─────────────────────────────────────────
// SIGNAL STATUS
// ─────────────────────────────────────────
export const SIGNAL_COLORS = {
  ok: '#4a9e6a',
  warning: '#c4892a',
  none: '#8a4a4a',
} as const;

export const SIGNAL_LABELS = {
  ok: '✅',
  warning: '⚠️',
  none: '📵',
} as const;

export function getSignalIcon(status: string | null): string {
  if (!status) return '';
  return SIGNAL_LABELS[status as keyof typeof SIGNAL_LABELS] || '';
}

// ─────────────────────────────────────────
// REGION
// ─────────────────────────────────────────
export const REGION_COLORS: Record<string, string> = {
  ireland: '#4a7a5a',
  scotland: '#4a5a7a',
  travel: '#7a5a4a',
  dublin: '#7a4a6a',
};

export function getRegionColor(region: string): string {
  return REGION_COLORS[region] || '#c4a882';
}

// ─────────────────────────────────────────
// COORDINATES
// ─────────────────────────────────────────
export function haversineKm(
  lat1: number, lng1: number,
  lat2: number, lng2: number
): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) *
    Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function roughDriveMinutes(
  lat1: number, lng1: number,
  lat2: number, lng2: number
): number {
  const km = haversineKm(lat1, lng1, lat2, lng2);
  return Math.round((km / 50) * 60); // 50 km/h average
}

// ─────────────────────────────────────────
// SUNRISE / SUNSET (simplified)
// ─────────────────────────────────────────
export function getSunriseSunset(lat: number, date: Date): { sunrise: string; sunset: string } {
  // Simplified calculation for late June at ~54-57°N
  // In late June at these latitudes, sunrise ~4:45-5:15 AM, sunset ~10:00-10:45 PM
  const dayOfYear = Math.floor(
    (date.getTime() - new Date(date.getFullYear(), 0, 0).getTime()) / 86400000
  );

  // Rough approximation for Irish/Scottish latitudes
  const baseRise = 5.0;  // 5:00 AM base
  const baseSet = 22.0;  // 10:00 PM base
  const latFactor = (lat - 54) * 0.15; // Later sunset/earlier sunrise further north

  const riseHr = baseRise - latFactor;
  const setHr = baseSet + latFactor;

  const formatHour = (h: number) => {
    const hours = Math.floor(h);
    const mins = Math.round((h - hours) * 60);
    const period = hours >= 12 ? 'PM' : 'AM';
    const displayH = hours > 12 ? hours - 12 : hours;
    return `${displayH}:${String(mins).padStart(2, '0')} ${period}`;
  };

  return {
    sunrise: formatHour(riseHr),
    sunset: formatHour(setHr),
  };
}
