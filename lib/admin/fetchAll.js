// lib/admin/fetchAll.js
// Supabase returns at most 1,000 rows per request (the API "max rows"
// setting), whatever .limit() asks for. fetchAll pages through with .range()
// so sums and counts over big tables (pos_sales, ingredients) are complete.
//
//   const rows = await fetchAll(() =>
//     db.from('pos_sales').select('...').eq('restaurant_id', id).order('id'));
//
// make() must build a fresh query each call, with a stable order.

export async function fetchAll(make, { page = 1000, max = 200000 } = {}) {
  const out = [];
  for (let from = 0; from < max; from += page) {
    const { data, error } = await make().range(from, from + page - 1);
    if (error) throw new Error(error.message);
    out.push(...(data || []));
    if (!data || data.length < page) break;
  }
  return out;
}