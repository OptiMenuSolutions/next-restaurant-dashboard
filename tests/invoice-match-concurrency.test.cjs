const assert = require('node:assert/strict');
const { Client } = require('pg');

const RESTAURANT_ID =
  '1a44f2b8-11ef-4dc2-a279-a75aefb4b331';

const INGREDIENT_ID =
  '6883312d-d87b-4dc2-9ddf-690217193f0d';

const SUPPLIER_KEY = 'keystone foodservice supply';
const PRODUCT_KEY = 'gravy mix brown';

const connectionConfig = {
  connectionString: process.env.DATABASE_URL,
    ssl: {
    rejectUnauthorized:
        process.env.ALLOW_UNVERIFIED_DB_TLS !== 'true',
    },
  connectionTimeoutMillis: 10000,
  query_timeout: 15000,
};

const delay = ms =>
  new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not configured');
  }

  const a = new Client(connectionConfig);
  const b = new Client(connectionConfig);

  let aConnected = false;
  let bConnected = false;
  let aTransaction = false;
  let bTransaction = false;

  try {
    await a.connect();
    aConnected = true;

    await b.connect();
    bConnected = true;

    console.log('PASS: Two independent database connections');

    // Find an existing administrator.

    const adminResult = await a.query(`
      SELECT id
      FROM public.profiles
      WHERE role = 'admin'
      ORDER BY id
      LIMIT 1
    `);

    assert.equal(adminResult.rows.length, 1);

    const adminId = adminResult.rows[0].id;

    // Verify the existing approval before testing.

    const original = await a.query(
      `
      SELECT id, ingredient_id
      FROM public.invoice_ingredient_mappings
      WHERE restaurant_id = $1
        AND supplier_key = $2
        AND product_key = $3
      `,
      [
        RESTAURANT_ID,
        SUPPLIER_KEY,
        PRODUCT_KEY,
      ]
    );

    assert.equal(original.rows.length, 1);

    assert.equal(
      original.rows[0].ingredient_id,
      INGREDIENT_ID
    );

    const mappingId = original.rows[0].id;

    console.log('PASS: Original approval verified');

    // Begin independent transactions.

    await a.query('BEGIN');
    aTransaction = true;

    await b.query('BEGIN');
    bTransaction = true;

    await a.query(
      "SET LOCAL lock_timeout = '8s'"
    );

    await b.query(
      "SET LOCAL lock_timeout = '8s'"
    );

    // Connection A creates a temporary rejection.
    // The rejection trigger removes the conflicting approval.

    await a.query(
      `
      INSERT INTO public.invoice_match_rejections (
        restaurant_id,
        supplier_key,
        product_key,
        ingredient_id,
        rejected_by,
        reason
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      `,
      [
        RESTAURANT_ID,
        SUPPLIER_KEY,
        PRODUCT_KEY,
        INGREDIENT_ID,
        adminId,
        'Temporary concurrent transaction validation',
      ]
    );

    console.log('PASS: Connection A created temporary rejection');

    // Connection B attempts to update the same approval.
    // This should wait for Connection A to release its locks.

    let updateFinished = false;

    const updatePromise = b.query(
      `
      UPDATE public.invoice_ingredient_mappings
      SET ingredient_id = ingredient_id
      WHERE id = $1
      RETURNING id
      `,
      [mappingId]
    ).then(result => {
      updateFinished = true;
      return result;
    });

    // Give Connection B time to encounter the lock.

    await delay(500);

    assert.equal(
      updateFinished,
      false,
      'Approval update should wait for the rejection transaction'
    );

    console.log(
      'PASS: Concurrent approval update waited for transaction A'
    );

    // Release Connection A's locks by rolling back.

    await a.query('ROLLBACK');
    aTransaction = false;

    const updated = await updatePromise;

    assert.equal(updated.rowCount, 1);

    console.log(
      'PASS: Approval update completed after rejection rollback'
    );

    // Roll back Connection B as well.

    await b.query('ROLLBACK');
    bTransaction = false;

    // Verify the original approval remains.

    const finalApproval = await a.query(
      `
      SELECT ingredient_id
      FROM public.invoice_ingredient_mappings
      WHERE restaurant_id = $1
        AND supplier_key = $2
        AND product_key = $3
      `,
      [
        RESTAURANT_ID,
        SUPPLIER_KEY,
        PRODUCT_KEY,
      ]
    );

    assert.equal(finalApproval.rows.length, 1);

    assert.equal(
      finalApproval.rows[0].ingredient_id,
      INGREDIENT_ID
    );

    // Verify no test rejection remains.

    const finalRejection = await a.query(
      `
      SELECT COUNT(*)::integer AS count
      FROM public.invoice_match_rejections
      WHERE restaurant_id = $1
        AND supplier_key = $2
        AND product_key = $3
        AND ingredient_id = $4
      `,
      [
        RESTAURANT_ID,
        SUPPLIER_KEY,
        PRODUCT_KEY,
        INGREDIENT_ID,
      ]
    );

    assert.equal(
      finalRejection.rows[0].count,
      0
    );

    console.log('PASS: Original approval preserved');
    console.log('PASS: No test rejection persisted');

        // =========================================================
    // TEST 21: APPROVAL UPDATE BEFORE REJECTION
    // =========================================================

    await a.query('BEGIN');
    aTransaction = true;

    await b.query('BEGIN');
    bTransaction = true;

    await a.query("SET LOCAL lock_timeout = '8s'");
    await b.query("SET LOCAL lock_timeout = '8s'");

    // Connection A acquires the existing approval row lock.

    await a.query(
      `
      UPDATE public.invoice_ingredient_mappings
      SET ingredient_id = ingredient_id
      WHERE id = $1
      RETURNING id
      `,
      [mappingId]
    );

    console.log('PASS: Connection A locked existing approval');

    // Connection B attempts to reject that relationship.

    let rejectionFinished = false;

    const rejectionPromise = b.query(
      `
      INSERT INTO public.invoice_match_rejections (
        restaurant_id,
        supplier_key,
        product_key,
        ingredient_id,
        rejected_by,
        reason
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      `,
      [
        RESTAURANT_ID,
        SUPPLIER_KEY,
        PRODUCT_KEY,
        INGREDIENT_ID,
        adminId,
        'Temporary reverse-order concurrency validation',
      ]
    ).then(result => {
      rejectionFinished = true;
      return result;
    });

    await delay(500);

    assert.equal(
      rejectionFinished,
      false,
      'Rejection should wait for the approval transaction'
    );

    console.log(
      'PASS: Concurrent rejection waited for transaction A'
    );

    // Release Connection A's locks.

    await a.query('ROLLBACK');
    aTransaction = false;

    await rejectionPromise;

    console.log(
      'PASS: Rejection completed after approval rollback'
    );

    // Roll back Connection B as well.

    await b.query('ROLLBACK');
    bTransaction = false;

    // Confirm the original approval is preserved.

    const finalMapping = await a.query(
      `
      SELECT ingredient_id
      FROM public.invoice_ingredient_mappings
      WHERE id = $1
      `,
      [mappingId]
    );

    assert.equal(finalMapping.rows.length, 1);
    assert.equal(
      finalMapping.rows[0].ingredient_id,
      INGREDIENT_ID
    );

    console.log(
      'PASS: Reverse-order test preserved original approval'
    );

    console.log('\nTESTS 20 AND 21 PASSED');

    // =========================================================
    // TEST 22: HISTORICAL MATCHING VS MANUAL CORRECTION
    // =========================================================

    const testRestaurantId =
      'c351e658-0b69-4175-9bec-04a9d8eeb8da';

    const testInvoiceItemId =
      '0a6219e8-76ff-4c80-81f2-d71748886cda';

    const testIngredientId =
      '9fb236c6-f282-480d-977e-b8ea00958b26';

    const leaseToken = require('node:crypto').randomUUID();

    // Verify that the invoice line is still unmatched.

    const initialLine = await a.query(
      `
      SELECT ingredient_id, reviewed
      FROM public.invoice_items
      WHERE id = $1
      `,
      [testInvoiceItemId]
    );

    assert.equal(initialLine.rows.length, 1);
    assert.equal(initialLine.rows[0].ingredient_id, null);
    assert.equal(initialLine.rows[0].reviewed, false);

    console.log('PASS: Test invoice line is initially unmatched');

    // Begin both transactions.

    await a.query('BEGIN');
    aTransaction = true;

    await b.query('BEGIN');
    bTransaction = true;

    await a.query("SET LOCAL lock_timeout = '8s'");
    await b.query("SET LOCAL lock_timeout = '8s'");

    // Connection A establishes a temporary historical lease.

    const leaseResult = await a.query(
      `
      UPDATE public.historical_invoice_match_jobs
      SET
        lease_token = $2,
        lease_until = now() + interval '10 minutes'
      WHERE restaurant_id = $1
      RETURNING generation
      `,
      [testRestaurantId, leaseToken]
    );

    assert.equal(leaseResult.rows.length, 1);

    const generation = leaseResult.rows[0].generation;

    console.log('PASS: Temporary historical lease established');

    // Connection B modifies and locks the invoice line.
    //
    // This simulates the row-locking portion of an
    // administrator correction transaction.

    await b.query(
      `
      UPDATE public.invoice_items
      SET ingredient_id = $2
      WHERE id = $1
        AND ingredient_id IS NULL
      `,
      [testInvoiceItemId, testIngredientId]
    );

    console.log('PASS: Connection B holds invoice correction lock');

    // Connection A attempts historical matching.
    // It must wait for Connection B's row lock.

    let historicalFinished = false;

    const historicalPromise = a.query(
      `
      SELECT public.link_historical_invoice_item(
        $1, $2, $3, $4, $5
      ) AS linked
      `,
      [
        testRestaurantId,
        testInvoiceItemId,
        testIngredientId,
        leaseToken,
        generation,
      ]
    ).then(result => {
      historicalFinished = true;
      return result;
    });

    await delay(500);

    assert.equal(
      historicalFinished,
      false,
      'Historical matching should wait for the correction transaction'
    );

    console.log(
      'PASS: Historical matching waited for invoice correction'
    );

    // Release Connection B's uncommitted correction.

    await b.query('ROLLBACK');
    bTransaction = false;

    // Historical matching may now proceed because the
    // competing correction was rolled back.

    const historicalResult = await historicalPromise;

    assert.equal(historicalResult.rows.length, 1);

    assert.equal(
      historicalResult.rows[0].linked,
      true,
      'Historical matching should proceed after correction rollback'
    );

    console.log(
      'PASS: Historical matching resumed after correction rollback'
    );

    // Verify the historical link was created within
    // Connection A's uncommitted transaction.

    const linkedLine = await a.query(
      `
      SELECT ingredient_id
      FROM public.invoice_items
      WHERE id = $1
      `,
      [testInvoiceItemId]
    );

    assert.equal(
      linkedLine.rows[0].ingredient_id,
      testIngredientId
    );

    // Roll back the historical matching transaction.

    await a.query('ROLLBACK');
    aTransaction = false;

    console.log('PASS: Historical matching transaction rolled back');

    // =========================================================
    // TEST 22B: EXISTING MANUAL CORRECTION PROTECTION
    // =========================================================

    await a.query('BEGIN');
    aTransaction = true;

    await a.query("SET LOCAL lock_timeout = '8s'");

    // Establish another temporary historical lease.

    const secondLease = require('node:crypto').randomUUID();

    const secondLeaseResult = await a.query(
      `
      UPDATE public.historical_invoice_match_jobs
      SET
        lease_token = $2,
        lease_until = now() + interval '10 minutes'
      WHERE restaurant_id = $1
      RETURNING generation
      `,
      [testRestaurantId, secondLease]
    );

    assert.equal(secondLeaseResult.rows.length, 1);

    // Simulate an already-applied manual ingredient correction.

    await a.query(
      `
      UPDATE public.invoice_items
      SET ingredient_id = $2
      WHERE id = $1
      `,
      [testInvoiceItemId, testIngredientId]
    );

    // Attempt historical matching against an already-linked line.

    const protectedResult = await a.query(
      `
      SELECT public.link_historical_invoice_item(
        $1, $2, $3, $4, $5
      ) AS linked
      `,
      [
        testRestaurantId,
        testInvoiceItemId,
        testIngredientId,
        secondLease,
        secondLeaseResult.rows[0].generation,
      ]
    );

    assert.equal(
      protectedResult.rows[0].linked,
      false,
      'Historical matching must not overwrite an existing ingredient link'
    );

    console.log(
      'PASS: Historical matching refused an already-linked invoice line'
    );

    // Verify the manually selected ingredient is unchanged.

    const protectedLine = await a.query(
      `
      SELECT ingredient_id
      FROM public.invoice_items
      WHERE id = $1
      `,
      [testInvoiceItemId]
    );

    assert.equal(
      protectedLine.rows[0].ingredient_id,
      testIngredientId
    );

    await a.query('ROLLBACK');
    aTransaction = false;

    // Verify all test changes were discarded.

    const finalLine = await a.query(
      `
      SELECT ingredient_id, reviewed
      FROM public.invoice_items
      WHERE id = $1
      `,
      [testInvoiceItemId]
    );

    assert.equal(finalLine.rows.length, 1);
    assert.equal(finalLine.rows[0].ingredient_id, null);
    assert.equal(finalLine.rows[0].reviewed, false);

    console.log('PASS: Original invoice state preserved');

    console.log('\nTEST 22 PASSED: Historical matching protection');

  } finally {
    // Never intentionally commit either transaction.

    if (aConnected && aTransaction) {
      await a.query('ROLLBACK').catch(() => {});
    }

    if (bConnected && bTransaction) {
      await b.query('ROLLBACK').catch(() => {});
    }

    if (aConnected) {
      await a.end().catch(() => {});
    }

    if (bConnected) {
      await b.end().catch(() => {});
    }
  }
}

main().catch(error => {
  console.error(
    '\nCONCURRENCY TEST FAILED:',
    error.message
  );

  process.exitCode = 1;
});