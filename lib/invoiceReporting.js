import { getInvoiceEffectiveDate } from './invoiceRepricing.js';

export function invoiceMonthSpend(rows, today) {
  if (typeof today !== 'string' || getInvoiceEffectiveDate({ date: today }) !== today) {
    return null;
  }
  let cents = 0;
  for (const row of rows) {
    const date = getInvoiceEffectiveDate({
      delivery_date: row.displayIsoDate,
      date: row.isoDate,
    });
    if (!date || date > today || date.slice(0, 7) !== today.slice(0, 7)) continue;
    if (row.amount == null || row.amount === '') return null;
    const amount = Number(row.amount);
    if (!Number.isFinite(amount)) return null;
    cents += Math.round(amount * 100);
  }
  return cents / 100;
}

export async function readAllInvoiceRows(makeQuery) {
  const data = [];
  for (let from = 0; ; ) {
    const page = await makeQuery().range(from, from + 499);
    if (page.error) throw new Error(page.error.message);
    if (!Array.isArray(page.data)) throw new Error('Invalid invoice response.');
    if (!page.data.length) return { data };
    data.push(...page.data);
    from += page.data.length;
  }
}
