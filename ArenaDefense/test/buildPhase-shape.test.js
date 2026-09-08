// `game/Turrets.js`, `game/buildPhase.js` and `ui/BuildOverlay.js` all touch
// three.js and/or the DOM, so they cannot be imported under `node --test`
// (see `../AGENTS.md` and `../docs/build-a-new-game-bubbly-quokka.md`'s P4
// verification note). This file only exercises the one thing about them
// that *is* headless-testable: that the pure `core/turretLogic.js` functions
// they're built on top of resolve every turret type/level combination in
// `CONFIG` without throwing, so a config typo (a level entry with a bad key,
// a missing `upgradeCost` row) fails `npm run test` instead of only
// surfacing in the browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CONFIG } from '../src/config.js';
import { statsFor, upgradeCost, repairCost } from '../src/core/turretLogic.js';

test('every configured turret type resolves stats at every level with no missing base fields', () => {
  for (const type of CONFIG.turrets.order) {
    const def = CONFIG.turrets.types[type];
    assert.ok(def.base, `${type} has no base prop mesh name`);
    assert.ok(typeof def.color === 'number', `${type} has no numeric color`);
    for (let level = 0; level < def.levels.length; level++) {
      const stats = statsFor(type, level, CONFIG);
      assert.ok(Number.isFinite(stats.dmg), `${type} L${level} dmg not finite`);
      assert.ok(Number.isFinite(stats.rate), `${type} L${level} rate not finite`);
      assert.ok(Number.isFinite(stats.range), `${type} L${level} range not finite`);
    }
  }
});

test('every turret type has exactly (levels.length - 1) upgrade costs', () => {
  for (const type of CONFIG.turrets.order) {
    const def = CONFIG.turrets.types[type];
    assert.equal(def.upgradeCost.length, def.levels.length - 1);
    for (let level = 0; level < def.upgradeCost.length; level++) {
      assert.ok(Number.isFinite(upgradeCost(type, level, CONFIG)));
    }
  }
});

test('repairCost resolves for a freshly placed turret at cfg.turrets.hp', () => {
  const turret = { hp: CONFIG.turrets.hp, hpMax: CONFIG.turrets.hp };
  assert.equal(repairCost(turret, CONFIG), 0);
});
