// The board is data; the view (BoardUI) is a mirror of it. One flat array
// covers both zones so drop() needs no cross-board special cases:
//   slots 0..8   battlefield, index = row*3 + col, row = lane 0..2
//   slots 9..16  merge bench
// A merge destroys both unit uids and mints a fresh one -- the view keys
// sprites by uid, so this is what drives destroy-and-respawn animation.
class BoardModel {
  static FIELD = 9;
  static SIZE = 17;

  constructor() {
    this.slots = new Array(BoardModel.SIZE).fill(null);  // { uid, id, star } | null
    this._nextUid = 1;
  }

  isField(i) { return i >= 0 && i < BoardModel.FIELD; }
  laneOf(i) { return Math.floor(i / 3); }
  at(i) { return this.slots[i] || null; }

  firstEmptyBench() {
    for (let i = BoardModel.FIELD; i < BoardModel.SIZE; i++) {
      if (!this.slots[i]) return i;
    }
    return -1;
  }

  emptyBenchCount() {
    let n = 0;
    for (let i = BoardModel.FIELD; i < BoardModel.SIZE; i++) if (!this.slots[i]) n++;
    return n;
  }

  spawn(id, star, slot) {
    if (slot === undefined || slot === -1) slot = this.firstEmptyBench();
    if (slot < 0 || this.slots[slot]) return null;
    const unit = { uid: this._nextUid++, id, star: star || 1, slot };
    this.slots[slot] = unit;
    return unit;
  }

  move(from, to) {
    if (!this.slots[from] || this.slots[to]) return false;
    this.slots[to] = this.slots[from];
    this.slots[from] = null;
    this.slots[to].slot = to;
    return true;
  }

  swap(from, to) {
    const a = this.slots[from], b = this.slots[to];
    if (!a || !b) return false;
    this.slots[from] = b; this.slots[to] = a;
    a.slot = to; b.slot = from;
    return true;
  }

  remove(slot) {
    const u = this.slots[slot];
    this.slots[slot] = null;
    return u;
  }

  // Same creature + same star fuse into star+1. Returns null when the pair
  // does not merge (different id/star, or already at max).
  merge(from, to) {
    const a = this.slots[from], b = this.slots[to];
    if (!a || !b || a.id !== b.id || a.star !== b.star) return null;
    if (a.star >= CFG.STAR.max) return null;
    const result = { uid: this._nextUid++, id: b.id, star: b.star + 1, slot: to };
    this.slots[from] = null;
    this.slots[to] = result;
    return { consumedUids: [a.uid, b.uid], result };
  }

  // Any mergeable pair on the board -- the tutorial pulse and idle hint.
  mergePair() {
    for (let i = 0; i < BoardModel.SIZE; i++) {
      const a = this.slots[i];
      if (!a || a.star >= CFG.STAR.max) continue;
      for (let j = i + 1; j < BoardModel.SIZE; j++) {
        const b = this.slots[j];
        if (b && b.id === a.id && b.star === a.star) return [i, j];
      }
    }
    return null;
  }

  fieldUnits() {
    const out = [];
    for (let i = 0; i < BoardModel.FIELD; i++) {
      if (this.slots[i]) out.push({ unit: this.slots[i], slot: i, lane: this.laneOf(i), col: i % 3 });
    }
    return out;
  }

  allUnits() {
    return this.slots.filter(Boolean);
  }

  serialize() {
    return this.slots.map((u) => (u ? { i: u.id, s: u.star } : null));
  }

  load(arr) {
    this.slots = new Array(BoardModel.SIZE).fill(null);
    (arr || []).forEach((e, k) => {
      if (e && k < BoardModel.SIZE && CREATURES_BY_ID[e.i]) {
        this.slots[k] = { uid: this._nextUid++, id: e.i, star: e.s || 1, slot: k };
      }
    });
  }
}
window.BoardModel = BoardModel;
