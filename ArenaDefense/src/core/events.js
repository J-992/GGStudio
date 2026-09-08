/**
 * Minimal synchronous pub/sub. Every cross-system signal in the game
 * (`enemy:spawned`, `wave:cleared`, `player:damaged`, ...) goes through one of
 * these rather than a direct reference, so `src/core` never has to know about
 * `src/game` or `src/ui` listeners.
 */
export class EventBus {
  constructor() {
    /** @type {Map<string, Set<(payload?: any) => void>>} */
    this._listeners = new Map();
  }

  /**
   * @param {string} type
   * @param {(payload?: any) => void} handler
   * @returns {() => void} Unsubscribe function, equivalent to calling `off`.
   */
  on(type, handler) {
    let set = this._listeners.get(type);
    if (!set) {
      set = new Set();
      this._listeners.set(type, set);
    }
    set.add(handler);
    return () => this.off(type, handler);
  }

  /**
   * @param {string} type
   * @param {(payload?: any) => void} handler
   */
  off(type, handler) {
    const set = this._listeners.get(type);
    if (!set) return;
    set.delete(handler);
    if (set.size === 0) this._listeners.delete(type);
  }

  /**
   * @param {string} type
   * @param {any} [payload]
   */
  emit(type, payload) {
    const set = this._listeners.get(type);
    if (!set) return;
    // Copy first: a handler unsubscribing itself (or another handler) mid-emit
    // must never skip or double-call a sibling.
    for (const handler of [...set]) {
      handler(payload);
    }
  }

  /** Removes every listener for every event type. */
  clear() {
    this._listeners.clear();
  }
}
