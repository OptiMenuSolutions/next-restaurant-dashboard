import test from 'node:test';
import assert from 'node:assert/strict';

import {
  fetchAll,
} from '../lib/admin/fetchAll.js';

function mockQuery(rows) {
  return () => ({
    async range(start, end) {
      return {
        data: rows.slice(start, end + 1),
        error: null,
      };
    },
  });
}

test('strict pagination returns complete histories', async () => {
  const rows = Array.from(
    { length: 7 },
    (_, i) => ({ id: i + 1 })
  );

  const result = await fetchAll(
    mockQuery(rows),
    {
      page: 3,
      max: 10,
      strictLimit: true,
    }
  );

  assert.deepEqual(result, rows);
});

test('strict pagination accepts exactly the maximum', async () => {
  const rows = Array.from(
    { length: 6 },
    (_, i) => ({ id: i + 1 })
  );

  const result = await fetchAll(
    mockQuery(rows),
    {
      page: 3,
      max: 6,
      strictLimit: true,
    }
  );

  assert.deepEqual(result, rows);
});

test('strict pagination rejects truncated histories', async () => {
  const rows = Array.from(
    { length: 7 },
    (_, i) => ({ id: i + 1 })
  );

  await assert.rejects(
    fetchAll(
      mockQuery(rows),
      {
        page: 3,
        max: 6,
        strictLimit: true,
      }
    ),
    /Pagination safety limit exceeded/
  );
});