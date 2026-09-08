import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makeRng, pick } from '../src/core/rng.js';

test('same seed produces the same sequence', () => {
  const a = makeRng(42);
  const b = makeRng(42);
  const seqA = Array.from({ length: 20 }, () => a());
  const seqB = Array.from({ length: 20 }, () => b());
  assert.deepEqual(seqA, seqB);
});

test('different seeds produce different sequences', () => {
  const a = makeRng(1);
  const b = makeRng(2);
  const seqA = Array.from({ length: 10 }, () => a());
  const seqB = Array.from({ length: 10 }, () => b());
  assert.notDeepEqual(seqA, seqB);
});

test('values stay within [0, 1)', () => {
  const rng = makeRng(7);
  for (let i = 0; i < 1000; i++) {
    const v = rng();
    assert.ok(v >= 0 && v < 1, `value ${v} out of range`);
  }
});

test('pick always returns an element of the array', () => {
  const rng = makeRng(9);
  const items = ['a', 'b', 'c'];
  for (let i = 0; i < 200; i++) {
    assert.ok(items.includes(pick(rng, items)));
  }
});

test('pick throws on an empty array', () => {
  const rng = makeRng(1);
  assert.throws(() => pick(rng, []));
});
