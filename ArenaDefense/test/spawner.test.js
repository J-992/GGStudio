import { test } from 'node:test';
import assert from 'node:assert/strict';

import { SpawnScheduler } from '../src/core/spawner.js';

function entries(n, everyS = 1) {
  return Array.from({ length: n }, (_, i) => ({ enemy: 'shambler', t: i * everyS, gateId: i % 2 }));
}

test('never emits while aliveCount is at or above the cap', () => {
  const sched = new SpawnScheduler(entries(5, 0), 3); // all due at t=0
  const due = sched.update(0.016, 3); // already at cap
  assert.deepEqual(due, []);
  assert.equal(sched.done, false);
});

test('emits everything eventually once the cap frees up', () => {
  const sched = new SpawnScheduler(entries(5, 0), 2);
  let alive = 2;
  const seen = [];
  // Held at cap for a few frames.
  for (let i = 0; i < 3; i++) {
    const due = sched.update(0.1, alive);
    assert.deepEqual(due, []);
  }
  // Cap frees up (a kill each frame), so throughput resumes.
  alive = 0;
  let guard = 0;
  while (!sched.done) {
    if (++guard > 1000) throw new Error('scheduler never finished — possible stall');
    const due = sched.update(0.1, alive);
    seen.push(...due);
    alive += due.length;
    if (alive > 0) alive -= 1; // simulate one enemy dying per frame
  }
  assert.equal(seen.length, 5);
  assert.equal(sched.done, true);
});

test('respects individual spawn timing, only emitting entries whose time has arrived', () => {
  const sched = new SpawnScheduler(entries(3, 1), 99); // t = 0, 1, 2
  let due = sched.update(0.5, 0); // t=0.5
  assert.equal(due.length, 1);
  due = sched.update(0.4, 0); // t=0.9
  assert.equal(due.length, 0);
  due = sched.update(0.2, 0); // t=1.1
  assert.equal(due.length, 1);
  assert.equal(sched.done, false);
  due = sched.update(1.0, 0); // t=2.1
  assert.equal(due.length, 1);
  assert.equal(sched.done, true);
});

test('an empty entry list is immediately done', () => {
  const sched = new SpawnScheduler([], 10);
  assert.equal(sched.done, true);
  assert.deepEqual(sched.update(1, 0), []);
});

test('within one update, cap gates how many of several simultaneously-due entries emit', () => {
  const sched = new SpawnScheduler(entries(4, 0), 2); // all due at t=0
  const due = sched.update(0.016, 0);
  assert.equal(due.length, 2, 'only 2 of the 4 due entries should emit given cap=2 and 0 currently alive');
});
