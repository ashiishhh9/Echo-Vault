import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getCountdown } from '../src/utils/countdown.mjs';

test('countdown converts UTC timestamps into day/hour/minute/second parts', () => {
  assert.deepEqual(getCountdown('2026-01-02T03:04:05Z', Date.parse('2026-01-01T00:00:00Z')), {
    valid: true, expired: false, days: 1, hours: 3, minutes: 4, seconds: 5,
  });
});

test('countdown respects timezone offsets and the equivalent UTC instant', () => {
  const utc = Date.parse('2026-01-01T00:00:00Z');
  assert.deepEqual(getCountdown('2026-01-01T05:30:00+05:30', utc), {
    valid: true, expired: true, days: 0, hours: 0, minutes: 0, seconds: 0,
  });
});

test('countdown reports expired and invalid timestamps without throwing', () => {
  assert.equal(getCountdown('2025-01-01T00:00:00Z', Date.parse('2026-01-01T00:00:00Z')).expired, true);
  assert.deepEqual(getCountdown('not a date'), { valid: false, expired: false, days: 0, hours: 0, minutes: 0, seconds: 0 });
});
