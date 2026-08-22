import { BALANCE } from '../data/balance';
import type { Ninja } from '../data/types';

/** Stores board occupancy and applies identity-safe move and merge operations. */
export class MergeSystem {
  readonly slots: Array<Ninja | null> = Array.from(
    { length: BALANCE.board.slots },
    () => null,
  );
  private nextId = 1;

  firstEmpty(): number | null {
    const slot = this.slots.findIndex((ninja) => ninja === null);
    return slot < 0 ? null : slot;
  }

  at(slot: number): Ninja | null {
    return this.slots[slot] ?? null;
  }

  spawn(tier: number, slot = this.firstEmpty()): Ninja | null {
    if (slot === null || this.at(slot) !== null) return null;

    const ninja: Ninja = { id: this.nextId++, tier, slot };
    this.slots[slot] = ninja;
    return ninja;
  }

  move(from: number, to: number): Ninja | null {
    const ninja = this.at(from);
    if (ninja === null || this.at(to) !== null) return null;

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

  /** Finds a possible merge so the UI can prompt players before the board stalls. */
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
