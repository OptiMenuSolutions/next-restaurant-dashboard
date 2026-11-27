import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ProjectedWasteCard from '../components/dashboard/ProjectedWasteCard.jsx';
import {
  addPendingWasteDisposal,
  buildWasteAssessmentCard,
  selectWasteCardConfirmations,
} from '../lib/wasteAssessmentCard.js';

const row = (batch_id, use_by_date, attributes = {}) => ({
  batch_id, use_by_date, status: 'ok', unit: 'lb', stock_unit: 'lb', stock_remaining_qty: 4,
  risk_qty: 2, risk_value: 12, visible: true, ...attributes,
});

const fixture = () => ({
  mode: 'assessment',
  assessment_date: '2026-11-27',
  business_date: '2026-11-28',
  inventory_cutoff: '2026-11-26',
  stale: true,
  forecast_fallback: true,
  items: [
    row('today', '2026-11-28', { may_be_overstated: true }),
    row('seven', '2026-11-21', { status: 'overdue' }),
    row('eight', '2026-11-20', { status: 'overdue', risk_value: 6 }),
    row('used', '2026-11-27'),
    row('no-risk', '2026-11-30', { risk_qty: 0, risk_value: 0, visible: false }),
  ],
  needs_review: [
    row('unknown-date', null, { status: 'unavailable', reason: 'link_ingredient', risk_value: null }),
    row('review-seven', '2026-11-21', { status: 'unavailable', reason: 'link_ingredient', risk_value: null }),
    row('review-eight', '2026-11-20', { status: 'unavailable', reason: 'link_ingredient', risk_value: null }),
  ],
  omitted_by_status: {
    overdue: { count: 10, risk_value: 120, unvalued_count: 2 },
    outside_risk_window: { count: 2, risk_value: null },
  },
  pending_disposals: [{ batch_id: 'old-pending', confirmation_id: 'old', ingredient_name: 'Chives',
    last_known_use_by_date: '2026-11-17' }],
});

const confirmations = [
  { id: 'confirm-7', invoiceItemId: 'seven', ingredientName: 'Kale' },
  { id: 'confirm-used', invoiceItemId: 'used', ingredientName: 'Celery' },
  { id: 'confirm-other', invoiceItemId: 'other', ingredientName: 'Parsley' },
];
const inventory = [
  { stockSource: 'invoice', invoiceItemId: 'today', name: 'Tomato' },
  { stockSource: 'invoice', invoiceItemId: 'review-seven', name: 'Salad', remainingQty: 6, unit: 'oz' },
  { stockSource: 'invoice', invoiceItemId: 'no-risk', name: 'Lime', remainingQty: 5, unit: 'lb' },
  { stockSource: 'invoice', invoiceItemId: 'new-stock', name: 'Mint', deliveryDate: '2026-11-28',
    shelfLife: 4, remainingQty: 1, unit: 'lb' },
  { stockSource: 'invoice', invoiceItemId: 'outside', name: 'Basil', deliveryDate: '2026-11-26',
    shelfLife: 9, remainingQty: 1, unit: 'lb' },
];

test('the dashboard keeps the existing card for every legacy reader response', () => {
  assert.equal(buildWasteAssessmentCard(undefined, inventory, confirmations), null);
  for (const reason of ['switch_off', 'projections_disabled', 'no_compact_assessment']) {
    assert.equal(buildWasteAssessmentCard({ mode: 'legacy', reason }, inventory, confirmations), null);
  }
  assert.equal(selectWasteCardConfirmations(null, confirmations, confirmations, 'confirm-7').shown, confirmations);
});

test('the compact card separates upcoming and overdue using the current business date, with an inclusive seven-date cutoff', () => {
  const card = buildWasteAssessmentCard(fixture(), inventory, confirmations);
  assert.deepEqual(card.upcoming.map(item => [item.id, item.daysLeft]), [['today', 0]]);
  assert.deepEqual(card.overdue.map(item => [item.id, item.daysLeft, item.confirmationId]), [
    ['seven', -7, 'confirm-7'], ['used', -1, 'confirm-used'],
  ]);
  assert.deepEqual(card.olderOverdue, { count: 11, riskValue: 126, unvaluedCount: 2, confirmedWasted: 1 });
  assert.deepEqual(card.outsideWindow, { count: 2, risk_value: null });
  assert.deepEqual(card.onHand.map(item => [item.id, item.quantity]), [['no-risk', 5], ['new-stock', 1]]);
});

test('the card shows known stock for unavailable estimates and summarizes older review rows by reason', () => {
  const card = buildWasteAssessmentCard(fixture(), inventory, confirmations);
  assert.deepEqual(card.review.map(item => [item.id, item.quantity, item.unit, item.daysLeft]), [
    ['review-seven', 6, 'oz', -7], ['unknown-date', 4, 'lb', null],
  ]);
  assert.deepEqual(card.olderReview, [{ reason: 'link_ingredient', count: 1 }]);
});

test('a saved disposal appears immediately, stays handled on a later read, and clears with the next assessment', () => {
  const initial = fixture();
  const saved = addPendingWasteDisposal(initial, confirmations[0]);
  const reloaded = { ...initial, pending_disposals: [...saved.pending_disposals] };
  for (const view of [saved, reloaded]) {
    const card = buildWasteAssessmentCard(view, inventory, confirmations.filter(row => row.id !== 'confirm-7'));
    assert.deepEqual(card.handled.map(row => row.name), ['Chives', 'Kale']);
    assert.equal(card.overdue.some(row => row.id === 'seven'), false);
    assert.equal(card.olderOverdue.riskValue, 126);
  }
  const next = buildWasteAssessmentCard({
    ...initial, pending_disposals: [], items: initial.items.filter(item => item.batch_id !== 'seven'),
  }, inventory, []);
  assert.equal(next.handled.length, 0);
  assert.equal(next.overdue.some(row => row.id === 'seven'), false);
});

test('the card action reuses an existing confirmation and avoids a duplicate automatic prompt', () => {
  const card = buildWasteAssessmentCard(fixture(), inventory, confirmations);
  assert.deepEqual(selectWasteCardConfirmations(card, confirmations, confirmations, null).shown, [confirmations[2]]);
  const opened = selectWasteCardConfirmations(card, confirmations, [], 'confirm-7');
  assert.equal(opened.selected, confirmations[0]);
  assert.deepEqual(opened.shown, [confirmations[0]]);
  assert.deepEqual(selectWasteCardConfirmations(card, confirmations, [], 'missing').shown, []);
});

test('the shared card renders the stale cutoff, unknowns, and handled subtotal note', () => {
  const model = buildWasteAssessmentCard(fixture(), inventory, confirmations);
  const html = renderToStaticMarkup(React.createElement(ProjectedWasteCard, { model, refreshingFailed: true }));
  for (const text of ['Stale assessment', 'Inventory through Nov 26, 2026', 'Could not refresh the assessment',
    'Estimated excess at expiry', 'Use by today', 'May be overstated', 'Review disposal for Kale',
    'Includes 1 confirmed wasted, updates after the next assessment', 'Confirmed wasted · pending next assessment',
    'Estimate unavailable', '6 oz on hand', '2 batches outside the risk window']) assert.ok(html.includes(text), text);
  assert.ok(!html.includes('Basil'));
});