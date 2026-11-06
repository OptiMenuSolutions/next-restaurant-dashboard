const assert = require('node:assert/strict');
const { Client } = require('pg');

const RESTAURANT_ID = 'c351e658-0b69-4175-9bec-04a9d8eeb8da';
const ITEM_ID = '0a6219e8-76ff-4c80-81f2-d71748886cda';
const INGREDIENT_ID = '9fb236c6-f282-480d-977e-b8ea00958b26';

async function main() {
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL is required');

  const db = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized:
            process.env.ALLOW_UNVERIFIED_DB_TLS !== 'true',
        },
    connectionTimeoutMillis: 10000,
  });

  let inTransaction = false;

  try {
    await db.connect();

    await db.query('BEGIN');
    inTransaction = true;

    await db.query("SET LOCAL statement_timeout = '15000ms'");
    await db.query("SET LOCAL lock_timeout = '8000ms'");

    const admin = await db.query(`
      SELECT id
      FROM public.profiles
      WHERE role = 'admin'
      ORDER BY id
      LIMIT 1
    `);

    assert.equal(admin.rowCount, 1);

    const baseline = await db.query(
      `
      SELECT generation, completed_generation
      FROM public.invoice_calculation_jobs
      WHERE restaurant_id = $1
      `,
      [RESTAURANT_ID]
    );

    assert.equal(baseline.rowCount, 1);
    assert.equal(Number(baseline.rows[0].generation), 2);
    assert.equal(Number(baseline.rows[0].completed_generation), 2);

    const original = await db.query(
      `
      SELECT ingredient_id, reviewed
      FROM public.invoice_items
      WHERE id = $1
      `,
      [ITEM_ID]
    );

    assert.equal(original.rowCount, 1);
    assert.equal(original.rows[0].ingredient_id, null);
    assert.equal(original.rows[0].reviewed, false);

    console.log('PASS: Original invoice and calculation baseline verified');

    const correction = await db.query(
      `
      SELECT public.resolve_invoice_ingredient_conflict(
        p_restaurant_id := $1::uuid,
        p_supplier := $2::text,
        p_product_description := $3::text,
        p_changes := $4::jsonb,
        p_future_ingredient_id := NULL::uuid,
        p_approve_future := FALSE,
        p_admin_id := $5::uuid,
        p_expected_mapping_updated_at := NULL::timestamptz
      ) AS result
      `,
      [
        RESTAURANT_ID,
        'Harborline Foodservice',
        'Cheddar Cheese Block',
        JSON.stringify([{
          invoice_item_id: ITEM_ID,
          expected_ingredient_id: null,
          ingredient_id: INGREDIENT_ID,
        }]),
        admin.rows[0].id,
      ]
    );

    const result = correction.rows[0].result;

    console.log('Correction function result:', result);

    const updated = await db.query(
      `
      SELECT ingredient_id
      FROM public.invoice_items
      WHERE id = $1
      `,
      [ITEM_ID]
    );

    assert.equal(updated.rows[0].ingredient_id, INGREDIENT_ID);
    console.log('PASS: Invoice correction applied inside transaction');

    const job = await db.query(
      `
      SELECT generation, completed_generation, effective_date
      FROM public.invoice_calculation_jobs
      WHERE restaurant_id = $1
      `,
      [RESTAURANT_ID]
    );

    const before = baseline.rows[0];
    const after = job.rows[0];

    console.log('Calculation queue:', {
      generationBefore: Number(before.generation),
      generationAfter: Number(after.generation),
      completedBefore: Number(before.completed_generation),
      completedAfter: Number(after.completed_generation),
      effectiveDate: after.effective_date,
    });

    assert.ok(
      Number(after.generation) > Number(before.generation),
      'Correction must advance the calculation generation'
    );

    assert.equal(
      Number(after.completed_generation),
      Number(before.completed_generation),
      'Correction must not mark calculations completed'
    );

    console.log('PASS: Recalculation queued correctly');

    const audit = await db.query(
      `
      SELECT action, previous_ingredient_id, new_ingredient_id
      FROM public.invoice_match_decision_audit
      WHERE invoice_item_id = $1
        AND new_ingredient_id = $2
      ORDER BY created_at DESC
      LIMIT 1
      `,
      [ITEM_ID, INGREDIENT_ID]
    );

    assert.equal(audit.rowCount, 1);
    assert.equal(audit.rows[0].previous_ingredient_id, null);
    assert.equal(audit.rows[0].new_ingredient_id, INGREDIENT_ID);

    console.log('PASS: Correction audit created');

    console.log('\nTEST 24H PASSED');

  } finally {
    if (inTransaction) {
      await db.query('ROLLBACK').catch(() => {});
      console.log('Transaction rolled back');
    }

    await db.end().catch(() => {});
  }
}

main().catch(error => {
  console.error('TEST 24H FAILED:', error.message);
  process.exitCode = 1;
});