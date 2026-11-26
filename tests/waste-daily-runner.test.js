import test from 'node:test';
import assert from 'node:assert/strict';
import { dispatchWasteDailyAssessments } from '../lib/wasteDailyRunner.js';
import { readWasteDailyInput } from '../lib/wasteDailyInput.js';

const now = '2026-11-26T12:00:00Z';
const day = '2026-11-26';
const ready = { id: 'job', lease_token: 'second', status: 'ready', assessment_date: day };

function harness(replies, targets = ['a']) {
  const trace = [];
  const query = {
    select: () => query,
    eq: () => query,
    order: () => query,
    range: async (from, to) => ({
      data: targets.slice(from, to + 1).map(restaurant_id => ({ restaurant_id })), error: null,
    }),
  };
  const db = {
    from() { return query; },
    async rpc(name, args) {
      const step = name.replace('waste_projection_daily_', '');
      trace.push([step, args]);
      assert.ok(replies[step]?.length, `Unexpected ${step}`);
      const reply = replies[step].shift();
      return reply instanceof Error ? { data: null, error: reply } : { data: reply, error: null };
    },
  };
  const options = {
    now: () => now,
    elapsed: () => 0,
    prepareInventory: async () => ({ rows: [] }),
    readInput: async () => ({ inventoryCutoff: '2026-11-25' }),
    prepareAssessment: async (_db, _input, request_id) => ({ request_id }),
    alert: async (...args) => { trace.push(['email', args]); },
  };
  return { db, trace, options };
}

test('the only claim path checkpoints inventory and saves an envelope before commit', async () => {
  const h = harness({
    claim: [{ ...ready, status: 'pending', lease_token: 'first' }, ready],
    checkpoint: [{ status: 'ready' }],
    save: [null],
    commit: [{ status: 'completed' }],
    take_alert: [null],
  });
  assert.equal((await dispatchWasteDailyAssessments(h.db, h.options)).completed, 1);
  assert.deepEqual(h.trace.map(([name]) => name), ['claim','checkpoint','claim','save','commit','take_alert']);
  assert.equal(h.trace[0][1].assessment_day, null);
  assert.equal(h.trace[1][1].tok, 'first');
  assert.equal(h.trace[2][1].assessment_day, day);
  assert.equal(h.trace[4][1].tok, 'second');
});

test('a saved envelope retries without rebuilding and a transient failure sends no alert', async () => {
  const h = harness({
    claim: [{ ...ready, envelope: { request_id: 'original' } }],
    commit: [Object.assign(new Error('timeout'), { code: '57014' })],
    checkpoint: [{ status: 'ready' }],
    take_alert: [null],
  });
  assert.equal((await dispatchWasteDailyAssessments(h.db, h.options)).retrying, 1);
  assert.deepEqual(h.trace.map(([name]) => name), ['claim','commit','checkpoint','take_alert']);
  assert.match(h.trace[2][1].failure, /^commit \| 57014/);
});

test('skipped and failed jobs alert once with restaurant, business date, stage and reason', async () => {
  for (const [status, stage, reason] of [
    ['skipped', 'inventory', 'POS_SYNC_INCOMPLETE'],
    ['failed', 'commit', 'PT409'],
  ]) {
    const h = harness({
      claim: [{ status }, { status }],
      take_alert: [{ status, assessment_date: day, stage, reason }, null],
    });
    await dispatchWasteDailyAssessments(h.db, h.options);
    await dispatchWasteDailyAssessments(h.db, h.options);
    assert.deepEqual(h.trace.filter(([name]) => name === 'email'), [['email', [
      'Daily waste assessment',
      `Assessment ${status} for restaurant a on ${day}.`,
      [`Stage ${stage}`, reason],
    ]]]);
  }
});

test('the same dispatcher leaves remaining restaurants unclaimed after 200 seconds', async () => {
  const h = harness({ claim: [{ status: 'wait' }], take_alert: [null] }, ['a','b']);
  const ticks = [0, 1, 200_000];
  const run = await dispatchWasteDailyAssessments(h.db, { ...h.options, elapsed: () => ticks.shift() });
  assert.equal(run.deferred, 1);
  assert.equal(h.trace.filter(([name]) => name === 'claim').length, 1);
});

test('daily input retains stable stock IDs and joins only the pinned archive and recipes', async () => {
  const result = {
    ingredients: [{ id: 'ingredient' }],
    projection_forecast_runs: [{ id: 'run', run_date: day }],
    projection_forecast_nights: [{ target_date: day, availability: 'available', low: '10' }],
    projection_forecast_dishes: [
      { target_date: day, dish_id: 'dish', share: '0.5', trace: { active: true, status: 'ok' } },
    ],
    projection_dishes: [{ id: 'dish', menu_item_id: 'item' }],
    menu_items: [{ id: 'item', menu_item_components: [
      { component_ingredients: [{ ingredient_id: 'ingredient', quantity: 2, unit: 'lb' }] },
    ] }],
  };
  const db = {
    from(table) {
      const query = { select: () => query, eq: (_key, value) => {
        assert.ok(['a','run'].includes(value));
        return query;
      }, order: () => query,
      range: async (from, to) => ({ data: result[table].slice(from, to + 1), error: null }) };
      return query;
    },
  };
  const input = await readWasteDailyInput(db, {
    restaurant_id: 'a', assessment_date: day, forecast_pinned: true, forecast_run_id: 'run', fallback: false,
    timing: { timezone: 'America/New_York', cutoff_minutes: 240 },
    receipt: { rows: [
      { restaurant_id: 'a', invoice_item_id: 'invoice', ingredient_id: 'ingredient',
        delivery_date: '2026-11-23', shelf_life: 5, remaining_qty: '8', unit: 'lb', unit_cost: null },
      { restaurant_id: 'a', stock_source: 'count', count_line_id: 'count', remaining_qty: 3, unit: 'lb' },
    ] },
  }, now);
  assert.deepEqual(input.batches.map(row => [row.id, row.use_by_date, row.unit_cost]), [
    ['invoice','2026-11-28',null], ['count',null,null],
  ]);
  assert.equal(input.forecast.nights[0].dishes[0].share, 0.5);
  assert.equal(input.recipes[0].complete, true);
  assert.equal(input.recipes[0].portions[0].quantity, 2);
});