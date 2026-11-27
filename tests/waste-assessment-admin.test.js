import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { createWasteAssessmentSwitchHandler } from '../pages/api/admin/projections/waste-assessment-switch.js';

const rid = '91000000-0000-4000-8000-000000000011';
const actor = '91000000-0000-4000-8000-000000000012';

const ready = {
  restaurant_id: rid, restaurant_name: 'Maple', enabled: false,
  projections_enabled: true, has_compact_assessment: true,
  latest_completed: { assessment_date: '2026-11-27', compact: true },
  updated_by: actor, updated_by_email: 'admin@example.com', updated_at: '2026-11-27T18:00:00Z',
};

function compact(date) {
  return {
    mode: 'assessment', restaurant_id: rid, assessment_id: 'assessment',
    assessment_date: date, business_date: '2026-11-28',
    inventory_cutoff: '2026-11-25', inventory_boundary: '2026-11-26T09:00:00Z',
    timezone: 'America/New_York', pending_disposals: [],
    result: { result_schema_version: 2, restaurant_id: rid, assessment_date: date,
      inventory_cutoff: '2026-11-25', items: [{ batch_id: 'private-item' }],
      needs_review: [], omitted_by_status: {} },
  };
}

function setup(status, view, readError = null) {
  const calls = [];
  const handler = createWasteAssessmentSwitchHandler({
    verifyAdmin: async () => ({ user: { id: actor } }),
    db: {
      async rpc(name, args) {
        calls.push([name, args]);
        switch (name) {
          case 'waste_projection_admin_surface_status': return { data: status };
          case 'waste_projection_read_surface': return { data: view, error: readError };
          case 'waste_projection_surface_switch': return { data: { restaurant_id: rid, enabled: args.desired } };
          default: assert.fail(name);
        }
      },
    },
  });
  async function request(method, body) {
    const res = {
      headers: {},
      setHeader(key, value) { this.headers[key] = value; },
      status(code) { this.code = code; return this; },
      json(value) { this.body = value; return this; },
    };
    await handler({ method, query: { restaurantId: rid }, body }, res);
    return res;
  }
  return { calls, request };
}

test('GET keeps readiness and audit visible while the reader reports switch_off', async () => {
  const old = { mode: 'legacy', reason: 'switch_off' };
  const api = setup(ready, old);
  const res = await api.request('GET');
  assert.equal(res.code, 200);
  assert.equal(res.headers['Cache-Control'], 'private, no-store');
  assert.deepEqual(res.body, { ...ready, owner_card: old, tonight_dish: old });
  assert.deepEqual(api.calls[0], ['waste_projection_admin_surface_status', { target: rid, actor }]);
  assert.equal(api.calls[1][0], 'waste_projection_read_surface');
  assert.equal(api.calls.length, 2);
});

test('GET uses the shared Dish selector and returns only reader summaries', async () => {
  for (const date of ['2026-11-26', '2026-11-27', '2026-11-28']) {
    const { request } = setup({ ...ready, enabled: true }, compact(date));
    const { body } = await request('GET');
    assert.deepEqual(body.owner_card, { mode: 'assessment', assessment_date: date, stale: date < '2026-11-28' });
    assert.deepEqual(body.tonight_dish, date === '2026-11-26'
      ? { mode: 'legacy', reason: 'assessment_too_old' } : body.owner_card);
    assert.ok(!JSON.stringify(body).includes('private-item'));
  }
  for (const reason of ['projections_disabled', 'no_compact_assessment']) {
    const old = { mode: 'legacy', reason };
    const { request } = setup({ ...ready, enabled: true }, old);
    const { body } = await request('GET');
    assert.deepEqual(body.owner_card, old);
    assert.deepEqual(body.tonight_dish, old);
  }
});

test('PUT checks readiness on enable and writes through the existing switch RPC', async () => {
  for (const [changes, message] of [
    [{ projections_enabled: false }, 'Projections are disabled.'],
    [{ has_compact_assessment: false }, 'No completed compact assessment is available.'],
  ]) {
    const api = setup({ ...ready, ...changes });
    const res = await api.request('PUT', { enabled: true });
    assert.equal(res.code, 409);
    assert.equal(res.body.error, message);
    assert.deepEqual(api.calls.map(([name]) => name), ['waste_projection_admin_surface_status']);
  }
  const api = setup(ready);
  const res = await api.request('PUT', { enabled: true });
  assert.deepEqual(res.body, { restaurant_id: rid, enabled: true });
  assert.deepEqual(api.calls[1], ['waste_projection_surface_switch', { target: rid, actor, desired: true }]);
});

