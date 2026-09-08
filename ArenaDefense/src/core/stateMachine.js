/**
 * The run's top-level state machine.
 *
 * ```
 * boot -> title
 * title -> build        Play: commercialBreak() then gameplayStart(); reset economy; wave=1; pickActiveGates
 * build -> wave         timer 0 or Ready: refund floor(remaining×0.5); overlay.close
 * wave -> waveClear     spawner.done && alive==0 && !boss.alive: bankWave(); wave==10 -> runEnd(victory)
 * wave -> death          hp<=0: gameplayStop(); discardPending()
 * waveClear -> build    after 1.5 s: wave++; pickActiveGates; save bestWave
 * waveClear -> runEnd   only when the cleared wave is `run.finalWave` (victory) — chained
 *                       immediately from the same wave-clear check, no delay
 *                       (added in P3 so `Game.js` can honour the plan's
 *                       documented "wave==10 -> runEnd(victory)" bullet above;
 *                       `wave` itself still only ever goes to `waveClear`/`death`)
 * death -> wave         rewardedBreak() true (once/run): gameplayStart(); full hp; push enemies; invuln
 * death -> runEnd       decline / false / used
 * runEnd -> title       persist coins (doubled if rewarded doubler true)
 * runEnd -> build       persist coins; commercialBreak(); gameplayStart()
 * ```
 *
 * This module only encodes *which* transitions are legal and the
 * enter/exit hooks around them — the side effects listed above (Poki calls,
 * economy resets, saves) are wired by whatever owns the instance.
 */

/** @type {Readonly<Record<string, readonly string[]>>} */
export const TRANSITIONS = Object.freeze({
  boot: Object.freeze(['title']),
  title: Object.freeze(['build']),
  build: Object.freeze(['wave']),
  wave: Object.freeze(['waveClear', 'death']),
  waveClear: Object.freeze(['build', 'runEnd']),
  death: Object.freeze(['wave', 'runEnd']),
  runEnd: Object.freeze(['title', 'build']),
});

export class IllegalTransitionError extends Error {
  /**
   * @param {string} from
   * @param {string} to
   */
  constructor(from, to) {
    super(`illegal transition: ${from} -> ${to}`);
    this.name = 'IllegalTransitionError';
    this.from = from;
    this.to = to;
  }
}

export class GameStateMachine {
  /**
   * @param {string} [initial]
   */
  constructor(initial = 'boot') {
    if (!(initial in TRANSITIONS)) {
      throw new Error(`GameStateMachine: unknown initial state "${initial}"`);
    }
    /** @type {string} */
    this.state = initial;
    /** @type {Map<string, Set<() => void>>} */
    this._onEnter = new Map();
    /** @type {Map<string, Set<() => void>>} */
    this._onExit = new Map();
  }

  /**
   * @param {string} state
   * @param {() => void} handler
   * @returns {() => void} Unsubscribe.
   */
  onEnter(state, handler) {
    return addTo(this._onEnter, state, handler);
  }

  /**
   * @param {string} state
   * @param {() => void} handler
   * @returns {() => void} Unsubscribe.
   */
  onExit(state, handler) {
    return addTo(this._onExit, state, handler);
  }

  /**
   * @param {string} to
   * @returns {boolean} Whether `to` is a legal transition from the current state.
   */
  can(to) {
    return (TRANSITIONS[this.state] ?? []).includes(to);
  }

  /**
   * Transitions to `to`, firing exit hooks for the current state and then
   * enter hooks for `to`.
   *
   * @param {string} to
   * @throws {IllegalTransitionError} If `to` is not reachable from the current state.
   */
  go(to) {
    if (!this.can(to)) {
      throw new IllegalTransitionError(this.state, to);
    }
    const from = this.state;
    fire(this._onExit, from);
    this.state = to;
    fire(this._onEnter, to);
  }
}

/**
 * @param {Map<string, Set<() => void>>} map
 * @param {string} state
 */
function fire(map, state) {
  const set = map.get(state);
  if (!set) return;
  for (const handler of [...set]) handler();
}

/**
 * @param {Map<string, Set<() => void>>} map
 * @param {string} state
 * @param {() => void} handler
 * @returns {() => void}
 */
function addTo(map, state, handler) {
  let set = map.get(state);
  if (!set) {
    set = new Set();
    map.set(state, set);
  }
  set.add(handler);
  return () => set.delete(handler);
}
