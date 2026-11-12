
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import {
  createInvoiceSourceProof,
} from '../lib/invoiceSourceProof.js';

import {
  deliverInvoiceV2Proofs,
} from '../lib/invoiceV2ProofDelivery.js';

import { createConfirmInvoiceHandler } from '../pages/api/invoices/confirm-invoice.js';
import { resolveInvoiceResearchCost } from '../lib/invoiceResearchCosting.js';
import { validateInvoiceAgainstSource } from '../lib/invoiceSourceValidation.js';

const RESTAURANT_ID = 'restaurant-test-1';

function createDb({
  status = 'legacy_enabled',
  ownedIngredients = {},
  matchingControlError = null,
  transactionError = null,
} = {}) {
  const writes = [];
  const rpcCalls = [];

  const db = {
    storage: {
      from(bucket) {
        assert.equal(bucket, 'invoices');

        return {
          async download(path) {
            assert.equal(path, `${RESTAURANT_ID}/test-invoice.pdf`);

            const bytes = Buffer.from(
              'Synthetic authenticated invoice document'
            );

            return {
              data: {
                async arrayBuffer() {
                  return Uint8Array.from(bytes).buffer;
                },
              },
              error: null,
            };
          },
        };
      },
    },

    rpc(functionName, args) {
      rpcCalls.push({ functionName, args });

      if (
        functionName === 'save_invoice_confirmation_transactional'
      ) {
        if (transactionError) {
          return Promise.resolve({
            data: null,
            error: {
              message: transactionError,
            },
          });
        }

        return Promise.resolve({
          data: {
            success: true,
            invoice_id:
              args.p_append_to_invoice_id ||
              args.p_invoice.id,
            lines_saved: args.p_lines.length,
            files_saved: args.p_files.length,
            evidence_saved: args.p_evidence.length,
            replayed: false,
          },
          error: null,
        });
      }
      if (functionName === 'recipe_setup_catalog') {
        assert.equal(args.p_restaurant, RESTAURANT_ID);

        return Promise.resolve({
          data: [],
          error: null,
        });
      }

      return Promise.resolve({
        data: null,
        error: {
          message: `Unexpected RPC in test: ${functionName}`,
        },
      });
    },

    from(table) {
      const state = {
        operation: null,
        rows: null,
        filters: [],
      };

      const query = {
        insert(rows) {
          state.operation = 'insert';
          state.rows = rows;
          writes.push({ table, operation: 'insert', rows });
          return query;
        },

        update(rows) {
          state.operation = 'update';
          state.rows = rows;
          writes.push({ table, operation: 'update', rows });
          return query;
        },

        select() {
          return query;
        },

        eq(column, value) {
          state.filters.push({ column, value });
          return query;
        },

        in(column, values) {
          state.filters.push({ column, values });
          return query;
        },

        limit() {
          return query;
        },

        order() {
          return query;
        },

        maybeSingle() {
          if (table === 'restaurant_invoice_matching_controls') {
            if (matchingControlError) {
              return Promise.resolve({
                data: null,
                error: matchingControlError,
              });
            }

            return Promise.resolve({
              data: {
                restaurant_id: RESTAURANT_ID,
                status,
              },
              error: null,
            });
          }

          return Promise.resolve({
            data: null,
            error: null,
          });
        },

        single() {
          if (
            table === 'invoices' &&
            state.operation === 'insert'
          ) {
            return Promise.resolve({
              data: { id: 'invoice-test-1' },
              error: null,
            });
          }

          if (table === 'ingredients') {
            const id = state.filters.find(
              f => f.column === 'id'
            )?.value;

            const name = ownedIngredients[id];

            return Promise.resolve({
              data: name ? { name } : null,
              error: name
                ? null
                : { message: 'Ingredient not found' },
            });
          }

          return Promise.resolve({
            data: null,
            error: null,
          });
        },

        then(resolve, reject) {
          let data = [];

          if (
            table === 'ingredients' &&
            state.operation === null
          ) {
            const requested = state.filters.find(
              f => f.column === 'id' && f.values
            )?.values;

            if (requested) {
              data = requested
                .filter(id =>
                  Object.hasOwn(ownedIngredients, id)
                )
                .map(id => ({ id }));
            } else {
              data = Object.keys(ownedIngredients).map(
                id => ({
                  id,
                  last_ordered_at: null,
                })
              );
            }
          }

          return Promise.resolve({
            data,
            error: null,
          }).then(resolve, reject);
        },
      };

      return query;
    },
  };

  return { db, writes, rpcCalls };
}

function createRequest({ number, item }) {
  return {
    method: 'POST',
    headers: {},
    body: {
      restaurant_id: RESTAURANT_ID,
      confirmation_request_id:
        'test-confirmation-request-000001',
      invoice: {
        supplier: 'Example Distributor',
        invoice_number: number,
        invoice_date: '2026-10-27',
        total_amount: item.line_total,
      },
      line_items: [item],
    },
  };
}

function createResponse() {
  return {
    statusCode: 200,

    status(code) {
      this.statusCode = code;
      return this;
    },

    json(body) {
      this.body = body;
      return this;
    },

    end() {
      return this;
    },
  };
}

function createHandler(
  db,
  resolveCost,
  {
    recompute,
    rebuild,
    processCalculations,
    scheduleCalculations,
  } = {}
) {
  return createConfirmInvoiceHandler({
    db,
    verifyAccess: async () => ({ error: null }),
    resolveCost,
    recompute:
      recompute ||
      (async () => ({ updated: 0, blocked: [] })),
    rebuild:
      rebuild ||
      (async () => {}),
    processCalculations:
      processCalculations ||
      (async () => ({ skipped: true, errors: [] })),
    scheduleCalculations:
      scheduleCalculations ||
      (promise => promise),
  });
}

function unverifiedCost(item, supplier, options) {
  return resolveInvoiceResearchCost(item, supplier, {
    ...options,
    enabled: false,
  });
}

const SOURCE_TEST_SECRET =
  'synthetic-invoice-source-proof-secret-for-testing-2026';

const SOURCE_TEST_DOCUMENT = Buffer.from(
  'Synthetic authenticated invoice document'
);

const SOURCE_TEST_FINGERPRINT = createHash('sha256')
  .update(SOURCE_TEST_DOCUMENT)
  .digest('hex');

function sourceValidatedItem(overrides = {}) {
  return {
    _id: 'item_0',
    item_name_raw: 'MUSTARD DIJON SMOOTH',
    item_name_normalized: 'Mustard Dijon Smooth',
    quantity_shipped: 1,
    pack_size_raw: '4 1 QT',
    pack: 4,
    size: 1,
    size_unit: 'qt',
    invoice_price: 30,
    line_total: 30,
    catch_weight: false,
    source_validation_status: 'source_table_consistent',
    ...overrides,
  };
}

function signedSourceItem(invoiceNumber = 'CTB-2111') {
  const item = sourceValidatedItem();

  return {
    ...item,
    invoice_source_proof: createInvoiceSourceProof({
      restaurantId: RESTAURANT_ID,
      invoiceNumber,
      documentFingerprint: SOURCE_TEST_FINGERPRINT,
      itemKey: item._id,
      item,
      secret: SOURCE_TEST_SECRET,
    }),
  };
}


