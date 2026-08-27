import { describe, expect, it } from 'vitest';
import { GameCore } from '../src/core/GameCore';
import { BALANCE } from '../src/data/balance';
import type { StorageLike } from '../src/data/types';

class FakeStorage implements StorageLike {
  private readonly data = new Map<string, string>();
  getItem(key: string): string | null { return this.data.get(key) ?? null; }
  setItem(key: string, value: string): void { this.data.set(key, value); }
  removeItem(key: string): void { this.data.delete(key); }
}

/** Read through a function so narrowing from an earlier assertion cannot leak into later ones. */
const archetypeOf = (game: GameCore): string => game.boss.archetype.id;

/** A run past the tutorial with money on it, which is where cards are ever offered. */
function started(opts: { rng?: () => number } = {}): GameCore {
  const game = new GameCore({ storage: new FakeStorage(), now: () => 0, rng: opts.rng });
  game.completeTutorial();
  game.grantCoins(1_000_000);
  return game;
}

describe('board-shape cards', () => {
  it('sweep clears every blocked slot at once', () => {
    // rng at 0 makes every debris roll succeed, so the board fills with it.
    // Stages are walked as well as time, because a boss that heals holds the
    // throw off entirely while the ladder is still in its rest-beat band.
    const game = started({ rng: () => 0 });
    while (game.currentStage < BALANCE.debris.startStage) game.skipEnemy();
    for (let stage = 0; stage < 40 && game.debrisSlots.length < 2; stage += 1) {
      for (let tick = 0; tick < 20 && game.debrisSlots.length < 2; tick += 1) game.update(500);
      if (game.debrisSlots.length < 2) game.skipEnemy();
    }
    expect(game.debrisSlots.length).toBeGreaterThan(1);

    const cleared: number[] = [];
    game.events.on('debrisCleared', (event) => cleared.push(event.slot));
    game.takeDraftCardForTest('sweep');

    expect(game.debrisSlots).toHaveLength(0);
    expect(cleared.length).toBeGreaterThan(1);
    // Every swept slot is playable again, not merely unlisted.
    for (const slot of cleared) expect(game.lockedSlots).not.toContain(slot);
  });

  it('openMat pulls the next unlock forward without adding a slot to the run', () => {
    const game = started();
    const before = game.unlockedSlotCount;
    expect(before).toBeLessThan(BALANCE.board.slots);

    let unlocked: number[] = [];
    game.events.on('slotUnlocked', (event) => { unlocked = [...unlocked, event.slot]; });
    game.takeDraftCardForTest('openMat');
    expect(game.unlockedSlotCount).toBe(before + 1);
    expect(unlocked).toEqual([before]);

    // Board space is the throttle the economy is balanced against, so the card
    // buys the slot *early* and never buys the run an extra one: walking past
    // the stage that would have granted it changes nothing.
    const nextStage = BALANCE.slots.unlockStages[0]!;
    while (game.currentStage < nextStage) game.skipEnemy();
    game.defeatBossForTest();
    game.update(BALANCE.boss.defeatDelayMs);
    expect(game.unlockedSlotCount).toBe(before + 1);
  });

  it('echo copies the best fighter the board can still merge', () => {
    const game = started();
    game.spawnTier(3);
    game.spawnTier(5);
    const before = game.board.slots.filter((ninja) => ninja?.tier === 5).length;

    game.takeDraftCardForTest('echo');
    expect(game.board.slots.filter((ninja) => ninja?.tier === 5).length).toBe(before + 1);
  });

  it('echo does nothing on an empty board rather than inventing a fighter', () => {
    const game = started();
    for (let slot = 0; slot < BALANCE.board.slots; slot += 1) game.board.remove(slot);
    game.takeDraftCardForTest('echo');
    expect(game.board.slots.every((ninja) => ninja === null)).toBe(true);
  });
});

describe('counter-shape cards', () => {
  it('disarm strips the boss modifier and leaves the next boss its own', () => {
    const game = started();
    while (archetypeOf(game) === 'bare') game.skipEnemy();
    expect(archetypeOf(game)).not.toBe('bare');

    let disarmed = 0;
    game.events.on('bossDisarmed', () => { disarmed += 1; });
    game.takeDraftCardForTest('disarm');

    expect(disarmed).toBe(1);
    expect(archetypeOf(game)).toBe('bare');
    expect(game.boss.shieldCharges).toBe(0);
    expect(game.boss.enraged).toBe(false);

    // The ladder is untouched: a later boss still arms whatever it is owed.
    let armedAgain = false;
    for (let step = 0; step < 60 && !armedAgain; step += 1) {
      game.skipEnemy();
      armedAgain = archetypeOf(game) !== 'bare';
    }
    expect(armedAgain).toBe(true);
  });

  it('stagger holds the boss swing, then hands it back', () => {
    const game = started();
    game.takeDraftCardForTest('stagger');
    expect(game.staggerMsLeft).toBe(BALANCE.draft.staggerMs);

    const hpAfterStagger = ((): number => {
      const before = game.playerHealth;
      game.update(BALANCE.draft.staggerMs - 100);
      return before - game.playerHealth;
    })();
    expect(hpAfterStagger).toBe(0);

    game.update(200);
    expect(game.staggerMsLeft).toBe(0);
  });
});

describe('hot hand', () => {
  it('deals a row on bosses the cadence would skip, then stops', () => {
    const game = started();
    const offers: number[] = [];
    game.events.on('draftOffered', (event) => offers.push(event.stage));

    // Land on the cadence, take the card, then walk off-cadence bosses.
    while (game.currentStage % BALANCE.draft.everyStages !== 0) game.skipEnemy();
    game.takeDraftCardForTest('hotHand');

    const offCadence: number[] = [];
    for (let step = 0; step < BALANCE.draft.hotHandBosses + 2; step += 1) {
      game.skipEnemy();
      if (game.currentStage % BALANCE.draft.everyStages === 0) continue;
      const stage = game.currentStage;
      game.defeatBossForTest();
      game.update(BALANCE.boss.defeatDelayMs);
      if (offers.includes(stage)) offCadence.push(stage);
      if (game.pendingDraft !== null) game.pickDraftCard(game.pendingDraft.cards[0]!);
    }
    expect(offCadence).toHaveLength(BALANCE.draft.hotHandBosses);
  });
});
