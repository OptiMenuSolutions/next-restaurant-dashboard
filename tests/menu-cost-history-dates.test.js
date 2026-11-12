import test from 'node:test';
import assert from 'node:assert/strict';

import { recomputeMenuCosts } from '../lib/recomputeMenuCosts.js';

const RID = 'cost-history-restaurant';
const DISH_ID = 'cost-history-dish';

function fixture({ ready = true, failHistory = false } = {}) {
  const history = [];
  const tables = {
    component_ingredients: [],
    menu_item_ingredients: [{
      id: 'recipe-line',
      ingredient_id: 'ingredient-owned',
      menu_item_id: DISH_ID,
    }],
    menu_items: [{
      id: DISH_ID,
      restaurant_id: RID,
      name: 'Test dish',
      cost: 2,
    }],
    menu_item_cost_history: history,
    notification_email_outbox: [],
  };

  const db = {
    from(table) {
      assert.ok(Object.hasOwn(tables, table), table);
      const filters = [];
      const query = {
        select() { return query; },
        eq(column, value) {
          filters.push(row => row[column] === value);
          return query;
        },
        in(column, values) {
          filters.push(row => values.includes(row[column]));
          return query;
        },
        order() { return query; },
        async range(start, end) {
          return {
            data: tables[table]
              .filter(row => filters.every(filter => filter(row)))
              .slice(start, end + 1),
            error: null,
          };
        },
        async limit() {
          assert.equal(table, 'notification_email_outbox');
          return { data: [], error: null };
        },
        async upsert(row, options) {
          assert.equal(table, 'menu_item_cost_history');
          assert.deepEqual(options, {
            onConflict: 'menu_item_id,cost_revision',
            ignoreDuplicates: true,
          });

          if (failHistory) {
            return {
              data: null,
              error: { message: 'Synthetic history write failure' },
            };
          }

          if (!history.some(existing =>
            existing.menu_item_id === row.menu_item_id &&
            existing.cost_revision === row.cost_revision
          )) {
            history.push({ id: 'history-row', ...row });
          }

          return { data: null, error: null };
        },
      };
      return query;
    },

    async rpc(name, args) {
      if (name === 'recalculate_dish_cost') {
        assert.deepEqual(args, { p_dish_id: DISH_ID });
        return {
          data: ready
            ? {
                ready: true,
                cost: 3,
                previous_cost: 2,
                revision: 'current-cost-revision',
                changed: true,
              }
            : {
                ready: false,
                issues: ['Unapproved ingredient price'],
              },
          error: null,
        };
      }

      assert.equal(args.p_restaurant_id, RID);
      assert.ok([
        'finalize_price_alerts',
        'finalize_low_margin_alerts',
        'claim_owner_alert_email',
      ].includes(name), name);

      return {
        data: name === 'claim_owner_alert_email' ? [] : null,
        error: null,
      };
    },
  };

  return { db, history };
}

for (const [label, effectiveDate] of [
  ['historical', '2000-01-01'],
  ['future', '2999-12-31'],
  ['unknown', null],
]) {
  test(
    label + ' invoice timing cannot misdate a current-cost observation',
    async () => {
      const { db, history } = fixture();
      const started = Date.now();

      const result = await recomputeMenuCosts(
        db,
        RID,
        ['ingredient-owned'],
        { effectiveDate, reason: 'invoice_update' }
      );

      const finished = Date.now();
      assert.equal(result.updated, 1);
      assert.deepEqual(result.notificationErrors, []);
      assert.equal(history.length, 1);
      assert.equal(history[0].restaurant_id, RID);
      assert.equal(history[0].menu_item_id, DISH_ID);
      assert.equal(history[0].new_cost, 3);
      assert.equal(history[0].old_cost, 2);
      assert.equal(history[0].cost_revision, 'current-cost-revision');

      const recorded = Date.parse(history[0].created_at);
      assert.ok(recorded >= started && recorded <= finished);
    }
  );
}

test('retry does not redate or duplicate an existing cost observation', async () => {
  const { db, history } = fixture();

  await recomputeMenuCosts(
    db, RID, ['ingredient-owned'], { effectiveDate: '2000-01-01' }
  );

  const original = structuredClone(history);

  await recomputeMenuCosts(
    db, RID, ['ingredient-owned'], { effectiveDate: '2999-12-31' }
  );

  assert.deepEqual(history, original);
});

test('unresolved dish costs cannot create a history observation', async () => {
  const { db, history } = fixture({ ready: false });

  const result = await recomputeMenuCosts(
    db, RID, ['ingredient-owned'], { effectiveDate: '2000-01-01' }
  );

  assert.equal(result.updated, 0);
  assert.deepEqual(result.blocked, [{
    dishId: DISH_ID,
    dish: 'Test dish',
    issues: ['Unapproved ingredient price'],
  }]);
  assert.deepEqual(history, []);
});

test('history persistence errors remain visible to the caller', async () => {
  const { db, history } = fixture({ failHistory: true });

  await assert.rejects(
    recomputeMenuCosts(
      db, RID, ['ingredient-owned'], { effectiveDate: '2000-01-01' }
    ),
    /Synthetic history write failure/
  );

  assert.deepEqual(history, []);
});