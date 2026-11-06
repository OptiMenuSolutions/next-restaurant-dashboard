// lib/admin/fetchAll.js
//
// Fetches database rows in stable pages.
//
// strictLimit prevents callers from silently accepting
// incomplete results when the maximum row count is reached.

export async function fetchAll(
  make,
  {
    page = 1000,
    max = 200000,
    strictLimit = false,
  } = {}
) {
  if (
    !Number.isSafeInteger(page) ||
    page < 1 ||
    !Number.isSafeInteger(max) ||
    max < 1
  ) {
    throw new Error('Invalid pagination configuration.');
  }

  const out = [];

  for (let from = 0; from < max;) {
    const size = Math.min(page, max - from);

    const { data, error } = await make().range(
      from,
      from + size - 1
    );

    if (error) {
      throw new Error(error.message);
    }

    const rows = data || [];

    out.push(...rows);

    if (rows.length < size) {
      return out;
    }

    from += rows.length;
  }

  if (strictLimit) {
    // Probe beyond the configured maximum.
    // Never silently accept a partial financial history.
    const { data, error } = await make().range(
      max,
      max
    );

    if (error) {
      throw new Error(error.message);
    }

    if ((data || []).length > 0) {
      throw new Error(
        `Pagination safety limit exceeded: more than ${max} rows.`
      );
    }
  }

  return out;
}