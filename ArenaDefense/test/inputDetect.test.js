import { test } from 'node:test';
import assert from 'node:assert/strict';

import { decideInputMode } from '../src/core/inputDetect.js';

test('input-mode matrix: touch requires both touch points and a coarse pointer', () => {
  const cases = [
    { touchPoints: 0, coarse: false, expected: 'keyboard' },
    { touchPoints: 0, coarse: true, expected: 'keyboard' },
    { touchPoints: 5, coarse: false, expected: 'keyboard' },
    { touchPoints: 5, coarse: true, expected: 'touch' },
  ];
  for (const c of cases) {
    assert.equal(
      decideInputMode({ touchPoints: c.touchPoints, coarse: c.coarse }),
      c.expected,
      `touchPoints=${c.touchPoints} coarse=${c.coarse}`,
    );
  }
});

test('override wins regardless of touch/coarse signals', () => {
  assert.equal(decideInputMode({ touchPoints: 0, coarse: false, override: 'touch' }), 'touch');
  assert.equal(decideInputMode({ touchPoints: 5, coarse: true, override: 'keyboard' }), 'keyboard');
});

test('a null override falls through to signal-based detection', () => {
  assert.equal(decideInputMode({ touchPoints: 5, coarse: true, override: null }), 'touch');
});
