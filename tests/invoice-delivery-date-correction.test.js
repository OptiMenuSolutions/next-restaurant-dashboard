import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createUpdateDeliveryDateHandler,
} from '../pages/api/invoices/update-delivery-date.js';

const RID = 'c351e658-0b69-4175-9bec-04a9d8eeb8da';
const IID = '0a6219e8-76ff-4c80-81f2-d71748886cda';
const UID = '9fb236c6-f282-480d-977e-b8ea00958b26';

function fixture(options = {}) {
  const calls = [];

  const req = {
    method: 'POST',
    body: {
      restaurant_id: RID,
      invoice_id: IID,
      delivery_date: '2026-11-11',
      expected_delivery_date: '2026-11-10',
    },
  };

  const res = {
    statusCode: 200,
    headers: {},
    setHeader(key, value) {
      this.headers[key] = value;
    },
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

  const handler = createUpdateDeliveryDateHandler({
    db: {
      async rpc(name, args) {
        calls.push({ name, args });

        return {
          error: options.rpcError || null,
          data: options.result || {
            success: true,
            changed: true,
            calculations_queued: options.matching !== false,
            invoice: {
              id: IID,
              restaurant_id: RID,
              date: '2026-11-09',
              delivery_date: req.body.delivery_date,
            },
          },
        };
      },
    },
    verifyAccess: async () =>
      options.access || { user: { id: UID } },
    getMatchingPolicy: async () => {
      if (options.policyError) {
        throw new Error('Policy unavailable');
      }

      return {
        matching_enabled: options.matching !== false,
      };
    },
    isEnabled: () => options.enabled !== false,
  });

  return { req, res, calls, handler };
}

test(
  'correction sends authenticated actor, expected date and queue request to one RPC',
  async () => {
    const f = fixture();

    await f.handler(f.req, f.res);

    assert.equal(f.res.statusCode, 200);
    assert.deepEqual(f.calls, [{
      name: 'correct_invoice_delivery_date',
      args: {
        p_restaurant_id: RID,
        p_invoice_id: IID,
        p_actor_id: UID,
        p_expected_delivery_date: '2026-11-10',
        p_delivery_date: '2026-11-11',
        p_queue_calculations: true,
      },
    }]);

    assert.equal(f.res.body.invoice.date, '2026-11-09');
  }
);

test(
  'correction rejects malformed and impossible dates before database writes',
  async () => {
    for (const value of [
      '2026-02-30',
      '2026-13-01',
      '11/12/2026',
      '0000-01-01',
      20261112,
      null,
      '',
    ]) {
      const f = fixture();
      f.req.body.delivery_date = value;

      await f.handler(f.req, f.res);

      assert.equal(f.res.statusCode, 422, String(value));
      assert.equal(f.calls.length, 0);
    }

    const f = fixture();
    f.req.body.delivery_date = '2028-02-29';

    await f.handler(f.req, f.res);

    assert.equal(f.res.statusCode, 200);
  }
);

test(
  'correction requires an explicit expected date but accepts null for an unknown old date',
  async () => {
    const absent = fixture();
    delete absent.req.body.expected_delivery_date;

    await absent.handler(absent.req, absent.res);

    assert.equal(absent.res.statusCode, 422);
    assert.equal(absent.calls.length, 0);

    const unknown = fixture();
    unknown.req.body.expected_delivery_date = null;

    await unknown.handler(unknown.req, unknown.res);

    assert.equal(unknown.res.statusCode, 200);
    assert.equal(
      unknown.calls[0].args.p_expected_delivery_date,
      null
    );
  }
);

test(
  'unauthorized and disabled correction requests cannot call the RPC',
  async () => {
    for (const options of [
      {
        access: { error: 'Unauthorized', status: 401 },
        expected: 401,
      },
      {
        access: { error: 'Forbidden', status: 403 },
        expected: 403,
      },
      {
        enabled: false,
        expected: 503,
      },
    ]) {
      const f = fixture(options);

      await f.handler(f.req, f.res);

      assert.equal(f.res.statusCode, options.expected);
      assert.equal(f.calls.length, 0);
    }
  }
);

test('client cannot supply an actor or pricing edits', async () => {
  for (const field of [
    'actor_id',
    'date',
    'unit_cost',
    'price_verification_evidence',
  ]) {
    const f = fixture();
    f.req.body[field] = 'untrusted';

    await f.handler(f.req, f.res);

    assert.equal(f.res.statusCode, 422, field);
    assert.equal(f.calls.length, 0);
  }
});

test('locked restaurants do not queue financial processing', async () => {
  const f = fixture({ matching: false });

  await f.handler(f.req, f.res);

  assert.equal(f.res.statusCode, 200);
  assert.equal(
    f.calls[0].args.p_queue_calculations,
    false
  );
});

test(
  'database stale-date and ownership failures remain explicit errors',
  async () => {
    for (const [code, expected] of [
      ['40001', 409],
      ['42501', 403],
      ['P0002', 404],
      ['22023', 422],
    ]) {
      const f = fixture({
        rpcError: {
          code,
          message: 'Synthetic rejection',
        },
      });

      await f.handler(f.req, f.res);

      assert.equal(f.res.statusCode, expected, code);
      assert.equal(f.res.body.success, undefined);
    }
  }
);

test(
  'no-op retries preserve the database response without claiming recalculation completed',
  async () => {
    const result = {
      success: true,
      changed: false,
      calculations_queued: false,
      invoice: {
        id: IID,
        restaurant_id: RID,
        date: '2026-11-09',
        delivery_date: '2026-11-11',
      },
    };

    const f = fixture({ result });

    await f.handler(f.req, f.res);

    assert.equal(f.res.statusCode, 200);
    assert.deepEqual(f.res.body, result);
    assert.equal(f.calls.length, 1);
  }
);

test(
  'unexpected database results are not reported as successful corrections',
  async () => {
    const f = fixture({
      result: {
        success: true,
        changed: true,
      },
    });

    await f.handler(f.req, f.res);

    assert.equal(f.res.statusCode, 500);
  }
);

test(
  'unsupported methods and malformed JSON never call the database',
  async () => {
    const method = fixture();
    method.req.method = 'GET';

    await method.handler(method.req, method.res);

    assert.equal(method.res.statusCode, 405);
    assert.equal(method.res.headers.Allow, 'POST');
    assert.equal(method.calls.length, 0);

    const malformed = fixture();
    malformed.req.body = '{';

    await malformed.handler(malformed.req, malformed.res);

    assert.equal(malformed.res.statusCode, 400);
    assert.equal(malformed.calls.length, 0);
  }
);