async function withEvidencePersistence(callback) {
  const previousFlag =
    process.env.INVOICE_SOURCE_EVIDENCE_PERSISTENCE_ENABLED;

  const previousAllowlist =
    process.env.INVOICE_SOURCE_EVIDENCE_PERSISTENCE_RESTAURANT_ID;

  const previousSecret =
    process.env.INVOICE_SOURCE_PROOF_SECRET;

  process.env.INVOICE_SOURCE_EVIDENCE_PERSISTENCE_ENABLED =
    'true';

  process.env.INVOICE_SOURCE_EVIDENCE_PERSISTENCE_RESTAURANT_ID =
    RESTAURANT_ID;

  process.env.INVOICE_SOURCE_PROOF_SECRET =
    SOURCE_TEST_SECRET;

  try {
    return await callback();
  } finally {
    if (previousFlag === undefined) {
      delete process.env.INVOICE_SOURCE_EVIDENCE_PERSISTENCE_ENABLED;
    } else {
      process.env.INVOICE_SOURCE_EVIDENCE_PERSISTENCE_ENABLED =
        previousFlag;
    }

    if (previousAllowlist === undefined) {
      delete process.env.INVOICE_SOURCE_EVIDENCE_PERSISTENCE_RESTAURANT_ID;
    } else {
      process.env.INVOICE_SOURCE_EVIDENCE_PERSISTENCE_RESTAURANT_ID =
        previousAllowlist;
    }

    if (previousSecret === undefined) {
      delete process.env.INVOICE_SOURCE_PROOF_SECRET;
    } else {
      process.env.INVOICE_SOURCE_PROOF_SECRET =
        previousSecret;
    }
  }
}

// TEST 1
// Unverified numbered-can packaging must not overwrite
// an existing ingredient's verified price.

