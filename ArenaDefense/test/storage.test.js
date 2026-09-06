import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CONFIG } from '../src/config.js';
import { sanitize, loadSave, saveSave } from '../src/core/storage.js';

/** A minimal in-memory `io` for tests — no `localStorage`. */
function makeIO(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    get: (key) => (store.has(key) ? store.get(key) : null),
    set: (key, value) => store.set(key, value),
    _store: store,
  };
}

test('sanitize rejects NaN, negative and string coin/bestWave values', () => {
  assert.equal(sanitize({ coins: NaN }).coins, 0);
  assert.equal(sanitize({ coins: -50 }).coins, 0);
  assert.equal(sanitize({ coins: 'lots' }).coins, 0);
  assert.equal(sanitize({ bestWave: NaN }).bestWave, 0);
  assert.equal(sanitize({ bestWave: -1 }).bestWave, 0);
  assert.equal(sanitize({ bestWave: 'ten' }).bestWave, 0);
});

test('sanitize clamps coins to CONFIG.save.maxCoins', () => {
  const result = sanitize({ coins: CONFIG.save.maxCoins * 10 });
  assert.equal(result.coins, CONFIG.save.maxCoins);
});

test('sanitize clamps bestWave to CONFIG.run.finalWave', () => {
  const result = sanitize({ bestWave: 999 });
  assert.equal(result.bestWave, CONFIG.run.finalWave);
});

test('sanitize floors fractional numbers and defaults missing/malformed input', () => {
  assert.equal(sanitize({ coins: 4.9 }).coins, 4);
  assert.deepEqual(sanitize(null), { coins: 0, bestWave: 0, unlocks: [] });
  assert.deepEqual(sanitize(undefined), { coins: 0, bestWave: 0, unlocks: [] });
  assert.deepEqual(sanitize('not an object'), { coins: 0, bestWave: 0, unlocks: [] });
});

test('sanitize keeps unlocks as an array of strings, dropping anything else', () => {
  assert.deepEqual(sanitize({ unlocks: ['a', 1, null, 'b'] }).unlocks, ['a', 'b']);
  assert.deepEqual(sanitize({ unlocks: 'not-an-array' }).unlocks, []);
  assert.deepEqual(sanitize({}).unlocks, []);
});

test('loadSave returns sanitized defaults when nothing is stored', () => {
  const io = makeIO();
  assert.deepEqual(loadSave(io), { coins: 0, bestWave: 0, unlocks: [] });
});

test('loadSave survives corrupt JSON', () => {
  const io = makeIO({ [CONFIG.save.key]: '{not json' });
  assert.deepEqual(loadSave(io), { coins: 0, bestWave: 0, unlocks: [] });
});

test('saveSave merges onto the existing save, persists, and returns the sanitized result', () => {
  const io = makeIO();
  saveSave(io, { coins: 5 });
  const after = saveSave(io, { bestWave: 3 });
  assert.deepEqual(after, { coins: 5, bestWave: 3, unlocks: [] });
  assert.deepEqual(loadSave(io), { coins: 5, bestWave: 3, unlocks: [] });
});

test('the save key set by saveSave is exactly {coins, bestWave, unlocks}', () => {
  const io = makeIO();
  saveSave(io, { coins: 1, bestWave: 1, unlocks: ['x'] });
  const raw = JSON.parse(io.get(CONFIG.save.key));
  assert.deepEqual(new Set(Object.keys(raw)), new Set(['coins', 'bestWave', 'unlocks']));
});
