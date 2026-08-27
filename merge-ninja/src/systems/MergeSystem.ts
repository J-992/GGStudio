import { BALANCE } from '../data/balance';
import type { Ninja } from '../data/types';

/**
 * Stores board occupancy and applies identity-safe move and merge operations.
 *
 * Two sets sit alongside the slot array and mean different things. `locked` is
 * a slot the player has not earned yet: permanent for the run, cleared only by
 * reaching an unlock stage. `blocked` is debris a boss threw: temporary, and
 * cleared by time or by a merge landing next to it. Both make a cell unusable,
 * and every path that could put a ninja somewhere has to respect them -- which
 * is why they live here rather than in the caller, where one forgotten check
 * would quietly hand a slot back.
 */
export class MergeSystem {
  readonly slots: Array<Ninja | null> = Array.from(
    { length: BALANCE.board.slots },
    () => null,
  );
  private readonly locked = new Set<number>();
  private readonly blocked = new Set<number>();
  private nextId = 1;

  /** True when the cell holds no ninja and is neither locked nor blocked. */
  usable(slot: number): boolean {
    return slot >= 0
      && slot < this.slots.length
      && !this.locked.has(slot)
      && !this.blocked.has(slot);
  }

  isLocked(slot: number): boolean { return this.locked.has(slot); }
  isBlocked(slot: number): boolean { return this.blocked.has(slot); }
  get lockedSlots(): readonly number[] { return [...this.locked]; }
  get blockedSlots(): readonly number[] { return [...this.blocked]; }

  /** Slots that could take a ninja right now. */
  get freeSlots(): number[] {
    const out: number[] = [];
    for (let slot = 0; slot < this.slots.length; slot += 1) {
      if (this.usable(slot) && this.slots[slot] === null) out.push(slot);
    }
    return out;
  }

  /**
   * Locks every slot at or above `unlockedCount`.
   *
   * A ninja already standing in a slot being locked keeps its place rather
   * than being deleted: nothing in this game destroys something the player
   * bought, and the cell frees up normally once that ninja merges away.
   */
  setUnlockedCount(unlockedCount: number): void {
    this.locked.clear();
    for (let slot = Math.max(0, unlockedCount); slot < this.slots.length; slot += 1) this.locked.add(slot);
  }

  block(slot: number): boolean {
    if (!this.usable(slot) || this.slots[slot] !== null) return false;
    this.blocked.add(slot);
    return true;
  }

  unblock(slot: number): boolean { return this.blocked.delete(slot); }

  /** Orthogonal neighbours on the 3x4 grid, for the adjacent-merge clear rule. */
  neighbours(slot: number): number[] {
    const { cols, rows } = BALANCE.board;
    const row = Math.floor(slot / cols);
    const col = slot % cols;
    const out: number[] = [];
    if (col > 0) out.push(slot - 1);
    if (col < cols - 1) out.push(slot + 1);
    if (row > 0) out.push(slot - cols);
    if (row < rows - 1) out.push(slot + cols);
    return out;
  }

  firstEmpty(): number | null {
    const slot = this.slots.findIndex((ninja, index) => ninja === null && this.usable(index));
    return slot < 0 ? null : slot;
  }

  at(slot: number): Ninja | null {
    return this.slots[slot] ?? null;
  }

  spawn(tier: number, slot = this.firstEmpty()): Ninja | null {
    if (slot === null || this.at(slot) !== null || !this.usable(slot)) return null;

    const ninja: Ninja = { id: this.nextId++, tier, slot };
    this.slots[slot] = ninja;
    return ninja;
  }

  move(from: number, to: number): Ninja | null {
    const ninja = this.at(from);
    if (ninja === null || this.at(to) !== null || !this.usable(to)) return null;

    ninja.slot = to;
    this.slots[to] = ninja;
    this.slots[from] = null;
    return ninja;
  }

  /** Trades the homes of two occupied cells; both ninjas keep their identities. */
  swap(from: number, to: number): [Ninja, Ninja] | null {
    const first = this.at(from);
    const second = this.at(to);
    if (first === null || second === null) return null;

    first.slot = to;
    second.slot = from;
    this.slots[to] = first;
    this.slots[from] = second;
    return [first, second];
  }

  remove(slot: number): Ninja | null {
    const ninja = this.at(slot);
    if (ninja !== null) this.slots[slot] = null;
    return ninja;
  }

  merge(from: number, to: number): { consumedIds: [number, number]; result: Ninja } | null {
    const source = this.at(from);
    const target = this.at(to);
    if (
      source === null ||
      target === null ||
      source.tier !== target.tier ||
      source.tier >= BALANCE.tiers.count
    ) return null;

    const result: Ninja = { id: this.nextId++, tier: target.tier + 1, slot: to };
    this.slots[from] = null;
    this.slots[to] = result;
    return { consumedIds: [source.id, target.id], result };
  }

  clear(): void {
    this.slots.fill(null);
    this.blocked.clear();
  }

  load(items: Array<{ id: number; tier: number } | null>): void {
    this.clear();
    let greatest = 0;

    items.slice(0, BALANCE.board.slots).forEach((item, slot) => {
      if (item !== null) {
        this.slots[slot] = { ...item, slot };
        greatest = Math.max(greatest, item.id);
      }
    });

    this.nextId = greatest + 1;
  }

  highestTier(): number {
    return this.slots.reduce(
      (highest, ninja) => Math.max(highest, ninja?.tier ?? 0),
      0,
    );
  }

  /**
   * Finds a possible merge so the UI can prompt players before the board stalls.
   *
   * Locked and blocked cells hold no ninja by construction, so no filter is
   * needed here -- but a pair is still only a hint if both halves exist, which
   * the occupancy check already guarantees.
   */
  mergePair(): [number, number] | null {
    for (let first = 0; first < this.slots.length; first += 1) {
      for (let second = first + 1; second < this.slots.length; second += 1) {
        const a = this.at(first);
        const b = this.at(second);
        if (a !== null && b !== null && a.tier === b.tier && a.tier < BALANCE.tiers.count) {
          return [first, second];
        }
      }
    }

    return null;
  }
}
