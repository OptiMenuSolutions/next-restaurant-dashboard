import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalProjectionHolidayKeys as canonical,
} from '../lib/projections/holidayKeys.js';

test('holiday combinations use stable plain character order', () => {
  assert.deepEqual(
    canonical(['valentines_day', 'super_bowl']),
    ['super_bowl', 'valentines_day']
  );
});

test('holiday keys are copied without changing the input array', () => {
  const input = ['valentines_day', 'super_bowl'];
  const result = canonical(input);

  assert.deepEqual(input, ['valentines_day', 'super_bowl']);
  assert.equal(Object.isFrozen(result), true);
});

test('duplicate holidays fail before a write', () => {
  assert.throws(
    () => canonical(['super_bowl', 'super_bowl']),
    /Duplicate/
  );
});

test('blank, null and noncanonical identifiers fail before a write', () => {
  for (const key of [
    '',
    ' ',
    null,
    'Super_Bowl',
    'super bowl',
    'éaster',
    'a😀',
  ]) {
    assert.throws(() => canonical([key]), /identifiers/);
  }
});

test('an empty holiday set is valid for an ordinary service night', () => {
  assert.deepEqual(canonical([]), []);
});

test('missing holiday context is rejected', () => {
  for (const input of [null, undefined, {}, 'super_bowl']) {
    assert.throws(() => canonical(input), /array/);
  }
});