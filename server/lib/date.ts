function toLocalYmd(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
}

export function computeDateRange(daysBack: number, timezone: string): { fromDate: string; toDate: string } {
  const now = new Date();
  const toDate = toLocalYmd(now, timezone);

  const localMidnight = new Date(`${toDate}T00:00:00`);
  const from = new Date(localMidnight);
  from.setDate(from.getDate() - Math.max(0, daysBack - 1));

  return {
    fromDate: toLocalYmd(from, timezone),
    toDate
  };
}
