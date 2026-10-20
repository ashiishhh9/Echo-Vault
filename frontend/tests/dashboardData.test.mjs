import assert from 'node:assert/strict';
import { test } from 'node:test';
import { countUnlockingSoon, groupMoodByDay, loadMoodSeries, UPCOMING_UNLOCK_WINDOW_DAYS } from '../src/utils/dashboardData.mjs';

const now = Date.parse('2026-10-20T12:00:00.000Z');
const capsule = (id, offsetDays, sealed = true) => ({ id, sealed, unlockAt: new Date(now + offsetDays * 86_400_000).toISOString() });

test('no capsules gives a zero upcoming count', () => {
  assert.equal(countUnlockingSoon([], now), 0);
});

test('one locked capsule in the next 30 days counts once', () => {
  assert.equal(countUnlockingSoon([capsule('soon', 2)], now), 1);
});

test('multiple unlock dates inside the window count independently', () => {
  assert.equal(countUnlockingSoon([capsule('today', 0), capsule('week', 7), capsule('boundary', 30)], now), 3);
  assert.equal(UPCOMING_UNLOCK_WINDOW_DAYS, 30);
});

test('already unlocked capsules are excluded', () => {
  assert.equal(countUnlockingSoon([capsule('open', 1, false)], now), 0);
});

test('past, outside-window, and invalid unlock dates are excluded', () => {
  assert.equal(countUnlockingSoon([
    capsule('past', -1), capsule('later', 31), { sealed: true, unlockAt: 'not-a-date' },
  ], now), 0);
});

test('creating and deleting a capsule immediately changes the derived count', () => {
  const capsules = [];
  assert.equal(countUnlockingSoon(capsules, now), 0);
  capsules.push(capsule('created', 5));
  assert.equal(countUnlockingSoon(capsules, now), 1);
  capsules.splice(0, 1);
  assert.equal(countUnlockingSoon(capsules, now), 0);
});

test('changing an unlock date recalculates the count', () => {
  const item = capsule('rescheduled', 2);
  assert.equal(countUnlockingSoon([item], now), 1);
  item.unlockAt = new Date(now + 45 * 86_400_000).toISOString();
  assert.equal(countUnlockingSoon([item], now), 0);
});

test('mood observations on one day are averaged and sentiment labels are retained', () => {
  const [day] = groupMoodByDay([
    { date: '2026-10-20', value: 40, label: 'negative' },
    { date: '2026-10-20', value: 80, label: 'positive' },
    { date: '2026-10-20', value: 50, label: 'neutral' },
  ]);
  assert.deepEqual(day, { date: '2026-10-20', value: 56.7, observations: 3, labels: ['negative', 'neutral', 'positive'] });
});

test('daily mood points from several months remain chronological', () => {
  const points = groupMoodByDay([
    { date: '2026-12-01', value: 70 }, { date: '2026-09-30', value: 40 }, { date: '2026-10-01', value: 55 },
  ]);
  assert.deepEqual(points.map(({ date }) => date), ['2026-09-30', '2026-10-01', '2026-12-01']);
});

test('empty mood data stays empty without invented dates or scores', async () => {
  assert.deepEqual(groupMoodByDay([]), []);
  assert.deepEqual(await loadMoodSeries(async () => ({ series: [] })), { status: 'empty', series: [] });
});

test('a mood API failure returns no stale chart points', async () => {
  const result = await loadMoodSeries(async () => { throw new Error('AI unavailable'); });
  assert.equal(result.status, 'error');
  assert.deepEqual(result.series, []);
});

test('separate users receive counts derived only from their own capsule arrays', () => {
  const users = {
    alice: [capsule('a', 1)],
    bob: [capsule('b', 40), capsule('c', -1)],
  };
  assert.equal(countUnlockingSoon(users.alice, now), 1);
  assert.equal(countUnlockingSoon(users.bob, now), 0);
});
