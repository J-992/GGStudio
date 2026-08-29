import type { AchievementKind } from '../data/achievements';
import type { ArchetypeId } from '../data/bossArchetypes';
import type { DraftCardId } from '../data/draftCards';
import type { DojoStyleId } from '../data/dojoStyles';
import type { PowerupId } from '../data/powerups';
import type { Ninja } from '../data/types';
import type { BestRun, RecordFlags } from '../systems/BestRun';

export type GameEvent =
  | { type: 'coinsChanged'; coins: number; delta: number }
  | { type: 'ninjaSpawned'; ninja: Ninja; cost: number }
  | { type: 'ninjaMoved'; id: number; from: number; to: number }
  /** Two ninjas traded homes; ids/tiers pair up as [fromSlot's, toSlot's]. */
  | { type: 'ninjaSwapped'; fromSlot: number; toSlot: number; ids: [number, number]; tiers: [number, number] }
  | { type: 'ninjaMerged'; fromSlot: number; toSlot: number; consumedIds: [number, number]; result: Ninja }
  | { type: 'ninjaSold'; id: number; slot: number; refund: number }
  /** A boss swing landed on the board instead of the line; the slot is unusable until cleared. */
  | { type: 'debrisLanded'; slot: number; msLeft: number }
  | { type: 'debrisCleared'; slot: number; cause: 'merge' | 'expire' }
  /** A slot the player had not yet earned is now theirs for good this run. */
  | { type: 'slotUnlocked'; slot: number; unlockedTotal: number }
  /** Merges landing inside `combo.windowMs` of each other; `windowMs` is the time left. */
  | { type: 'mergeComboChanged'; count: number; windowMs: number }
  /** A chain, or a tap streak, paid out a powerup the player earned outright. */
  | { type: 'mergeComboRewarded'; id: PowerupId; count: number; source: 'merge' | 'tap' }
  | { type: 'newTierDiscovered'; tier: number; name: string }
  | { type: 'championChanged'; tier: number; prevTier: number }
  | { type: 'bossDamaged'; damage: number; hp: number; maxHp: number; dps: number; source: 'ninja' | 'tap' | 'merge' }
  | { type: 'bossDefeated'; stage: number; reward: number }
  /** The modifier this stage's boss carries. `firstSeen` gates the one-time banner. */
  | { type: 'bossArchetype'; stage: number; archetype: ArchetypeId; firstSeen: boolean }
  /** A shielded boss's barrier changed; charges are drawn as ring segments, never digits. */
  | { type: 'bossShieldChanged'; charges: number; max: number; broken: boolean }
  /** An enraged boss started or stopped regenerating; `regenPerSec` is 0 when answered. */
  | { type: 'bossEnraged'; enraged: boolean; regenPerSec: number }
  /** A `disarm` card took this boss's modifier away for the rest of its life. */
  | { type: 'bossDisarmed'; stage: number }
  /** A `stagger` card started, or ran out; `msLeft` is 0 when the swing is back. */
  | { type: 'bossStaggered'; msLeft: number }
  /** A greedy boss's timer ran out, or the player beat it. */
  | { type: 'bossBountyResolved'; won: boolean; bonus: number }
  /** Three cards are on offer; the sim keeps running underneath them. */
  | { type: 'draftOffered'; stage: number; cards: readonly DraftCardId[] }
  | { type: 'draftPicked'; stage: number; card: DraftCardId; auto: boolean }
  | {
      type: 'bossStickerCollected';
      id: string;
      pageId: string;
      stage: number;
      slot: number;
      progress: number;
      total: number;
      textureKey: string;
      pageComplete: boolean;
    }
  | { type: 'dojoStyleUnlocked'; id: DojoStyleId }
  | { type: 'dojoStyleEquipped'; id: DojoStyleId; source: 'unlock' | 'player' }
  | { type: 'bossSpawned'; stage: number; name: string; maxHp: number }
  | { type: 'bossAttack'; damage: number; playerHp: number; playerMaxHp: number; defeated: boolean }
  | { type: 'playerHealthChanged'; hp: number; maxHp: number; delta: number; reason: 'bossStrike' | 'victory' | 'rankUp' | 'potion' | 'draft' | 'revive' | 'defeat' | 'reset' }
  | { type: 'potionCollected'; healed: number; hp: number; maxHp: number }
  /** A powerup token entered the arena lane; travelMs is its crossing window. */
  | { type: 'powerupSpawned'; id: PowerupId; travelMs: number }
  | { type: 'powerupCollected'; id: PowerupId }
  /** Frenzy projectiles are presentation-timed, but are anchored to this exact boss stage. */
  | { type: 'shurikenFrenzyVolley'; stage: number; shurikens: number }
  | { type: 'powerupExpired'; id: PowerupId }
  /** The last Coin Frenzy target was either caught or missed. */
  | { type: 'coinFrenzyFinished' }
  /** The player completed the one-time, interactive first-run lesson. */
  | { type: 'tutorialCompleted' }
  /** The first naturally encountered powerup was caught after its contextual prompt. */
  | { type: 'powerupCoachCompleted'; id: PowerupId }
  /** A protective ward ate a boss strike that would have dealt this much. */
  | { type: 'powerupWardBlocked'; damage: number }
  /**
   * The line is out of health: the run is over and the sim has stopped.
   * `records` marks which of the four stats this run just beat, and `best` is
   * the record board after folding it in.
   */
  | {
      type: 'gameOver';
      stage: number;
      highestTier: number;
      coinsEarned: number;
      timePlayedMs: number;
      records: RecordFlags;
      best: BestRun;
    }
  /** A named goal was just met, for the first and only time. */
  | {
      type: 'achievementUnlocked';
      id: string;
      name: string;
      description: string;
      kind: AchievementKind;
      unlockedCount: number;
      total: number;
    }
  | { type: 'tempoChanged'; id: string; label: string }
  | { type: 'boardFull' }
  | { type: 'purchaseRejected'; reason: 'coins' | 'boardFull' }
  | { type: 'mergeHint'; slots: [number, number] }
  /**
   * An optional prestige reset was performed; the run has restarted from stage 1.
   * `rank` is the title the player now carries, which -- unlike the bonus --
   * does not shrink with each ascension.
   */
  | { type: 'ascended'; ascensions: number; bonusPct: number; rank: string }
  | { type: 'stateLoaded' };

/** Minimal typed pub/sub channel shared by the simulation and presentation layer. */
export class EventBus {
  private readonly listeners = new Map<GameEvent['type'], Set<(e: GameEvent) => void>>();
  private readonly any = new Set<(e: GameEvent) => void>();

  on<T extends GameEvent['type']>(
    type: T,
    fn: (e: Extract<GameEvent, { type: T }>) => void,
  ): () => void {
    const set = this.listeners.get(type) ?? new Set();
    this.listeners.set(type, set);
    const listener = fn as (e: GameEvent) => void;
    set.add(listener);
    return () => set.delete(listener);
  }

  onAny(fn: (e: GameEvent) => void): () => void {
    this.any.add(fn);
    return () => this.any.delete(fn);
  }

  emit(e: GameEvent): void {
    this.listeners.get(e.type)?.forEach((fn) => fn(e));
    this.any.forEach((fn) => fn(e));
  }

  clear(): void {
    this.listeners.clear();
    this.any.clear();
  }
}
