export const CPI_GAP_POLICY = 'isolated-log-linear-v1';

const fail = message => {
  throw Object.assign(new Error(message), { code: 'PROJECTION_BENCHMARK_INVALID' });
};

const monthShift = (date, offset) => {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCMonth(value.getUTCMonth() + offset);
  return value.toISOString().slice(0, 10);
};

export function interpolateCpiMonths(rows, policy = null) {
  if (policy !== null && policy !== CPI_GAP_POLICY) fail('Unknown CPI gap policy.');
  if (!Array.isArray(rows)) fail('Monthly CPI observations are required.');
  const source = new Map();
  for (const row of rows) {
    if (!row || !/^\d{4}-(0[1-9]|1[0-2])-01$/.test(row.date) || source.has(row.date) ||
      (row.value !== null && (!Number.isFinite(row.value) || row.value <= 0))) {
      fail('Invalid monthly CPI observation.');
    }
    source.set(row.date, row.value);
  }
  const dates = [...source.keys()].sort();
  const months = dates.map(date => ({ date, value: source.get(date) }));
  const interpolated = [];
  if (policy === null || !dates.length) return { months, interpolated };

  const filled = new Map(source);
  for (let date = dates[0]; date <= dates.at(-1); date = monthShift(date, 1)) {
    if (Number.isFinite(source.get(date)) && source.get(date) > 0) continue;
    const previous = monthShift(date, -1);
    const next = monthShift(date, 1);
    const left = source.get(previous);
    const right = source.get(next);
    if (!Number.isFinite(left) || left <= 0 || !Number.isFinite(right) || right <= 0) continue;
    const value = Math.sqrt(left * right);
    if (!Number.isFinite(value) || value <= 0) fail('CPI interpolation overflow.');
    filled.set(date, value);
    interpolated.push({
      date, value, previous, next, cpi_interpolated: true,
    });
  }
  return {
    months: [...filled.keys()].sort().map(date => ({ date, value: filled.get(date) })),
    interpolated,
  };
}