import { differenceInCalendarDays, parseISO } from 'date-fns';
import { colors } from '../../theme';

// Forecast for the next 3 days, outlook to day 15, light only beyond.
export function dayBadge(date: string): { text: string; color: string } {
  const n = differenceInCalendarDays(parseISO(date), new Date());
  if (n < 0) return { text: 'PAST', color: colors.textTertiary };
  if (n <= 2) return { text: 'FORECAST', color: colors.signalOk };
  if (n <= 15) return { text: 'OUTLOOK', color: colors.signalWarning };
  return { text: 'LIGHT ONLY', color: colors.textSecondary };
}
