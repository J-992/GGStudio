import { test } from 'node:test';
import assert from 'node:assert/strict';

import { EventBus } from '../src/core/events.js';

test('on/emit calls the handler with the payload', () => {
  const bus = new EventBus();
  const seen = [];
  bus.on('kill', (payload) => seen.push(payload));
  bus.emit('kill', { id: 1 });
  bus.emit('kill', { id: 2 });
  assert.deepEqual(seen, [{ id: 1 }, { id: 2 }]);
});

test('off stops further calls', () => {
  const bus = new EventBus();
  const seen = [];
  const handler = (p) => seen.push(p);
  bus.on('x', handler);
  bus.emit('x', 1);
  bus.off('x', handler);
  bus.emit('x', 2);
  assert.deepEqual(seen, [1]);
});

test('on returns an unsubscribe function', () => {
  const bus = new EventBus();
  const seen = [];
  const unsub = bus.on('x', (p) => seen.push(p));
  bus.emit('x', 1);
  unsub();
  bus.emit('x', 2);
  assert.deepEqual(seen, [1]);
});

test('emit with no listeners is a no-op', () => {
  const bus = new EventBus();
  assert.doesNotThrow(() => bus.emit('nothing', 1));
});

test('a handler unsubscribing itself mid-emit does not skip a sibling', () => {
  const bus = new EventBus();
  const seen = [];
  const a = () => {
    seen.push('a');
    bus.off('x', a);
  };
  const b = () => seen.push('b');
  bus.on('x', a);
  bus.on('x', b);
  bus.emit('x');
  assert.deepEqual(seen, ['a', 'b']);
});
