import { test } from 'node:test';
import assert from 'node:assert/strict';

import { GameStateMachine, IllegalTransitionError } from '../src/core/stateMachine.js';

test('accepts every transition in the table', () => {
  const legal = [
    ['boot', 'title'],
    ['title', 'build'],
    ['build', 'wave'],
    ['wave', 'waveClear'],
    ['wave', 'death'],
    ['waveClear', 'build'],
    ['death', 'wave'],
    ['death', 'runEnd'],
    ['runEnd', 'title'],
    ['runEnd', 'build'],
  ];
  for (const [from, to] of legal) {
    const sm = new GameStateMachine(from);
    assert.equal(sm.can(to), true, `${from} -> ${to} should be legal`);
    sm.go(to);
    assert.equal(sm.state, to);
  }
});

test('rejects wave -> build', () => {
  const sm = new GameStateMachine('wave');
  assert.equal(sm.can('build'), false);
  assert.throws(() => sm.go('build'), IllegalTransitionError);
  assert.equal(sm.state, 'wave', 'state must not change on a rejected transition');
});

test('rejects an arbitrary illegal transition', () => {
  const sm = new GameStateMachine('boot');
  assert.throws(() => sm.go('wave'), IllegalTransitionError);
});

test('onExit fires for the state being left, onEnter for the state being entered', () => {
  const sm = new GameStateMachine('boot');
  const log = [];
  sm.onExit('boot', () => log.push('exit:boot'));
  sm.onEnter('title', () => log.push('enter:title'));
  sm.onExit('title', () => log.push('exit:title'));
  sm.go('title');
  assert.deepEqual(log, ['exit:boot', 'enter:title']);
});

test('a rejected transition fires no hooks', () => {
  const sm = new GameStateMachine('wave');
  const log = [];
  sm.onExit('wave', () => log.push('exit:wave'));
  sm.onEnter('build', () => log.push('enter:build'));
  assert.throws(() => sm.go('build'));
  assert.deepEqual(log, []);
});