test(
  'unverified numbered can cannot overwrite existing price',
  async () => {
    const { db, writes } = createDb({
      ownedIngredients: {
        'ingredient-test-1': 'Strawberry Glaze',
      },
    });

    let researchCalls = 0;

    const handler = createHandler(
      db,
      async (...args) => {
        researchCalls++;
        return unverifiedCost(...args);
      }
    );

    const req = createRequest({
      number: 'TEST-001',
      item: {
        _id: 'line-test-1',
        item_name: 'Strawberry Glaze',
        selected_ingredient_id: 'ingredient-test-1',
        selected_ingredient_name: 'Strawberry Glaze',
        match_status: 'matched',
        pack_size_raw: '3/#10 CAN',
        quantity_shipped: 1,
        invoice_price: 50.78,
        line_total: 50.78,
      },
    });

    const res = createResponse();

    await handler(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.equal(researchCalls, 1);

    assert.equal(
      writes.filter(
        w =>
          w.table === 'ingredients' &&
          w.operation === 'update'
      ).length,
      0
    );

    assert.equal(
      writes.filter(
        w =>
          w.table === 'ingredients' &&
          w.operation === 'insert'
      ).length,
      0
    );

    const line = writes.find(
      w => w.table === 'invoice_items'
    )?.rows[0];

    assert.ok(line);
    assert.equal(line.quantity, 3);
    assert.equal(line.unit, 'can');
    assert.equal(line.unit_cost, null);
    assert.equal(line.amount, 50.78);
    assert.equal(line.ingredient_id, 'ingredient-test-1');
  }
);

// TEST 2
// An unmatched invoice product must remain unlinked.
// Invoice confirmation must never create an ingredient.

test(
  'new unverified numbered-can item remains unlinked and creates no ingredient',
  async () => {
    const { db, writes } = createDb();

    const handler = createHandler(
      db,
      unverifiedCost
    );

    const req = createRequest({
      number: 'TEST-002',
      item: {
        _id: 'new-line-1',
        item_name: 'Strawberry Glaze',
        match_status: 'new',
        pack_size_raw: '3/#10 CAN',
        quantity_shipped: 1,
        invoice_price: 50.78,
        line_total: 50.78,
      },
    });

    const res = createResponse();

    await handler(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.ingredients_created, 0);
    assert.equal(res.body.ingredients_updated, 0);

    assert.equal(
      writes.filter(
        w => w.table === 'ingredients'
      ).length,
      0
    );

    const line = writes.find(
      w => w.table === 'invoice_items'
    )?.rows[0];

    assert.ok(line);
    assert.equal(line.quantity, 3);
    assert.equal(line.unit, 'can');
    assert.equal(line.unit_cost, null);
    assert.equal(line.amount, 50.78);
    assert.equal(line.ingredient_id, null);
  }
);

// TEST 3
// Verified numbered-can conversion must produce
// consistent invoice and ingredient pricing.

test(
  'verified numbered-can pricing agrees across ingredient and invoice history',
  async () => {
    const { db, writes } = createDb({
      ownedIngredients: {
        'ingredient-test-1': 'Strawberry Glaze',
      },
    });

    const verifiedResult = {
      status: 'verified',
      verificationStatus: 'verified',
      conversionApproved: true,
      sourceConsensus: {
        conversionApproved: true,
      },
      conversion: {
        fromUnit: 'can',
        toUnit: 'oz',
        factor: 104,
        scope: 'per_container',
        basis: 'authenticated_supplier_record',
      },
    };

    const handler = createHandler(
      db,
      (item, supplier) =>
        resolveInvoiceResearchCost(item, supplier, {
          enabled: true,
          researchProduct: async () => verifiedResult,
        })
    );

    const req = createRequest({
      number: 'TEST-003',
      item: {
        _id: 'verified-line-1',
        item_name: 'Strawberry Glaze',
        supplier_sku: 'SUP456',
        brand: 'Example Foods',
        selected_ingredient_id: 'ingredient-test-1',
        selected_ingredient_name: 'Strawberry Glaze',
        match_status: 'matched',
        pack_size_raw: '3/#10 CAN',
        quantity_shipped: 1,
        invoice_price: 50.78,
        line_total: 50.78,
      },
    });

    const res = createResponse();

    await handler(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);

    const ingredientUpdate = writes.find(
      w =>
        w.table === 'ingredients' &&
        w.operation === 'update'
    );

    assert.ok(ingredientUpdate);

    const line = writes.find(
      w => w.table === 'invoice_items'
    )?.rows[0];

    assert.ok(line);
    assert.equal(line.quantity, 312);
    assert.equal(line.unit, 'oz');

    assert.ok(
      Math.abs(line.unit_cost - 50.78 / 312) < 1e-10
    );

    assert.equal(ingredientUpdate.rows.unit, 'oz');

    assert.ok(
      Math.abs(
        ingredientUpdate.rows.last_price -
        line.unit_cost
      ) < 1e-10
    );

    assert.equal(
      writes.filter(
        w =>
          w.table === 'ingredients' &&
          w.operation === 'insert'
      ).length,
      0
    );
  }
);

// TEST 4
// Ordinary invoice products must retain their
// established unit and pricing calculations.

test(
  'ordinary invoice products retain correct ingredient and invoice pricing',
  async () => {
    const { db, writes } = createDb({
      ownedIngredients: {
        'ingredient-beef-1': 'Ground Beef',
      },
    });

    let researchCalls = 0;

    const handler = createHandler(
      db,
      (item, supplier) =>
        resolveInvoiceResearchCost(item, supplier, {
          enabled: true,
          researchProduct: async () => {
            researchCalls++;
            throw new Error(
              'Ordinary products must not trigger research'
            );
          },
        })
    );

    const req = createRequest({
      number: 'TEST-004',
      item: {
        _id: 'ordinary-line-1',
        item_name: 'Ground Beef',
        selected_ingredient_id: 'ingredient-beef-1',
        selected_ingredient_name: 'Ground Beef',
        match_status: 'matched',
        pack_size_raw: '2/5 LB',
        pack: 2,
        size: 5,
        size_unit: 'lb',
        quantity_shipped: 1,
        invoice_price: 40,
        line_total: 40,
      },
    });

    const res = createResponse();

    await handler(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.equal(researchCalls, 0);

    const ingredientUpdate = writes.find(
      w =>
        w.table === 'ingredients' &&
        w.operation === 'update'
    );

    // The invoice retains its accurate calculated cost,
    // but document consistency alone does not authorize
    // a verified ingredient-price update.
    assert.equal(ingredientUpdate, undefined);

    const line = writes.find(
      w => w.table === 'invoice_items'
    )?.rows[0];

    assert.ok(line);
    assert.equal(line.quantity, 10);
    assert.equal(line.unit, 'lb');
    assert.equal(line.unit_cost, 4);
    assert.equal(line.amount, 40);
    assert.equal(
      line.price_verification_status,
      'unknown'
    );
  }
);

// TEST 5
// Locked restaurants may save invoice data but
// cannot create links or modify ingredient pricing.

test(
  'locked restaurant saves invoice lines without ingredient links or pricing updates',
  async () => {
    const { db, writes } = createDb({
      status: 'locked',
      ownedIngredients: {
        'ingredient-beef-1': 'Ground Beef',
      },
    });

    let recomputeCalls = 0;
    let rebuildCalls = 0;

    const handler = createHandler(
      db,
      unverifiedCost,
      {
        recompute: async () => {
          recomputeCalls++;
        },
        rebuild: async () => {
          rebuildCalls++;
        },
      }
    );

    const req = createRequest({
      number: 'TEST-005',
      item: {
        _id: 'locked-line-1',
        item_name: 'Ground Beef',
        selected_ingredient_id: 'ingredient-beef-1',
        selected_ingredient_name: 'Ground Beef',
        match_status: 'matched',
        pack: 2,
        size: 5,
        size_unit: 'lb',
        quantity_shipped: 1,
        invoice_price: 40,
        line_total: 40,
        match_candidates: [
          {
            id: 'ingredient-beef-1',
            name: 'Ground Beef',
          },
        ],
      },
    });

    const res = createResponse();

    await handler(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);

    const line = writes.find(
      w => w.table === 'invoice_items'
    )?.rows[0];

    assert.ok(line);
    assert.equal(line.ingredient_id, null);
    assert.equal(line.match_candidates, null);

    assert.equal(
      writes.filter(
        w => w.table === 'ingredients'
      ).length,
      0
    );

    assert.equal(recomputeCalls, 0);
    assert.equal(rebuildCalls, 0);
  }
);

// TEST 6
// An ingredient owned by another restaurant must
// be rejected before the invoice is created.

test(
  'ingredient from another restaurant is rejected before invoice creation',
  async () => {
    const { db, writes } = createDb();

    const handler = createHandler(
      db,
      unverifiedCost
    );

    const req = createRequest({
      number: 'TEST-006',
      item: {
        _id: 'foreign-line-1',
        item_name: 'Ground Beef',
        selected_ingredient_id: 'ingredient-other-restaurant',
        match_status: 'matched',
        pack: 2,
        size: 5,
        size_unit: 'lb',
        quantity_shipped: 1,
        invoice_price: 40,
        line_total: 40,
      },
    });

    const res = createResponse();

    await handler(req, res);

    assert.equal(res.statusCode, 400);

    assert.match(
      res.body.error,
      /does not belong to this restaurant/i
    );

    assert.equal(writes.length, 0);
  }
);

// ============================================================
// Finding #020 — Transactional evidence integration
// ============================================================

test(
  'authenticated invoice evidence reaches the transactional writer',
  async () => {
    await withEvidencePersistence(async () => {
      const { db, writes, rpcCalls } = createDb();

      const handler = createHandler(
        db,
        unverifiedCost
      );

      const req = createRequest({
        number: 'CTB-2111',
        item: signedSourceItem(),
      });

      req.body.file_urls = [
        `${RESTAURANT_ID}/test-invoice.pdf`,
      ];

      const res = createResponse();

      await handler(req, res);

      assert.equal(res.statusCode, 200);
      assert.equal(res.body.success, true);

      const transaction = rpcCalls.find(
        call =>
          call.functionName ===
          'save_invoice_confirmation_transactional'
      );

      assert.ok(transaction);

      assert.equal(
        transaction.args.p_lines.length,
        1
      );

      assert.equal(
        transaction.args.p_evidence.length,
        1
      );

      const line = transaction.args.p_lines[0];
      const evidence = transaction.args.p_evidence[0];

      assert.equal(
        evidence.invoice_item_id,
        line.id
      );

      assert.equal(
        evidence.invoice_id,
        line.invoice_id
      );

      assert.equal(line.quantity, 4);
      assert.equal(line.unit, 'qt');
      assert.equal(line.unit_cost, 7.5);
      assert.equal(line.amount, 30);

      assert.equal(
        evidence.evidence.pricing.quantity,
        4
      );

      assert.equal(
        evidence.evidence.pricing.unit_cost,
        7.5
      );

      // The new pathway must not separately insert lines.
      assert.equal(
        writes.filter(
          write =>
            write.table === 'invoice_items' &&
            write.operation === 'insert'
        ).length,
        0
      );

      // Document-supported evidence must not
      // automatically update ingredient prices yet.
      assert.equal(
        writes.filter(
          write =>
            write.table === 'ingredients' &&
            write.operation === 'update'
        ).length,
        0
      );
    });
  }
);

test(
  'ordinary invoice without proof remains compatible with transactional persistence',
  async () => {
    await withEvidencePersistence(async () => {
      const { db, writes, rpcCalls } = createDb();

      const handler = createHandler(
        db,
        unverifiedCost
      );

      const req = createRequest({
        number: 'CTB-2112',
        item: {
          _id: 'ordinary-item-1',
          item_name_raw: 'GROUND BEEF',
          item_name_normalized: 'Ground Beef',
          pack_size_raw: '2/5 LB',
          pack: 2,
          size: 5,
          size_unit: 'lb',
          quantity_shipped: 1,
          invoice_price: 40,
          line_total: 40,
        },
      });

      const res = createResponse();

      await handler(req, res);

      assert.equal(res.statusCode, 200);
      assert.equal(res.body.success, true);

      const transaction = rpcCalls.find(
        call =>
          call.functionName ===
          'save_invoice_confirmation_transactional'
      );

      assert.ok(transaction);

      assert.equal(
        transaction.args.p_lines.length,
        1
      );

      assert.deepEqual(
        transaction.args.p_evidence,
        []
      );

      assert.equal(
        transaction.args.p_lines[0].price_verification_status,
        'unknown'
      );

      assert.equal(
        writes.filter(
          write =>
            write.table === 'invoice_items' &&
            write.operation === 'insert'
        ).length,
        0
      );
    });
  }
);

test(
  'transaction failure never falls back to separate invoice-line insertion',
  async () => {
    await withEvidencePersistence(async () => {
      const { db, writes, rpcCalls } = createDb({
        transactionError:
          'Simulated transactional database failure',
      });

      const handler = createHandler(
        db,
        unverifiedCost
      );

      const req = createRequest({
        number: 'CTB-2113',
        item: signedSourceItem('CTB-2113'),
      });

      req.body.file_urls = [
        `${RESTAURANT_ID}/test-invoice.pdf`,
      ];

      const res = createResponse();

      await handler(req, res);

      assert.equal(res.statusCode, 500);
      assert.equal(res.body.success, false);

      assert.ok(
        rpcCalls.some(
          call =>
            call.functionName ===
            'save_invoice_confirmation_transactional'
        )
      );

      assert.equal(
        writes.filter(
          write =>
            write.table === 'invoice_items' &&
            write.operation === 'insert'
        ).length,
        0
      );

      assert.equal(
        writes.filter(
          write =>
            write.table === 'ingredients' &&
            write.operation === 'update'
        ).length,
        0
      );
    });
  }
);

test(
  'modified signed invoice values are rejected before transactional persistence',
  async () => {
    await withEvidencePersistence(async () => {
      const { db, rpcCalls } = createDb();

      const handler = createHandler(
        db,
        unverifiedCost
      );

      const item = signedSourceItem('CTB-2114');

      // Change the source package after signing.
      item.pack = 8;

      const req = createRequest({
        number: 'CTB-2114',
        item,
      });

      req.body.file_urls = [
        `${RESTAURANT_ID}/test-invoice.pdf`,
      ];

      const res = createResponse();

      await handler(req, res);

      assert.equal(res.statusCode, 422);

      assert.equal(
        rpcCalls.filter(
          call =>
            call.functionName ===
            'save_invoice_confirmation_transactional'
        ).length,
        0
      );
    });
  }
);

// ============================================================
// Finding #020 — Stateful transactional confirmation mock
// ============================================================

function installIdempotentTransactionMock(db) {
  const originalRpc = db.rpc.bind(db);
  const receipts = new Map();
  const calls = [];

  let failNext = false;

  db.rpc = async (functionName, args) => {
    if (
      functionName !==
      'save_invoice_confirmation_transactional'
    ) {
      return originalRpc(functionName, args);
    }

    calls.push(args);

    if (failNext) {
      failNext = false;

      return {
        data: null,
        error: {
          message: 'Simulated atomic transaction failure',
        },
      };
    }

    const key = JSON.stringify([
      args.p_restaurant_id,
      args.p_request_id,
    ]);

    const existing = receipts.get(key);

    if (existing) {
      if (
        existing.fingerprint !==
        args.p_request_fingerprint
      ) {
        return {
          data: null,
          error: {
            message:
              'Confirmation request ID was reused with different contents',
          },
        };
      }

      return {
        data: {
          ...existing.result,
          replayed: true,
        },
        error: null,
      };
    }

    const result = {
      success: true,
      invoice_id:
        args.p_append_to_invoice_id ||
        args.p_invoice.id,
      lines_saved: args.p_lines.length,
      files_saved: args.p_files.length,
      evidence_saved: args.p_evidence.length,
      replayed: false,
    };

    receipts.set(key, {
      fingerprint: args.p_request_fingerprint,
      result,
    });

    return {
      data: result,
      error: null,
    };
  };

  return {
    calls,
    receipts,
    failNextTransaction() {
      failNext = true;
    },
  };
}

function ordinaryTransactionalRequest(
  number,
  requestId = 'confirmation-request-idempotency-001'
) {
  const req = createRequest({
    number,
    item: {
      _id: 'ordinary-transaction-line',
      item_name_raw: 'GROUND BEEF',
      item_name_normalized: 'Ground Beef',
      pack_size_raw: '2/5 LB',
      pack: 2,
      size: 5,
      size_unit: 'lb',
      quantity_shipped: 1,
      invoice_price: 40,
      line_total: 40,
    },
  });

  req.body.confirmation_request_id = requestId;

  return req;
}

// TEST 11
// An identical retry must return the original invoice
// rather than creating a second invoice.

test(
  'identical confirmation retry returns original invoice',
  async () => {
    await withEvidencePersistence(async () => {
      const { db, writes } = createDb();

      const transactions =
        installIdempotentTransactionMock(db);

      const handler = createHandler(
        db,
        unverifiedCost
      );

      const req = ordinaryTransactionalRequest(
        'CTB-2115'
      );

      const first = createResponse();
      await handler(req, first);

      assert.equal(first.statusCode, 200);
      assert.equal(first.body.success, true);

      const second = createResponse();
      await handler(req, second);

      assert.equal(second.statusCode, 200);
      assert.equal(second.body.success, true);
      assert.equal(second.body.replayed, true);

      assert.equal(
        second.body.invoice_id,
        first.body.invoice_id
      );

      assert.equal(
        transactions.receipts.size,
        1
      );

      assert.equal(
        transactions.calls[0].p_request_fingerprint,
        transactions.calls[1].p_request_fingerprint
      );

      assert.equal(
        writes.filter(
          write =>
            write.table === 'invoices' &&
            write.operation === 'insert'
        ).length,
        0
      );
    });
  }
);

// TEST 12
// Reusing a request ID after changing invoice contents
// must be rejected rather than silently treated as a retry.

test(
  'confirmation request ID cannot be reused with changed contents',
  async () => {
    await withEvidencePersistence(async () => {
      const { db } = createDb();

      const transactions =
        installIdempotentTransactionMock(db);

      const handler = createHandler(
        db,
        unverifiedCost
      );

      const firstRequest =
        ordinaryTransactionalRequest('CTB-2116');

      const first = createResponse();
      await handler(firstRequest, first);

      assert.equal(first.statusCode, 200);

      const modifiedRequest =
        ordinaryTransactionalRequest('CTB-2116');

      modifiedRequest.body.invoice.total_amount = 45;

      const second = createResponse();
      await handler(modifiedRequest, second);

      assert.equal(second.statusCode, 409);
      assert.equal(second.body.success, false);

      assert.equal(
        transactions.receipts.size,
        1
      );

      assert.notEqual(
        transactions.calls[0].p_request_fingerprint,
        transactions.calls[1].p_request_fingerprint
      );
    });
  }
);

// TEST 13
// A database failure cannot create a successful receipt.
// Retrying the same request must remain possible.

test(
  'failed transaction can be retried without duplicate invoice',
  async () => {
    await withEvidencePersistence(async () => {
      const { db, writes } = createDb();

      const transactions =
        installIdempotentTransactionMock(db);

      transactions.failNextTransaction();

      const handler = createHandler(
        db,
        unverifiedCost
      );

      const req = ordinaryTransactionalRequest(
        'CTB-2117'
      );

      const failed = createResponse();
      await handler(req, failed);

      assert.equal(failed.statusCode, 500);

      assert.equal(
        transactions.receipts.size,
        0
      );

      const retried = createResponse();
      await handler(req, retried);

      assert.equal(retried.statusCode, 200);
      assert.equal(retried.body.success, true);

      assert.equal(
        transactions.receipts.size,
        1
      );

      assert.equal(
        writes.filter(
          write =>
            write.table === 'invoice_items' &&
            write.operation === 'insert'
        ).length,
        0
      );
    });
  }
);

// TEST 14
// Failed transactions and successful replays must not
// trigger duplicate downstream inventory operations.

test(
  'failed transactions and replays do not repeat inventory rebuilds',
  async () => {
    await withEvidencePersistence(async () => {
      const { db, writes } = createDb({
        ownedIngredients: {
          'ingredient-beef-1': 'Ground Beef',
        },
      });

      const transactions =
        installIdempotentTransactionMock(db);

      let rebuildCalls = 0;
      let recomputeCalls = 0;

      const handler = createHandler(
        db,
        unverifiedCost,
        {
          rebuild: async () => {
            rebuildCalls++;
          },
          recompute: async () => {
            recomputeCalls++;
          },
        }
      );

      const req = ordinaryTransactionalRequest(
        'CTB-2118'
      );

      req.body.line_items[0].selected_ingredient_id =
        'ingredient-beef-1';

      req.body.line_items[0].selected_ingredient_name =
        'Ground Beef';

      req.body.line_items[0].match_status = 'matched';

      transactions.failNextTransaction();

      const failed = createResponse();
      await handler(req, failed);

      assert.equal(failed.statusCode, 500);
      assert.equal(rebuildCalls, 0);
      assert.equal(recomputeCalls, 0);

      const saved = createResponse();
      await handler(req, saved);

      assert.equal(saved.statusCode, 200);

      // Transactional confirmations queue inventory work
      // for durable processing instead of rebuilding
      // inventory directly during invoice confirmation.
      assert.equal(rebuildCalls, 0);

      // Verify that the transaction requested
      // durable recalculation.
      assert.equal(
        transactions.calls.at(-1).p_queue_calculations,
        true
      );

      const replayed = createResponse();
      await handler(req, replayed);

      assert.equal(replayed.statusCode, 200);
      assert.equal(replayed.body.replayed, true);

      assert.equal(
        rebuildCalls,
        0,
        'Transactional confirmations must leave inventory rebuilding to the durable job processor'
      );

      assert.equal(recomputeCalls, 0);

      // Transactional confirmation must not perform
      // separate ingredient writes after committing.
      const ingredientUpdates = writes.filter(
        write =>
          write.table === 'ingredients' &&
          write.operation === 'update'
      );

      assert.equal(
        ingredientUpdates.length,
        0,
        'Transactional confirmation must leave ingredient repricing to the queued calculation worker'
      );
    });
  }
);

// TEST 15
// Supplier-verified invoice pricing must remain available
// in legacy mode, but transactional confirmation must leave
// all ingredient repricing to the queued calculation worker.

test(
  'supplier-verified pricing respects transactional confirmation boundary',
  async () => {
    const verifiedResult = {
      status: 'verified',
      verificationStatus: 'verified',
      conversionApproved: true,
      sourceConsensus: {
        conversionApproved: true,
      },
      conversion: {
        fromUnit: 'can',
        toUnit: 'oz',
        factor: 104,
        scope: 'per_container',
        basis: 'authenticated_supplier_record',
      },
    };

    const resolveVerifiedCost = (item, supplier) =>
      resolveInvoiceResearchCost(item, supplier, {
        enabled: true,
        researchProduct: async () => verifiedResult,
      });

    const makeRequest = () =>
      createRequest({
        number: 'TEST-015',
        item: {
          _id: 'verified-line-15',
          item_name: 'Strawberry Glaze',
          supplier_sku: 'SUP456',
          brand: 'Example Foods',
          selected_ingredient_id: 'ingredient-test-1',
          selected_ingredient_name: 'Strawberry Glaze',
          match_status: 'matched',
          pack_size_raw: '3/#10 CAN',
          quantity_shipped: 1,
          invoice_price: 50.78,
          line_total: 50.78,
        },
      });

    const ownedIngredients = {
      'ingredient-test-1': 'Strawberry Glaze',
    };

    // --------------------------------------------------
    // Part A: Legacy confirmation
    // --------------------------------------------------

    const legacy = createDb({
      ownedIngredients,
    });

    const legacyHandler = createHandler(
      legacy.db,
      resolveVerifiedCost
    );

    const legacyResponse = createResponse();

    await legacyHandler(
      makeRequest(),
      legacyResponse
    );

    assert.equal(legacyResponse.statusCode, 200);
    assert.equal(legacyResponse.body.success, true);

    const legacyIngredientUpdates =
      legacy.writes.filter(
        write =>
          write.table === 'ingredients' &&
          write.operation === 'update'
      );

    assert.equal(
      legacyIngredientUpdates.length,
      1,
      'Legacy supplier-verified pricing must remain functional'
    );

    assert.equal(
      legacyIngredientUpdates[0].rows.unit,
      'oz'
    );

    assert.ok(
      Math.abs(
        legacyIngredientUpdates[0].rows.last_price -
        50.78 / 312
      ) < 1e-10
    );

    console.log(
      'PASS: Legacy supplier-verified pricing preserved'
    );

    // --------------------------------------------------
    // Part B: Transactional confirmation
    // --------------------------------------------------

    await withEvidencePersistence(async () => {
      const transactional = createDb({
        ownedIngredients,
      });

      let recomputeCalls = 0;
      let rebuildCalls = 0;

      const transactionalHandler = createHandler(
        transactional.db,
        resolveVerifiedCost,
        {
          recompute: async () => {
            recomputeCalls++;
          },
          rebuild: async () => {
            rebuildCalls++;
          },
        }
      );

      const response = createResponse();

      await transactionalHandler(
        makeRequest(),
        response
      );

      assert.equal(response.statusCode, 200);
      assert.equal(response.body.success, true);

      // The invoice must be saved through the
      // transactional database function.

      const confirmationCall =
        transactional.rpcCalls.find(
          call =>
            call.functionName ===
            'save_invoice_confirmation_transactional'
        );

      assert.ok(
        confirmationCall,
        'Transactional confirmation RPC was not called'
      );

      // The saved invoice line must retain its
      // supplier-verified standardized pricing.

      assert.equal(
        confirmationCall.args.p_lines.length,
        1
      );

      const savedLine =
        confirmationCall.args.p_lines[0];

      assert.equal(savedLine.quantity, 312);
      assert.equal(savedLine.unit, 'oz');

      assert.ok(
        Math.abs(
          savedLine.unit_cost - 50.78 / 312
        ) < 1e-10
      );

      // The transaction must request durable
      // calculation processing.

      assert.equal(
        confirmationCall.args.p_queue_calculations,
        true
      );

      // No separate ingredient update is permitted
      // after the transaction commits.

      const directIngredientUpdates =
        transactional.writes.filter(
          write =>
            write.table === 'ingredients' &&
            write.operation === 'update'
        );

      assert.equal(
        directIngredientUpdates.length,
        0,
        'Transactional confirmation must not directly update ingredient prices'
      );

      assert.equal(
        response.body.ingredients_updated,
        0
      );

      // Recipe costing and inventory are handled
      // by the queued calculation worker.

      assert.equal(recomputeCalls, 0);
      assert.equal(rebuildCalls, 0);

      console.log(
        'PASS: Transactional confirmation deferred ingredient repricing'
      );

      console.log(
        'PASS: Supplier-verified invoice retained its standardized pricing'
      );

      console.log(
        'PASS: Durable calculation job requested'
      );
    });
  }
);

// ============================================================
// Purchase-Level Invoice Pricing Integration
// ============================================================

// TEST 16
// Legacy confirmation must preserve the supplier's
// purchase-level information alongside ingredient costs.

test(
  'legacy confirmation preserves purchase and ingredient pricing',
  async () => {
    const { db, writes } = createDb();

    const handler = createHandler(db, unverifiedCost);

    const req = createRequest({
      number: 'PURCHASE-TEST-001',
      item: {
        _id: 'purchase-line-001',
        item_name_raw: 'GENERIC TORTILLAS',
        item_name_normalized: 'Generic Tortillas',
        quantity_shipped: 1,
        quantity_unit: 'CS',
        pack_size_raw: '300 CT',
        pack: 1,
        size: 300,
        size_unit: 'ct',
        invoice_price: 100,
        line_total: 100,
        catch_weight: false,
      },
    });

    const res = createResponse();

    await handler(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);

    const line = writes.find(
      w =>
        w.table === 'invoice_items' &&
        w.operation === 'insert'
    )?.rows[0];

    assert.ok(line);

    // Supplier purchasing information.
    assert.equal(line.purchase_quantity, 1);
    assert.equal(line.purchase_unit, 'case');
    assert.equal(line.purchase_unit_price, 100);
    assert.equal(line.package_quantity, 300);
    assert.equal(line.package_unit, 'each');
    assert.equal(line.package_description, '300 CT');

    assert.equal(
      line.package_validation_status,
      'invoice_document_consistent'
    );

    // Ingredient-level calculation.
    assert.equal(line.quantity, 300);
    assert.equal(line.unit, 'each');

    assert.ok(
      Math.abs(line.unit_cost - 100 / 300) < 1e-10
    );

    // Original financial amount remains unchanged.
    assert.equal(line.amount, 100);
  }
);


// TEST 17
// Transactional confirmation must receive exactly
// the same purchase-level and ingredient-level values.

test(
  'transactional confirmation preserves purchase and ingredient pricing',
  async () => {
    await withEvidencePersistence(async () => {
      const { db, rpcCalls, writes } = createDb();

      const handler = createHandler(db, unverifiedCost);

      const req = createRequest({
        number: 'PURCHASE-TEST-002',
        item: {
          _id: 'purchase-line-002',
          item_name_raw: 'GENERIC TORTILLAS',
          item_name_normalized: 'Generic Tortillas',
          quantity_shipped: 1,
          quantity_unit: 'CS',
          pack_size_raw: '300 CT',
          pack: 1,
          size: 300,
          size_unit: 'ct',
          invoice_price: 100,
          line_total: 100,
          catch_weight: false,
        },
      });

      const res = createResponse();

      await handler(req, res);

      assert.equal(res.statusCode, 200);
      assert.equal(res.body.success, true);

      const transaction = rpcCalls.find(
        call =>
          call.functionName ===
          'save_invoice_confirmation_transactional'
      );

      assert.ok(transaction);
      assert.equal(transaction.args.p_lines.length, 1);

      const line = transaction.args.p_lines[0];

      // Supplier purchasing information.
      assert.equal(line.purchase_quantity, 1);
      assert.equal(line.purchase_unit, 'case');
      assert.equal(line.purchase_unit_price, 100);
      assert.equal(line.package_quantity, 300);
      assert.equal(line.package_unit, 'each');
      assert.equal(line.package_description, '300 CT');

      assert.equal(
        line.package_validation_status,
        'invoice_document_consistent'
      );

      // Ingredient-level calculation.
      assert.equal(line.quantity, 300);
      assert.equal(line.unit, 'each');

      assert.ok(
        Math.abs(line.unit_cost - 100 / 300) < 1e-10
      );

      assert.equal(line.amount, 100);

      // Transactional mode must not separately
      // insert invoice items outside the RPC.
      assert.equal(
        writes.some(
          w =>
            w.table === 'invoice_items' &&
            w.operation === 'insert'
        ),
        false
      );
    });
  }
);


// TEST 18
// Unresolved packaging must preserve purchase
// information without inventing physical quantities.

test(
  'unresolved packaging preserves purchase price without fabricated unit cost',
  async () => {
    const { db, writes } = createDb();

    const handler = createHandler(db, unverifiedCost);

    const req = createRequest({
      number: 'PURCHASE-TEST-003',
      item: {
        _id: 'purchase-line-003',
        item_name_raw: 'GENERIC MIXED CASE',
        item_name_normalized: 'Generic Mixed Case',
        quantity_shipped: 1,
        quantity_unit: 'CS',
        pack_size_raw: 'MIXED CASE',
        invoice_price: 100,
        line_total: 100,
        catch_weight: false,
      },
    });

    const res = createResponse();

    await handler(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);

    const line = writes.find(
      w =>
        w.table === 'invoice_items' &&
        w.operation === 'insert'
    )?.rows[0];

    assert.ok(line);

    // Known supplier purchasing information.
    assert.equal(line.purchase_quantity, 1);
    assert.equal(line.purchase_unit, 'case');
    assert.equal(line.purchase_unit_price, 100);
    assert.equal(line.amount, 100);

    // Unknown physical conversion stays unresolved.
    assert.equal(line.package_quantity, null);
    assert.equal(line.package_unit, null);
    assert.equal(line.unit_cost, null);

    assert.equal(
      line.package_validation_status,
      'needs_package_verification'
    );
  }
);


test(
  'delivered V2 catch-weight proof reaches transactional confirmation without changing pricing',
  async () => {
    await withEvidencePersistence(async () => {
      const { db, rpcCalls, writes } = createDb();

      const header =
        '<tr><td>Item Number</td><td>Ordered</td>' +
        '<td>Shipped</td><td>Pack</td>' +
        '<td>Size</td><td>Unit</td>' +
        '<td>Description</td><td>Price</td>' +
        '<td>Extension</td></tr>';

      const bleachRow =
        '<tr><td>556332</td><td>1</td><td>1</td>' +
        '<td>6</td><td>1 GA</td><td></td>' +
        '<td>BLEACH GERMICIDAL</td>' +
        '<td>21.0000</td><td>21.00</td></tr>';

      const steakRow =
        '<tr><td>1030906</td><td>1</td><td>1</td>' +
        '<td>22</td><td>7 OZ</td><td>LB</td>' +
        '<td>BEEF SKIRT STEAK 9.96</td>' +
        '<td>14.5000</td><td>144.42</td></tr>';

      const ocrText =
        `<table>${header}${bleachRow}${steakRow}</table>`;

      const bleach = {
        item_name_raw: 'BLEACH GERMICIDAL',
        is_food: false,
        quantity_shipped: 1,
        invoice_price: 21,
        line_total: 21,
        catch_weight: false,
      };

      const steak = {
        item_name_raw: 'BEEF SKIRT STEAK 9.96',
        item_name_normalized: 'Beef Skirt Steak',
        is_food: true,
        quantity_shipped: 1,
        quantity_unit: 'LB',
        pack_size_raw: '22 7 OZ',
        pack: 22,
        size: 7,
        size_unit: 'oz',
        invoice_price: 14.5,
        line_total: 144.42,
        catch_weight: true,
        actual_weight: 9.96,
        source_evidence: {
          row_text: steakRow,
          description_text: 'BEEF SKIRT STEAK 9.96',
          quantity_text: '1',
          purchase_unit_text: 'LB',
          package_text: '22 7 OZ',
          weight_text: '9.96',
          weight_unit_text: 'LB',
          unit_price_text: '14.5000',
          extension_text: '144.42',
        },
      };

      const returnedSteak = {
        ...steak,
        _id: 'item_0',
        match_status: 'new',
      };

      const delivery = deliverInvoiceV2Proofs({
        allRaw: [bleach, steak],
        foodItems: [steak],
        lineItemsWithMatches: [returnedSteak],
        ocrText,
        restaurantId: RESTAURANT_ID,
        invoiceNumber: 'TEST-V2-1001',
        documentFingerprint: SOURCE_TEST_FINGERPRINT,
        secret: SOURCE_TEST_SECRET,
      });

      assert.equal(delivery.signed, 1);

      const handler = createHandler(
        db,
        unverifiedCost
      );

      const req = createRequest({
        number: 'TEST-V2-1001',
        item: returnedSteak,
      });

      req.body.file_urls = [
        `${RESTAURANT_ID}/test-invoice.pdf`,
      ];

      const res = createResponse();

      await handler(req, res);

      assert.equal(res.statusCode, 200);
      assert.equal(res.body.success, true);

      const transaction = rpcCalls.find(
        call =>
          call.functionName ===
          'save_invoice_confirmation_transactional'
      );

      assert.ok(transaction);
      assert.equal(transaction.args.p_lines.length, 1);
      assert.equal(transaction.args.p_evidence.length, 1);

      const line = transaction.args.p_lines[0];
      const savedEvidence =
        transaction.args.p_evidence[0];

      assert.equal(line.quantity, 9.96);
      assert.equal(line.unit, 'lb');
      assert.equal(line.unit_cost, 14.5);
      assert.equal(line.amount, 144.42);

      assert.equal(savedEvidence.evidence_version, 2);

      assert.equal(
        savedEvidence.source_type,
        'independent_ocr_evidence'
      );

      assert.equal(
        savedEvidence.validation_status,
        'source_charge_verified'
      );

      assert.equal(
        savedEvidence.invoice_item_id,
        line.id
      );

      assert.equal(
        savedEvidence.evidence.pricing.quantity,
        9.96
      );

      assert.equal(
        savedEvidence.evidence.pricing.unit,
        'lb'
      );

      assert.equal(
        savedEvidence.evidence.pricing.unit_cost,
        14.5
      );

      // Confirmation must not independently modify
      // ingredient pricing outside the transaction.

      assert.equal(
        writes.filter(write =>
          write.table === 'ingredients' &&
          write.operation === 'update'
        ).length,
        0
      );

      // The successful confirmation above establishes
      // that the original signed values are accepted.
      //
      // Now verify that modifications made after
      // proof delivery cannot reach the transactional
      // database writer.

      const originalTransactionCount = rpcCalls.filter(
        call =>
          call.functionName ===
          'save_invoice_confirmation_transactional'
      ).length;

      const tamperingCases = [
        {
          name: 'modified purchasing unit',
          changes: {
            quantity_unit: 'CS',
          },
        },
        {
          name: 'modified actual weight',
          changes: {
            actual_weight: 10.96,
          },
        },
        {
          name: 'modified invoice price',
          changes: {
            invoice_price: 15.5,
          },
        },
        {
          name: 'modified invoice total',
          changes: {
            line_total: 154.42,
          },
        },
      ];

      for (const scenario of tamperingCases) {
        const modifiedItem = {
          ...returnedSteak,
          ...scenario.changes,
        };

        const modifiedRequest = createRequest({
          number: 'TEST-V2-1001',
          item: modifiedItem,
        });

        modifiedRequest.body.file_urls = [
          `${RESTAURANT_ID}/test-invoice.pdf`,
        ];

        const rejectedResponse = createResponse();

        await handler(
          modifiedRequest,
          rejectedResponse
        );

        assert.equal(
          rejectedResponse.statusCode,
          422,
          scenario.name
        );

        assert.equal(
          rpcCalls.filter(
            call =>
              call.functionName ===
              'save_invoice_confirmation_transactional'
          ).length,
          originalTransactionCount,
          `${scenario.name}: database writer must not run`
        );
      }
    });
  }
);


test(
  'transactional persistence remains disabled for restaurants outside the allowlist',
  async () => {
    await withEvidencePersistence(async () => {
      const { db, writes, rpcCalls } = createDb();

      // The global flag is enabled, but this restaurant
      // is not the explicitly permitted restaurant.
      process.env.INVOICE_SOURCE_EVIDENCE_PERSISTENCE_RESTAURANT_ID =
        'another-restaurant-id';

      const handler = createHandler(
        db,
        unverifiedCost
      );

      const req = createRequest({
        number: 'TEST-ALLOWLIST-001',
        item: {
          _id: 'item_0',
          item_name_raw: 'GROUND BEEF',
          pack_size_raw: '2/5 LB',
          pack: 2,
          size: 5,
          size_unit: 'lb',
          quantity_shipped: 1,
          invoice_price: 40,
          line_total: 40,
        },
      });

      const res = createResponse();

      await handler(req, res);

      assert.equal(res.statusCode, 200);
      assert.equal(res.body.success, true);

      // No transactional database function is called.
      assert.equal(
        rpcCalls.filter(call =>
          call.functionName ===
          'save_invoice_confirmation_transactional'
        ).length,
        0
      );

      // Existing legacy invoice confirmation remains
      // available for non-allowlisted restaurants.
      assert.ok(
        writes.some(write =>
          write.table === 'invoice_items' &&
          write.operation === 'insert'
        )
      );
    });
  }
);


test(
  'transactional confirmation schedules calculations once and not on replay',
  async () => {
    await withEvidencePersistence(async () => {
      const { db } = createDb({
        ownedIngredients: {
          'ingredient-beef-1': 'Ground Beef',
        },
      });

      installIdempotentTransactionMock(db);

      const scheduled = [];
      const processed = [];

      const handler = createHandler(
        db,
        unverifiedCost,
        {
          processCalculations: async (
            _db,
            restaurantId
          ) => {
            processed.push(restaurantId);
            return { skipped: false, errors: [] };
          },
          scheduleCalculations: promise => {
            scheduled.push(promise);
          },
        }
      );

      const req = ordinaryTransactionalRequest(
        'AUTO-CALC-001',
        'auto-calculation-confirmation-000001'
      );

      req.body.line_items[0].selected_ingredient_id =
        'ingredient-beef-1';

      req.body.line_items[0].selected_ingredient_name =
        'Ground Beef';

      req.body.line_items[0].match_status = 'matched';

      const first = createResponse();
      await handler(req, first);

      assert.equal(first.statusCode, 200);
      assert.equal(first.body.success, true);
      assert.equal(scheduled.length, 1);

      await Promise.all(scheduled);

      assert.deepEqual(processed, [RESTAURANT_ID]);

      const replay = createResponse();
      await handler(req, replay);

      assert.equal(replay.statusCode, 200);
      assert.equal(replay.body.replayed, true);

      assert.equal(scheduled.length, 1);
      assert.equal(processed.length, 1);
    });
  }
);



test(
  'direct-weight V2 proof persists authenticated pricing without fabricated case quantities',
  async () => {
    await withEvidencePersistence(async () => {
      const { db, rpcCalls, writes } = createDb();

      const header =
        '<tr><th>DESCRIPTION</th>' +
        '<th>QUANTITY</th>' +
        '<th>PRICE PER LB</th>' +
        '<th>EXTENDED</th></tr>';

      const row =
        '<tr><td>Chicken Breast Fresh</td>' +
        '<td>18.40 LB</td>' +
        '<td>$4.50 / LB</td>' +
        '<td>$82.80</td></tr>';

      const original = {
        item_name_raw: 'Chicken Breast Fresh',
        item_name_normalized: 'Chicken Breast Fresh',
        is_food: true,
        quantity_shipped: 18.4,
        quantity_unit: 'LB',
        pack_size_raw: null,
        pack: null,
        size: null,
        size_unit: 'lb',
        invoice_price: 4.5,
        line_total: 82.8,
        catch_weight: true,
        actual_weight: 18.4,
        source_evidence: {
          row_text: row,
          description_text: 'Chicken Breast Fresh',
          quantity_text: '18.40 LB',
          purchase_unit_text: 'LB',
          package_text: null,
          weight_text: '18.40 LB',
          weight_unit_text: 'LB',
          unit_price_text: '$4.50 / LB',
          extension_text: '$82.80',
        },
      };

      const returned = {
        ...original,
        _id: 'item_0',
        match_status: 'new',
      };

      const delivery = deliverInvoiceV2Proofs({
        allRaw: [original],
        foodItems: [original],
        lineItemsWithMatches: [returned],
        ocrText: `<table>${header}${row}</table>`,
        restaurantId: RESTAURANT_ID,
        invoiceNumber: 'DIRECT-WEIGHT-CONFIRM-001',
        documentFingerprint: SOURCE_TEST_FINGERPRINT,
        secret: SOURCE_TEST_SECRET,
      });

      assert.equal(delivery.signed, 1);

      const handler = createHandler(db, unverifiedCost);

      const req = createRequest({
        number: 'DIRECT-WEIGHT-CONFIRM-001',
        item: returned,
      });

      req.body.file_urls = [
        `${RESTAURANT_ID}/test-invoice.pdf`,
      ];

      const res = createResponse();

      await handler(req, res);

      assert.equal(res.statusCode, 200);
      assert.equal(res.body.success, true);

      const transaction = rpcCalls.find(
        call =>
          call.functionName ===
          'save_invoice_confirmation_transactional'
      );

      assert.ok(transaction);
      assert.equal(transaction.args.p_lines.length, 1);
      assert.equal(transaction.args.p_evidence.length, 1);

      const line = transaction.args.p_lines[0];
      const savedEvidence =
        transaction.args.p_evidence[0];

      assert.equal(line.quantity, 18.4);
      assert.equal(line.unit, 'lb');
      assert.equal(line.unit_cost, 4.5);
      assert.equal(line.amount, 82.8);

      assert.equal(line.purchase_quantity, 18.4);
      assert.equal(line.purchase_unit, 'lb');
      assert.equal(line.purchase_unit_price, null);

      assert.equal(line.package_quantity, null);
      assert.equal(line.package_unit, null);

      assert.equal(savedEvidence.evidence_version, 2);
      assert.equal(
        savedEvidence.validation_status,
        'source_charge_verified'
      );
      assert.equal(
        savedEvidence.invoice_item_id,
        line.id
      );

      assert.equal(
        savedEvidence.evidence.pricing.quantity,
        18.4
      );
      assert.equal(
        savedEvidence.evidence.pricing.unit,
        'lb'
      );
      assert.equal(
        savedEvidence.evidence.pricing.unit_cost,
        4.5
      );
      assert.equal(
        savedEvidence.evidence.pricing.amount,
        82.8
      );

      // Invoice confirmation must not directly
      // overwrite ingredient prices outside the
      // protected downstream pricing calculation.
      assert.equal(
        writes.filter(write =>
          write.table === 'ingredients' &&
          write.operation === 'update'
        ).length,
        0
      );
    });
  }
);


test(
  'single PACK column case pricing receives V1 evidence and persists correctly',
  async () => {
    await withEvidencePersistence(async () => {
      const { db, rpcCalls, writes } = createDb();

      const header =
        '<tr><th>DESCRIPTION</th><th>SHP</th>' +
        '<th>UOM</th><th>PACK</th><th>WEIGHT</th>' +
        '<th>UNIT COST</th><th>EXTENDED</th></tr>';

      const row =
        '<tr><td>Ground Beef 80/20</td>' +
        '<td>1</td><td>CS</td>' +
        '<td>2 x 5 LB</td><td>-</td>' +
        '<td>$40.00 / CS</td><td>$40.00</td></tr>';

      const original = {
        _id: 'item_0',
        item_name_raw: 'Ground Beef 80/20',
        item_name_normalized: 'Ground Beef 80/20',
        quantity_shipped: 1,
        quantity_unit: 'CS',
        pack_size_raw: '2 x 5 LB',
        pack: 2,
        size: 5,
        size_unit: 'lb',
        invoice_price: 40,
        line_total: 40,
        catch_weight: false,
      };

      const [validated] = validateInvoiceAgainstSource(
        [original],
        `<table><thead>${header}</thead>${row}</table>`
      );

      assert.equal(
        validated.source_validation_status,
        'source_table_consistent'
      );

      const invoiceNumber = 'V1-SINGLE-PACK-001';

      const signed = {
        ...validated,
        invoice_source_proof: createInvoiceSourceProof({
          restaurantId: RESTAURANT_ID,
          invoiceNumber,
          documentFingerprint: SOURCE_TEST_FINGERPRINT,
          itemKey: validated._id,
          item: validated,
          secret: SOURCE_TEST_SECRET,
        }),
      };

      const handler = createHandler(db, unverifiedCost);

      const req = createRequest({
        number: invoiceNumber,
        item: signed,
      });

      req.body.file_urls = [
        `${RESTAURANT_ID}/test-invoice.pdf`,
      ];

      const res = createResponse();

      await handler(req, res);

      assert.equal(res.statusCode, 200);
      assert.equal(res.body.success, true);

      const transaction = rpcCalls.find(
        call =>
          call.functionName ===
          'save_invoice_confirmation_transactional'
      );

      assert.ok(transaction);
      assert.equal(transaction.args.p_lines.length, 1);
      assert.equal(transaction.args.p_evidence.length, 1);

      const line = transaction.args.p_lines[0];
      const evidence = transaction.args.p_evidence[0];

      assert.equal(line.quantity, 10);
      assert.equal(line.unit, 'lb');
      assert.equal(line.unit_cost, 4);
      assert.equal(line.amount, 40);

      assert.equal(line.purchase_quantity, 1);
      assert.equal(line.purchase_unit, 'case');
      assert.equal(line.purchase_unit_price, 40);

      assert.equal(line.package_quantity, 10);
      assert.equal(line.package_unit, 'lb');

      assert.equal(evidence.evidence_version, 1);
      assert.equal(
        evidence.source_type,
        'structured_ocr_table'
      );
      assert.equal(
        evidence.validation_status,
        'source_table_consistent'
      );
      assert.equal(evidence.invoice_item_id, line.id);

      assert.equal(evidence.evidence.pricing.quantity, 10);
      assert.equal(evidence.evidence.pricing.unit, 'lb');
      assert.equal(evidence.evidence.pricing.unit_cost, 4);
      assert.equal(evidence.evidence.pricing.amount, 40);

      assert.equal(
        writes.filter(write =>
          write.table === 'ingredients' &&
          write.operation === 'update'
        ).length,
        0
      );
    });
  }
);


test(
  'transactional confirmation preserves explicit and fallback delivery dates',
  async () => {
    await withEvidencePersistence(async () => {
      const scenarios = [
        {
          name: 'explicit delivery date',
          deliveryDate: '2026-10-28',
          expected: '2026-10-28',
        },
        {
          name: 'invoice-date fallback',
          deliveryDate: null,
          expected: '2026-10-27',
        },
      ];

      for (const scenario of scenarios) {
        const { db, rpcCalls } = createDb();
        const handler = createHandler(db, unverifiedCost);

        const req = createRequest({
          number: 'TEST-DELIVERY-DATE-001',
          item: {
            _id: 'delivery-date-test-line',
            item_name_raw: 'GROUND BEEF',
            item_name_normalized: 'Ground Beef',
            pack_size_raw: '2/5 LB',
            pack: 2,
            size: 5,
            size_unit: 'lb',
            quantity_shipped: 1,
            invoice_price: 40,
            line_total: 40,
          },
        });

        if (scenario.deliveryDate !== null) {
          req.body.invoice.delivery_date =
            scenario.deliveryDate;
        }

        const res = createResponse();

        await handler(req, res);

        assert.equal(
          res.statusCode,
          200,
          scenario.name
        );

        const transaction = rpcCalls.find(
          call =>
            call.functionName ===
            'save_invoice_confirmation_transactional'
        );

        assert.ok(transaction, scenario.name);

        assert.equal(
          transaction.args.p_invoice.date,
          '2026-10-27',
          scenario.name
        );

        assert.equal(
          transaction.args.p_invoice.delivery_date,
          scenario.expected,
          scenario.name
        );
      }
    });
  }
);


test(
  'invalid invoice and delivery dates are rejected before persistence',
  async () => {
    const scenarios = [
      {
        name: 'impossible delivery date',
        invoiceDate: '2026-10-27',
        deliveryDate: '2026-02-30',
      },
      {
        name: 'incorrect delivery date format',
        invoiceDate: '2026-10-27',
        deliveryDate: '10/28/2026',
      },
      {
        name: 'invalid invoice date',
        invoiceDate: '2026-13-01',
        deliveryDate: null,
      },
      {
        name: 'non-string delivery date',
        invoiceDate: '2026-10-27',
        deliveryDate: 20261028,
      },
    ];

    for (const scenario of scenarios) {
      const { db, rpcCalls, writes } = createDb();

      const handler = createHandler(
        db,
        unverifiedCost
      );

      const req = createRequest({
        number: 'TEST-INVALID-DATE-001',
        item: {
          _id: 'invalid-date-test-line',
          item_name_raw: 'GROUND BEEF',
          item_name_normalized: 'Ground Beef',
          pack_size_raw: '2/5 LB',
          pack: 2,
          size: 5,
          size_unit: 'lb',
          quantity_shipped: 1,
          invoice_price: 40,
          line_total: 40,
        },
      });

      req.body.invoice.invoice_date =
        scenario.invoiceDate;

      if (scenario.deliveryDate !== null) {
        req.body.invoice.delivery_date =
          scenario.deliveryDate;
      }

      const res = createResponse();

      await handler(req, res);

      assert.equal(
        res.statusCode,
        422,
        scenario.name
      );

      assert.equal(
        rpcCalls.some(call =>
          call.functionName ===
          'save_invoice_confirmation_transactional'
        ),
        false,
        scenario.name
      );

      assert.equal(
        writes.some(write =>
          write.table === 'invoices' &&
          write.operation === 'insert'
        ),
        false,
        scenario.name
      );
    }
  }
);