test('reader errors preserve the audit and turning Off requires only the existing write RPC', async () => {
  const api = setup({ ...ready, enabled: true }, null, { code: '57014', message: 'fixture timeout' });
  const read = await api.request('GET');
  assert.deepEqual(read.body, { ...ready, enabled: true, owner_card: null, tonight_dish: null });
  const off = setup(null);
  const res = await off.request('PUT', { enabled: false });
  assert.deepEqual(res.body, { restaurant_id: rid, enabled: false });
  assert.deepEqual(off.calls, [['waste_projection_surface_switch', { target: rid, actor, desired: false }]]);
});

function details(status, { confirmation = true } = {}) {
  const file = new URL('../components/admin/WasteAssessmentSwitch.js', import.meta.url);
  const { outputText } = ts.transpileModule(readFileSync(file, 'utf8'), {
    fileName: 'WasteAssessmentSwitch.jsx',
    compilerOptions: {
      target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS, esModuleInterop: true,
    },
  });
  const exports = {};
  const require = createRequire(file);
  const prompts = [];
  const changes = [];
  runInNewContext(outputText, {
    exports,
    require: name => name === './ui' ? {} : require(name),
    window: { confirm: message => { prompts.push(message); return confirmation; } },
  });
  const element = exports.WasteAssessmentSwitchDetails({
    status, saving: false, onChange: next => changes.push(next),
  });
  const button = React.Children.toArray(element.props.children).find(child => child.type === 'button');
  return { html: renderToStaticMarkup(element), button, prompts, changes };
}

test('an Off page shows the current reader sources and asks for the named restaurant before enabling', () => {
  const old = { mode: 'legacy', reason: 'switch_off' };
  const status = { ...ready, owner_card: old, tonight_dish: old };
  for (const confirmation of [false, true]) {
    const { html, button, prompts, changes } = details(status, { confirmation });
    assert.match(html, /Switch Off/);
    assert.match(html, /Old card \(switch_off\)/);
    assert.match(html, /Old path \(switch_off\)/);
    assert.match(html, /Compact \(schema version 2\)/);
    assert.equal(button.props.disabled, false);
    button.props.onClick();
    assert.deepEqual(prompts, ["Switch Maple to the new waste card and Tonight's Dish source?"]);
    assert.deepEqual(changes, confirmation ? [true] : []);
  }
});

test('the On control explains disabled projections or missing compact history', () => {
  for (const [changes, reason] of [
    [{ projections_enabled: false }, /Projections are disabled/],
    [{ has_compact_assessment: false, latest_completed: { assessment_date: '2026-11-26', compact: false } },
      /No completed compact assessment is available/],
  ]) {
    const view = details({ ...ready, ...changes });
    assert.equal(view.button.props.disabled, true);
    assert.equal(view.button.props['aria-describedby'], 'waste-switch-blocked');
    assert.match(view.html, reason);
    view.button.props.onClick();
    assert.deepEqual(view.prompts, []);
    assert.deepEqual(view.changes, []);
  }
});

test('an On page shows stale reader status and the audit, and turns Off without confirmation', () => {
  const { html, button, prompts, changes } = details({
    ...ready, enabled: true,
    owner_card: { mode: 'assessment', assessment_date: '2026-11-26', stale: true },
    tonight_dish: { mode: 'legacy', reason: 'assessment_too_old' },
  });
  assert.match(html, /Switch On/);
  assert.match(html, /New card · 2026-11-26 · stale/);
  assert.match(html, /Old path \(assessment_too_old\)/);
  assert.match(html, /admin@example\.com/);
  assert.ok(html.includes(actor));
  assert.match(html, /datetime="2026-11-27T18:00:00Z"/i);
  assert.equal(button.props.disabled, false);
  button.props.onClick();
  assert.deepEqual(prompts, []);
  assert.deepEqual(changes, [false]);

  const blocked = details({ ...ready, enabled: true, projections_enabled: false });
  assert.equal(blocked.button.props.disabled, false);
  blocked.button.props.onClick();
  assert.deepEqual(blocked.prompts, []);
  assert.deepEqual(blocked.changes, [false]);
});