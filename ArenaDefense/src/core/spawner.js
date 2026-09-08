/**
 * Turns a flattened wave spawn table into a live, cap-respecting schedule.
 *
 * The cap check happens here rather than in `Game.js` so it can never be
 * skipped by a caller forgetting to check `aliveCount` first: an entry whose
 * time has passed but which would push `aliveCount` over `cap` simply stays
 * pending — not skipped — and is emitted on a later `update()` once room
 * frees up.
 */
export class SpawnScheduler {
  /**
   * @param {import('./types.js').FlatSpawnEntry[]} entries Need not be pre-sorted.
   * @param {number} cap Hard ceiling on simultaneously-alive enemies.
   */
  constructor(entries, cap) {
    /** @type {import('./types.js').FlatSpawnEntry[]} */
    this._entries = [...entries].sort((a, b) => a.t - b.t);
    this._cap = cap;
    this._time = 0;
    this._next = 0; // index of the next not-yet-emitted entry
  }

  /** Whether every entry has been emitted. */
  get done() {
    return this._next >= this._entries.length;
  }

  /**
   * Advances the schedule's clock and returns the entries newly due this
   * frame, respecting `cap`. Entries held back by the cap are retried on the
   * next call rather than dropped.
   *
   * @param {number} dt Seconds elapsed this frame.
   * @param {number} aliveCount Enemies alive right now, before this call's spawns.
   * @returns {import('./types.js').FlatSpawnEntry[]}
   */
  update(dt, aliveCount) {
    this._time += dt;
    const due = [];
    let projectedAlive = aliveCount;

    while (this._next < this._entries.length && this._entries[this._next].t <= this._time) {
      if (projectedAlive >= this._cap) break;
      due.push(this._entries[this._next]);
      projectedAlive++;
      this._next++;
    }

    return due;
  }
}
