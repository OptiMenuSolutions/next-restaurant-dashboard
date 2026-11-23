const usable = day => day.applies === true && Number.isFinite(day.ratio) && day.ratio > 0;

export function hasUsableEightWeekPreview(result) {
  return result?.status === 'ok' && Array.isArray(result.weeks) &&
    result.weeks.length === 8 && result.weeks.every(week =>
      Array.isArray(week.days) && week.days.length === 7 && week.days.some(usable)
    );
}

export const formatBenchmarkNumber = value =>
  Number.isFinite(value) ? value.toFixed(4) : '—';

export function benchmarkWeekAvailability(week) {
  const days = week.days.filter(day => day.reason !== 'closed_weekday');
  if (!days.length) return 'Closed';
  return days.every(usable) ? 'Yes' : days.some(usable) ? 'Partial' : 'Unavailable';
}