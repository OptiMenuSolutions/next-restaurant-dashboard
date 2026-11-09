import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

import {
  repriceFromInvoices,
} from '../lib/admin/invoiceLines.js';

const RESTAURANT_ID =
  '30f6f319-6d2c-498d-bd49-f24be4bffe8d';

const EXPECTED_REASON =
  'Synthetic development testing for Finding #020';

test('live development invoice-supported repricing', async () => {
  const url = process.env.OPTIMENU_TEST_SUPABASE_URL;
  const key = process.env.OPTIMENU_TEST_SUPABASE_SECRET_KEY;

  assert.ok(url && key, 'Development credentials are missing');

  const parsedUrl = new URL(url);

  assert.equal(parsedUrl.protocol, 'https:');
  assert.ok(parsedUrl.hostname.endsWith('.supabase.co'));
  assert.equal(parsedUrl.pathname, '/');

  const db = createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  // Verify the unique development-only test restaurant
  // and its explicitly configured matching status.
  const { data: restaurant, error: restaurantError } =
    await db
      .from('restaurants')
      .select('id, name')
      .eq('id', RESTAURANT_ID)
      .single();

  assert.ifError(restaurantError);
  assert.equal(restaurant.name, 'Cedar Test Bistro');

  const { data: control, error: controlError } =
    await db
      .from('restaurant_invoice_matching_controls')
      .select('status, activation_reason')
      .eq('restaurant_id', RESTAURANT_ID)
      .single();

  assert.ifError(controlError);
  assert.equal(control.status, 'legacy_enabled');
  assert.equal(control.activation_reason, EXPECTED_REASON);

  // Confirm the Finding #020 table exists.
  const { error: evidenceTableError } = await db
    .from('invoice_supported_price_evidence')
    .select('id')
    .limit(1);

  assert.ifError(evidenceTableError);

  const ingredientId = randomUUID();
  const invoiceId = randomUUID();
  const lineId = randomUUID();

  const dishId = randomUUID();
  const componentId = randomUUID();

  let ingredientCreated = false;
  let invoiceCreated = false;
  let dishCreated = false;
  let componentCreated = false;

  const previousFlag =
    process.env.INVOICE_SUPPORTED_REPRICING_ENABLED;

  try {
    // Create an ingredient at $0.20/fl oz.
    const { error: ingredientError } = await db
      .from('ingredients')
      .insert({
        id: ingredientId,
        restaurant_id: RESTAURANT_ID,
        name: 'Dijon Mustard - Finding 020 Test',
        unit: 'fl oz',
        standard_unit: 'fl oz',
        ingredient_category: 'volume',
        last_price: 0.20,
        price_status: 'invoice',
        is_estimated: false,
      });

    assert.ifError(ingredientError);
    ingredientCreated = true;

    // Create a synthetic dish using the test ingredient.
    const { error: dishError } = await db
      .from('menu_items')
      .insert({
        id: dishId,
        restaurant_id: RESTAURANT_ID,
        name: 'Finding 020 Integration Test Dish',
        price: 10,
        category: 'Testing',
      });

    assert.ifError(dishError);
    dishCreated = true;

    // Create the recipe component.
    const { error: componentError } = await db
      .from('menu_item_components')
      .insert({
        id: componentId,
        menu_item_id: dishId,
        name: 'Test Sauce',
      });

    assert.ifError(componentError);
    componentCreated = true;

    // The recipe contains 2 fl oz of Dijon Mustard.
    const { error: recipeError } = await db
      .from('component_ingredients')
      .insert({
        component_id: componentId,
        ingredient_id: ingredientId,
        quantity: 2,
        unit: 'fl oz',
      });

    assert.ifError(recipeError);

    // Calculate the initial cost using the real
    // PostgreSQL recipe-cost function.
    const { data: initialCost, error: initialCostError } =
      await db.rpc('recalculate_dish_cost', {
        p_dish_id: dishId,
      });

    assert.ifError(initialCostError);
    assert.equal(initialCost?.ready, true);
    assert.equal(Number(initialCost.cost), 0.40);

    console.log(
      'PASS: Initial recipe cost = $0.40'
    );

    // Save the invoice, linked line, and evidence
    // through the real transactional PostgreSQL RPC.
    const { data: confirmation, error: confirmationError } =
      await db.rpc(
        'save_invoice_confirmation_transactional',
        {
          p_restaurant_id: RESTAURANT_ID,
          p_request_id: `finding-020-live-${randomUUID()}`,
          p_request_fingerprint: 'a'.repeat(64),
          p_append_to_invoice_id: null,

          p_invoice: {
            id: invoiceId,
            supplier: 'Synthetic Development Supplier',
            number: `TEST-${randomUUID()}`,
            date: '2026-11-07',
            amount: 30,
          },

          p_files: [],

          p_lines: [{
            id: lineId,
            invoice_id: invoiceId,
            ingredient_id: ingredientId,
            item_name: 'Dijon Mustard',
            quantity: 4,
            unit: 'qt',
            unit_cost: 7.50,
            amount: 30,
          }],

          p_evidence: [{
            invoice_item_id: lineId,
            invoice_id: invoiceId,
            restaurant_id: RESTAURANT_ID,
            source_type: 'structured_ocr_table',
            validation_status: 'source_table_consistent',
            evidence_version: 1,
            source_fingerprint: 'b'.repeat(64),
            pricing_fingerprint: 'c'.repeat(64),
              evidence: {
                test: true,
                source: 'synthetic_development_invoice',
                pricing: {
                  invoice_item_id: lineId,
                  invoice_id: invoiceId,
                  restaurant_id: RESTAURANT_ID,
                  ingredient_id: ingredientId,
                  item_name: 'Dijon Mustard',
                  quantity: 4,
                  unit: 'qt',
                  unit_cost: 7.50,
                  amount: 30,
                },
              },
          }],

          p_queue_calculations: false,
        }
      );

    assert.ifError(confirmationError);
    assert.equal(confirmation?.success, true);
    assert.equal(confirmation?.lines_saved, 1);
    assert.equal(confirmation?.evidence_saved, 1);

    invoiceCreated = true;

    // Enable the new pathway ONLY inside this
    // isolated test process.
    process.env.INVOICE_SUPPORTED_REPRICING_ENABLED =
      'true';

    // Exercise the actual application function.
    await repriceFromInvoices(
      db,
      RESTAURANT_ID,
      ingredientId
    );

    // Read the resulting ingredient from PostgreSQL.
    const { data: updated, error: updateError } =
      await db
        .from('ingredients')
        .select(
          'last_price, unit, standard_unit, ' +
          'price_status, is_estimated, last_ordered_at'
        )
        .eq('id', ingredientId)
        .single();

    assert.ifError(updateError);

    // 4 qt at $7.50/qt:
    // $7.50 / 32 fl oz = $0.234375/fl oz.
    assert.equal(Number(updated.last_price), 0.234375);
    assert.equal(updated.unit, 'fl oz');
    assert.equal(updated.standard_unit, 'fl oz');
    assert.equal(updated.price_status, 'invoice');
    assert.equal(updated.is_estimated, false);
    assert.equal(updated.last_ordered_at, '2026-11-07');

    console.log(
      'PASS: Live ingredient price updated to $0.234375/fl oz'
    );

    // Recalculate the dish after the application's
    // invoice-supported ingredient repricing.
    const { data: recalculated, error: recalculateError } =
      await db.rpc('recalculate_dish_cost', {
        p_dish_id: dishId,
      });

    assert.ifError(recalculateError);
    assert.equal(recalculated?.ready, true);

    // 2 fl oz × $0.234375 = $0.46875,
    // rounded to $0.47 by calculate_dish_cost().
    assert.equal(Number(recalculated.cost), 0.47);

    console.log(
      'PASS: Recipe recalculated to $0.47'
    );

    // Verify the persisted menu item.
    const { data: updatedDish, error: updatedDishError } =
      await db
        .from('menu_items')
        .select(
          'cost, cost_status, cost_previous, ' +
          'cost_revision, cost_uses_estimates'
        )
        .eq('id', dishId)
        .single();

    assert.ifError(updatedDishError);

    assert.equal(Number(updatedDish.cost), 0.47);
    assert.equal(updatedDish.cost_status, 'ready');
    assert.equal(Number(updatedDish.cost_previous), 0.40);
    assert.ok(updatedDish.cost_revision);
    assert.equal(updatedDish.cost_uses_estimates, false);

    console.log(
      'PASS: Persisted recipe cost, status, and revision verified'
    );

  } finally {
    // Restore the original process environment.
    if (previousFlag === undefined) {
      delete process.env.INVOICE_SUPPORTED_REPRICING_ENABLED;
    } else {
      process.env.INVOICE_SUPPORTED_REPRICING_ENABLED =
        previousFlag;
    }

    // Remove only records belonging to this test.
    const cleanupErrors = [];

    async function remove(table, column, id) {
      const { error } = await db
        .from(table)
        .delete()
        .eq(column, id);

      if (error) {
        cleanupErrors.push(`${table}: ${error.message}`);
      }
    }

    // Remove recipe dependencies before the ingredient.
    if (componentCreated) {
      await remove(
        'component_ingredients',
        'component_id',
        componentId
      );

      await remove(
        'menu_item_components',
        'id',
        componentId
      );
    }

    if (dishCreated) {
      await remove(
        'menu_item_cost_history',
        'menu_item_id',
        dishId
      );

      await remove('menu_items', 'id', dishId);
    }

    if (invoiceCreated) {
      await remove(
        'invoice_supported_price_evidence',
        'invoice_item_id',
        lineId
      );

      await remove('invoice_items', 'id', lineId);
      await remove('invoices', 'id', invoiceId);
    }

    if (ingredientCreated) {
      await remove('ingredients', 'id', ingredientId);
    }

    assert.deepEqual(
      cleanupErrors,
      [],
      'Development test cleanup failed'
    );

    // Verify cleanup rather than assuming DELETE succeeded.
    for (const [table, id] of [
      ['ingredients', ingredientId],
      ['invoices', invoiceId],
      ['invoice_items', lineId],
      ['menu_items', dishId],
      ['menu_item_components', componentId],
    ]) {
      const { count, error } = await db
        .from(table)
        .select('id', { count: 'exact', head: true })
        .eq('id', id);

      assert.ifError(error);
      assert.equal(count, 0, `${table} cleanup incomplete`);
    }
  }
});