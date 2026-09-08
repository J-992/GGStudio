import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CONFIG } from '../src/config.js';
import { Economy } from '../src/core/economy.js';

test('starts at CONFIG.build.startEnergy with no coins', () => {
  const eco = new Economy(CONFIG);
  assert.equal(eco.energy, CONFIG.build.startEnergy);
  assert.equal(eco.pendingCoins, 0);
  assert.equal(eco.bankedCoins, 0);
});

test('spend succeeds and deducts when affordable', () => {
  const eco = new Economy(CONFIG);
  eco.addEnergy(50);
  assert.equal(eco.canAfford(50), true);
  assert.equal(eco.spend(50), true);
  assert.equal(eco.energy, 0);
});

test('spend fails and leaves energy unchanged when unaffordable', () => {
  const eco = new Economy(CONFIG);
  eco.addEnergy(10);
  assert.equal(eco.canAfford(50), false);
  assert.equal(eco.spend(50), false);
  assert.equal(eco.energy, 10);
});

test('bankWave moves pendingCoins into bankedCoins and clears pending', () => {
  const eco = new Economy(CONFIG);
  eco.addCoins(3);
  eco.addCoins(5);
  eco.bankWave();
  assert.equal(eco.pendingCoins, 0);
  assert.equal(eco.bankedCoins, 8);
});

test('discardPending clears pending coins but never touches banked coins', () => {
  const eco = new Economy(CONFIG);
  eco.addCoins(10);
  eco.bankWave();
  eco.addCoins(7);
  eco.discardPending();
  assert.equal(eco.pendingCoins, 0);
  assert.equal(eco.bankedCoins, 10);
});

test('readyRefund is floor(secondsLeft * refundEnergyPerS) and does not mutate state', () => {
  const eco = new Economy(CONFIG);
  const refund = eco.readyRefund(15, CONFIG);
  assert.equal(refund, Math.floor(15 * CONFIG.build.refundEnergyPerS));
  assert.equal(eco.energy, CONFIG.build.startEnergy, 'readyRefund must be a pure calculation');
});

test('readyRefund never goes negative for a negative secondsLeft', () => {
  const eco = new Economy(CONFIG);
  assert.equal(eco.readyRefund(-5, CONFIG), 0);
});

test('addEnergy never drives energy negative', () => {
  const eco = new Economy(CONFIG);
  eco.addEnergy(-1000);
  assert.equal(eco.energy, 0);
});
