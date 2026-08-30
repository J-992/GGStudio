/**
 * Explicit game states and the legal transitions between them.
 *
 * Every state change routes through {@link GameStateMachine}, which fires exit
 * and enter callbacks. That is what guarantees the requirement that a
 * transition never leaves old physics bodies, listeners, audio or UI alive -
 * teardown is attached to the state, not scattered through call sites.
 */

export enum GameState {
  Boot = 'boot',
  MainMenu = 'mainMenu',
  Shop = 'shop',
  Settings = 'settings',
  /** Level is loading / the pre-run beat. */
  Intro = 'intro',
  Playing = 'playing',
  Paused = 'paused',
  Failed = 'failed',
}

/** Why the last attempt ended. Drives the failure message. */
export type FailReason = 'fell' | 'crashed' | 'caughtByDog' | 'caughtByChef' | 'outOfBounds';

export const FAIL_MESSAGES: Record<FailReason, string[]> = {
  fell: [
    'That landing used one too many lives.',
    'Nine lives, minus one rooftop.',
    'Cats always land on their feet. Usually.',
  ],
  crashed: [
    'That was a lane you needed to not be in.',
    'The rooftop won that one.',
    'Straight into it, at full speed.',
  ],
  caughtByDog: [
    'The dogs caught your scent!',
    'Outrun by a very good boy.',
    'Two dogs, one very smug tail wag.',
  ],
  caughtByChef: [
    'The chef wants his dinner back.',
    'Caught by the apron strings.',
    'That rolling pin had your name on it.',
  ],
  outOfBounds: [
    'That is not the route.',
    'The rooftops are back that way.',
    'Adventurous. Wrong, but adventurous.',
  ],
};

/** States in which the simulation should be running. */
const SIMULATING = new Set<GameState>([GameState.Playing, GameState.Intro]);

/**
 * Which states may follow which. Anything not listed is rejected, which turns
 * an ordering bug into a loud console warning rather than a silent broken run.
 */
const TRANSITIONS: Record<GameState, GameState[]> = {
  [GameState.Boot]: [GameState.MainMenu],
  [GameState.MainMenu]: [GameState.Shop, GameState.Settings, GameState.Intro],
  [GameState.Shop]: [GameState.MainMenu],
  [GameState.Settings]: [GameState.MainMenu, GameState.Paused],
  [GameState.Intro]: [GameState.Playing, GameState.MainMenu],
  [GameState.Playing]: [GameState.Paused, GameState.Failed, GameState.Intro, GameState.MainMenu],
  // Shop is deliberately absent here: it's reachable only from the main
  // menu, never mid-run - see `screen-pause` in index.html, which no longer
  // has a Shop button at all.
  [GameState.Paused]: [
    GameState.Playing,
    GameState.Intro,
    GameState.Settings,
    GameState.MainMenu,
  ],
  [GameState.Failed]: [GameState.Intro, GameState.MainMenu],
};

export interface StateHandlers {
  onEnter?: (from: GameState) => void;
  onExit?: (to: GameState) => void;
}

export type StateChangeListener = (to: GameState, from: GameState) => void;

export class GameStateMachine {
  private current = GameState.Boot;
  private handlers = new Map<GameState, StateHandlers>();
  private listeners = new Set<StateChangeListener>();

  get state(): GameState {
    return this.current;
  }

  /** True when physics and gameplay logic should tick. */
  get isSimulating(): boolean {
    return SIMULATING.has(this.current);
  }

  /**
   * True when the 3D scene should still be rendered behind an overlay.
   *
   * `MainMenu` used to be excluded: the menu was an opaque panel over a torn-
   * down scene. It is now a transparent overlay on the attract scene
   * (`Game.startAttract()` - a real route with the cat sat on it eating), so
   * the only state with nothing behind it is `Boot`.
   */
  get isSceneVisible(): boolean {
    return this.current !== GameState.Boot;
  }

  register(state: GameState, handlers: StateHandlers): void {
    this.handlers.set(state, handlers);
  }

  onChange(listener: StateChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** @returns false if the transition was rejected as illegal. */
  transition(to: GameState): boolean {
    if (to === this.current) return true;

    if (!TRANSITIONS[this.current]?.includes(to)) {
      console.warn(`[state] illegal transition ${this.current} -> ${to}`);
      return false;
    }

    const from = this.current;
    this.handlers.get(from)?.onExit?.(to);
    this.current = to;
    this.handlers.get(to)?.onEnter?.(from);

    for (const listener of this.listeners) listener(to, from);
    return true;
  }

  /** Escape hatch for boot and hard resets. Skips the legality check. */
  force(to: GameState): void {
    const from = this.current;
    if (from === to) return;
    this.handlers.get(from)?.onExit?.(to);
    this.current = to;
    this.handlers.get(to)?.onEnter?.(from);
    for (const listener of this.listeners) listener(to, from);
  }
}
