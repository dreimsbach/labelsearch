import type { TimeMode } from '../../shared/types.js';

function toLocalYmd(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
}

export function computeDateRange(mode: TimeMode, value: number, timezone: string): { fromDate: string; toDate: string } {
  if (mode === 'year') {
    const year = Math.max(1900, Math.min(2100, Math.trunc(value)));
    return {
      fromDate: `${year}-01-01`,
      toDate: `${year}-12-31`
    };
  }

  const now = new Date();
  const toDate = toLocalYmd(now, timezone);

  const localMidnight = new Date(`${toDate}T00:00:00`);
  const from = new Date(localMidnight);
  from.setDate(from.getDate() - Math.max(0, value - 1));

  return {
    fromDate: toLocalYmd(from, timezone),
    toDate
  };
}
