/**
 * UIManager - owns every DOM overlay for Rooftop Rascal: Cat Escape.
 *
 * This class is the single place that touches `document` for menus, the HUD,
 * and every overlay screen. It shows/hides screens in response to
 * `GameStateMachine` changes, renders the level-select and shop grids
 * from save data, two-way binds the settings screen to `SettingsManager`,
 * and updates the HUD once per frame.
 *
 * Communication is strictly one-way: `Game` hands this class a `UICallbacks`
 * object at construction time and subscribes to nothing else from it. This
 * file must NEVER import `Game` - doing so would create a circular
 * dependency between "the thing that runs the game" and "the thing that
 * displays it". Every user action becomes a callback invocation; every game
 * decision about what a callback should *do* (which state to enter, whether
 * a transition is legal, etc.) lives in `Game`, not here.
 */

import { GameState, GameStateMachine, type FailReason, FAIL_MESSAGES } from '../game/GameState';
import type { PowerUpType } from '../levels/procedural/ChunkTypes';
import { SaveManager, type CatSkinId } from '../game/SaveManager';
import { SettingsManager, type GameSettings } from '../game/SettingsManager';
import { CAT_SKINS, DEFAULT_CAT_SKIN, getSkinDef, type CatSkinDef } from '../entities/CatSkins';
import { AudioManager } from '../game/AudioManager';
import { InputManager } from '../game/InputManager';
import type { TutorialCue } from '../game/Tutorial';

// ============================================================================
// Public contract
// ============================================================================

export interface UICallbacks {
  /** Main menu Play - starts (or restarts) the endless run. */
  onPlay(): void;
  onResume(): void;
  onRestart(): void;
  onReturnToMenu(): void;
  onOpenShop(): void;
  onOpenSettings(): void;
  onCloseSettings(): void;
  onSelectSkin(id: CatSkinId): void;
  /**
   * Show a coat on the shop's cat without equipping or buying it.
   *
   * Separate from `onSelectSkin` because the whole point is that it changes
   * nothing the player owns: a locked coat can be looked at from every angle
   * before any fish are spent, and browsing away from the coat actually worn
   * must not quietly change what the runner wears.
   */
  onPreviewSkin(id: CatSkinId): void;
  /**
   * Buy a coat. Called only after the player has confirmed a purchase the shop
   * believes is affordable and unowned, but `SaveManager.unlockSkin` re-checks
   * both regardless - the save file is user-editable, so what the card renders
   * is never the authority.
   */
  onBuySkin(id: CatSkinId): void;
  onToggleSound(): void;
  onResetProgress(): void;
}

export interface HudState {
  /** Ordinary score fish picked up this run - the number that gets banked. */
  fishCollected: number;
  /**
   * Metres run so far. Replaced `elapsedMs`: an endless runner with a fixed
   * base speed makes time and distance nearly the same measurement, and of the
   * two, distance is the one the player is actually steering towards - and the
   * one a power-up that changes speed makes meaningfully different.
   */
  distance: number;
  /** 0..1, how close the nearest pursuer is. 1 = about to be caught. */
  chasePressure: number;
  /** Tutorial line to show, or null to hide. */
  tutorialText: string | null;
  /** First-time lesson prompt to show, or null. See `Tutorial.ts`. */
  tutorialCue: TutorialCue | null;
  /** Lives remaining this attempt. */
  lives: number;
  /** Lives the attempt started with, so the spent ones can be shown greyed. */
  livesTotal: number;
  /** True while the post-hit invulnerability window is running. */
  invulnerable: boolean;
  /** Whether a corner is close enough to warn about. */
  turnWarning: boolean;
  /** 0 when the corner first appears, 1 at the corner itself. Drives the flash rate. */
  turnProximity: number;
  /** Which way the upcoming corner turns: -1 left, 1 right, 0 when there
   *  isn't one. Drives the turn-warning sign's directional chevron - a
   *  minimal arrow, not text. */
  turnDirection: -1 | 0 | 1;
  /** Chances spent this attempt, 0-2. Drives the "dogs are closing" banner. */
  pursuitStage: number;
  /** Active power-ups this frame, for the HUD icon row. Empty in the
   *  campaign. */
  powerUps: readonly { type: PowerUpType; remainingFrac: number }[];
}

/**
 * What one finished run was worth, handed to the results overlay.
 *
 * `bestDistance` is the record *including* this run, and `isNewBest` says
 * whether this run is what set it - the overlay cannot work that out from the
 * two numbers alone, since a run that ties the record produces the same pair
 * as one that set it.
 */
export interface RunSummary {
  /** Metres run this attempt. */
  distance: number;
  /** Fish banked by this attempt. */
  fish: number;
  /** The standing record after this run was counted. */
  bestDistance: number;
  isNewBest: boolean;
}

/** Placeholder icon per power-up type - unicode glyphs, same "no art assets
 *  yet" convention the lives pill already uses (🐾). */
const POWERUP_ICON: Readonly<Record<PowerUpType, string>> = {
  fishMagnet: '🧲',
  catnipRush: '🌬️',
  nineLives: '❤️',
  shield: '🛡️',
};

const POWERUP_LABEL: Readonly<Record<PowerUpType, string>> = {
  fishMagnet: 'Fish Magnet',
  catnipRush: 'Catnip Rush',
  nineLives: 'Nine Lives',
  shield: 'Shield',
};

// ============================================================================
// Module-level constants / helpers
// ============================================================================

/** Which `.screen` (by id) is shown for each state. `null` means "none". */
const SCREEN_ID_BY_STATE: Record<GameState, string | null> = {
  [GameState.Boot]: 'screen-loading',
  [GameState.MainMenu]: 'screen-menu',
  [GameState.Shop]: 'screen-shop',
  [GameState.Settings]: 'screen-settings',
  [GameState.Intro]: null,
  [GameState.Playing]: null,
  [GameState.Paused]: 'screen-pause',
  [GameState.Failed]: 'screen-failed',
};

/** Every `.screen` id that exists in the document, used to build the lookup cache. */
const ALL_SCREEN_IDS = [
  'screen-loading',
  'screen-menu',
  'screen-shop',
  'screen-settings',
  'screen-pause',
  'screen-failed',
] as const;

/** States in which the HUD (not a `.screen`) should be visible. */
const HUD_VISIBLE_STATES = new Set<GameState>([
  GameState.Intro,
  GameState.Playing,
  GameState.Paused,
  GameState.Failed,
]);

/**
 * Short title per fail reason. `FAIL_MESSAGES` only carries flavour lines for
 * `#fail-message`; `#fail-title` gets one of these fixed, reason-specific
 * headlines instead of repeating the random line twice.
 */
const FAIL_TITLES: Record<FailReason, string> = {
  fell: 'Fell!',
  crashed: 'Crashed!',
  caughtByDog: 'Caught!',
  caughtByChef: 'Caught!',
  outOfBounds: 'Out of Bounds!',
};

type NumericSettingKey = 'masterVolume' | 'musicVolume' | 'effectsVolume';
type BooleanSettingKey =
  | 'muted'
  | 'reducedCameraMotion'
  | 'reducedScreenShake'
  | 'assistMode'
  | 'highContrastText'
  | 'pauseOnFocusLoss';

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * Metres, whole numbers only, thousands separated.
 *
 * Rounded down rather than to nearest so the readout never briefly shows a
 * metre the player has not run yet, and never shows a number one higher than
 * the record they are chasing while still short of it.
 *
 * `toLocaleString` is given an explicit 'en-US' rather than the browser
 * default: the separator has to match between the HUD, the results overlay and
 * the menu's record, and leaving it to the locale means a player whose locale
 * uses '.' as the thousands separator reads "1.234 m" mid-run - which looks
 * like a decimal, not four digits.
 */
export function formatDistance(metres: number): string {
  return `${wholeCount(metres)} m`;
}

/** Fish counts get the same separator treatment, for the same reason. */
export function formatFish(count: number): string {
  return wholeCount(count);
}

/**
 * Shared floor-clamp-separate step behind both.
 *
 * The `Number.isFinite` guard is not defensive padding: `Math.max(0, NaN)` is
 * `NaN`, so clamping alone lets a NaN straight through to
 * `toLocaleString`, which renders it as the literal text "NaN" - on the HUD,
 * every frame, for the rest of the run.
 */
function wholeCount(value: number): string {
  if (!Number.isFinite(value)) return '0';
  return Math.max(0, Math.floor(value)).toLocaleString('en-US');
}

/** Escapes text interpolated into innerHTML-built cards (level/skin names are data, not markup). */
function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ============================================================================
// Cached DOM references
// ============================================================================

interface Refs {
  uiRoot: HTMLElement | null;
  hud: HTMLElement | null;

  loadingBar: HTMLElement | null;
  loadingStatus: HTMLElement | null;

  btnSoundToggle: HTMLButtonElement | null;
  soundToggleUse: SVGUseElement | null;

  skinGrid: HTMLElement | null;

  hudFishCount: HTMLElement | null;
  hudDistance: HTMLElement | null;
  hudLives: HTMLElement | null;
  hudPowerUps: HTMLElement | null;
  hudSpeedLines: HTMLElement | null;
  hudPause: HTMLButtonElement | null;
  hudChaseWarning: HTMLElement | null;
  hudTurnWarning: HTMLElement | null;
  hudTurnArrow: HTMLElement | null;
  hudTutorial: HTMLElement | null;
  hudTutorialCue: HTMLElement | null;
  hudTutorialArrow: HTMLElement | null;
  hudTutorialLabel: HTMLElement | null;

  menuBest: HTMLElement | null;
  menuBestValue: HTMLElement | null;
  shopWalletCount: HTMLElement | null;
  shopPreviewName: HTMLElement | null;
  btnSkinAction: HTMLButtonElement | null;
  shopConfirm: HTMLElement | null;
  shopConfirmBody: HTMLElement | null;

  failTitle: HTMLElement | null;
  failMessage: HTMLElement | null;
  failDistance: HTMLElement | null;
  failFish: HTMLElement | null;
  failBest: HTMLElement | null;
  failNewBest: HTMLElement | null;


  setMasterVolume: HTMLInputElement | null;
  setMusicVolume: HTMLInputElement | null;
  setEffectsVolume: HTMLInputElement | null;
  setMuted: HTMLInputElement | null;
  setReducedCamera: HTMLInputElement | null;
  setReducedShake: HTMLInputElement | null;
  setAssistMode: HTMLInputElement | null;
  setHighContrast: HTMLInputElement | null;
  setPauseOnBlur: HTMLInputElement | null;
  setGraphicsQuality: HTMLSelectElement | null;
}

// ============================================================================
// UIManager
// ============================================================================

export class UIManager {
  private readonly refs: Refs;
  private readonly screens = new Map<string, HTMLElement>();
  private readonly buttonActions: Map<string, () => void>;

  private readonly unsubscribeState: () => void;
  private readonly unsubscribeSettings: () => void;

  /** Cleanup callbacks for the settings two-way bindings, run by `dispose()`. */
  private readonly settingsCleanup: Array<() => void> = [];

  /** Guards against settings->control sync re-triggering the control->settings listeners. */
  private isApplyingSettings = false;

  // ---- Shop ----
  /**
   * The coat the shop's cat is currently wearing, which is *not* the coat the
   * player owns and runs in.
   *
   * Lives here rather than in the save file on purpose: browsing is not
   * progress. It resets to the equipped coat on every entry to the screen, so
   * leaving the shop mid-browse can never strand the player looking at
   * something they do not own the next time they open it.
   *
   * Seeded with the default rather than `save.data.selectedSkin` because a
   * field initialiser cannot depend on a constructor parameter; the real value
   * is written by `handleStateChange` before the screen is ever shown.
   */
  private previewSkin: CatSkinId = DEFAULT_CAT_SKIN;

  /** The coat the confirmation dialog is asking about, or null when it is closed. */
  private pendingPurchase: CatSkinId | null = null;

  // ---- HUD last-written cache (avoids redundant DOM writes every frame) ----
  private hudFishText: string | null = null;
  private hudDistanceText: string | null = null;
  private hudLivesKey: string | null = null;
  private hudChaseVisible: boolean | null = null;
  private hudChaseCritical: boolean | null = null;
  private hudChasePressure: number | null = null;
  private hudTutorialText: string | null | undefined = undefined;
  private hudTutorialCueKey: string | null = null;
  private hudPauseVisible: boolean | null = null;
  private hudTurnKey: string | null = null;
  private hudTurnProximity: number | null = null;
  /** Which power-ups are active - rebuilds the icon row only when the *set*
   *  changes, not every frame a timer ticks. */
  private hudPowerUpsSetKey: string | null = null;
  private hudSpeedLinesIntensity: number | null = null;

  constructor(
    private readonly stateMachine: GameStateMachine,
    private readonly save: SaveManager,
    private readonly settings: SettingsManager,
    private readonly audio: AudioManager,
    private readonly input: InputManager,
    private readonly callbacks: UICallbacks,
  ) {
    this.refs = this.collectRefs();

    for (const id of ALL_SCREEN_IDS) {
      const el = this.refs.uiRoot?.querySelector<HTMLElement>(`#${id}`) ?? document.getElementById(id);
      if (el) this.screens.set(id, el);
    }

    this.buttonActions = this.buildButtonActions();

    // ---- Screen routing ----
    this.unsubscribeState = stateMachine.onChange(this.handleStateChange);
    this.handleStateChange(stateMachine.state);

    // ---- Delegated listeners ----
    // Audio feedback + fixed-id button routing: ONE listener on #ui-root
    // handles every menu/overlay button, including dynamically rendered
    // level/skin cards, via bubbling - no per-button listeners anywhere.
    this.refs.uiRoot?.addEventListener('click', this.handleUiRootClick);
    // pointerenter does not bubble; pointerover does, so delegation for hover
    // feedback uses pointerover plus a relatedTarget check to fire only on
    // genuine "entered a new button" transitions.
    this.refs.uiRoot?.addEventListener('pointerover', this.handleUiRootPointerOver);

    // The shop grid gets its own delegated listener, since it needs
    // per-card data (skin id) that the generic ui-root handler doesn't parse.
    this.refs.skinGrid?.addEventListener('click', this.handleSkinGridClick);

    // Document-level because the confirmation takes no focus of its own until
    // the player tabs into it, and Escape has to close it either way.
    document.addEventListener('keydown', this.handleKeyDown);

    // #hud-pause lives outside #ui-root (it's part of the always-present HUD,
    // not a screen), so it needs its own listener rather than joining the
    // ui-root delegation above.
    this.refs.hudPause?.addEventListener('click', this.handleHudPauseClick);

    // ---- Settings two-way binding ----
    this.bindNumeric(this.refs.setMasterVolume, 'masterVolume');
    this.bindNumeric(this.refs.setMusicVolume, 'musicVolume');
    this.bindNumeric(this.refs.setEffectsVolume, 'effectsVolume');
    this.bindBoolean(this.refs.setMuted, 'muted');
    this.bindBoolean(this.refs.setReducedCamera, 'reducedCameraMotion');
    this.bindBoolean(this.refs.setReducedShake, 'reducedScreenShake');
    this.bindBoolean(this.refs.setAssistMode, 'assistMode');
    this.bindBoolean(this.refs.setHighContrast, 'highContrastText');
    this.bindBoolean(this.refs.setPauseOnBlur, 'pauseOnFocusLoss');
    this.bindGraphicsQuality(this.refs.setGraphicsQuality);

    this.unsubscribeSettings = settings.onChange((s) => this.syncControlsFromSettings(s));
    this.syncControlsFromSettings(settings.settings);

    this.refresh();
  }

  // ==========================================================================
  // DOM lookup
  // ==========================================================================

  /** Looks up an element by id, warning (not throwing) on a markup typo. */
  private qs<T extends HTMLElement = HTMLElement>(id: string): T | null {
    const el = document.getElementById(id) as T | null;
    if (!el) console.warn(`[ui] missing element #${id}`);
    return el;
  }

  private collectRefs(): Refs {
    const btnSoundToggle = this.qs<HTMLButtonElement>('btn-sound-toggle');
    return {
      uiRoot: this.qs('ui-root'),
      hud: this.qs('hud'),

      loadingBar: this.qs('loading-bar'),
      loadingStatus: this.qs('loading-status'),

      btnSoundToggle,
      soundToggleUse: btnSoundToggle?.querySelector('use') ?? null,

      skinGrid: this.qs('skin-grid'),

      hudFishCount: this.qs('hud-fish-count'),
      hudDistance: this.qs('hud-distance'),
      hudLives: this.qs('hud-lives'),
      hudPowerUps: this.qs('hud-powerups'),
      hudSpeedLines: this.qs('hud-speedlines'),
      hudPause: this.qs<HTMLButtonElement>('hud-pause'),
      hudChaseWarning: this.qs('hud-chase-warning'),
      hudTurnWarning: this.qs('hud-turn-warning'),
      hudTurnArrow: this.qs('hud-turn-arrow'),
      hudTutorial: this.qs('hud-tutorial'),
      hudTutorialCue: this.qs('hud-tutorial-cue'),
      hudTutorialArrow: this.qs('hud-tutorial-arrow'),
      hudTutorialLabel: this.qs('hud-tutorial-label'),

      menuBest: this.qs('menu-best'),
      menuBestValue: this.qs('menu-best-value'),
      shopWalletCount: this.qs('shop-wallet-count'),
      shopPreviewName: this.qs('shop-preview-name'),
      btnSkinAction: this.qs<HTMLButtonElement>('btn-skin-action'),
      shopConfirm: this.qs('shop-confirm'),
      shopConfirmBody: this.qs('shop-confirm-body'),

      failTitle: this.qs('fail-title'),
      failMessage: this.qs('fail-message'),
      failDistance: this.qs('fail-distance'),
      failFish: this.qs('fail-fish'),
      failBest: this.qs('fail-best'),
      failNewBest: this.qs('fail-new-best'),


      setMasterVolume: this.qs<HTMLInputElement>('set-master-volume'),
      setMusicVolume: this.qs<HTMLInputElement>('set-music-volume'),
      setEffectsVolume: this.qs<HTMLInputElement>('set-effects-volume'),
      setMuted: this.qs<HTMLInputElement>('set-muted'),
      setReducedCamera: this.qs<HTMLInputElement>('set-reduced-camera'),
      setReducedShake: this.qs<HTMLInputElement>('set-reduced-shake'),
      setAssistMode: this.qs<HTMLInputElement>('set-assist-mode'),
      setHighContrast: this.qs<HTMLInputElement>('set-high-contrast'),
      setPauseOnBlur: this.qs<HTMLInputElement>('set-pause-on-blur'),
      setGraphicsQuality: this.qs<HTMLSelectElement>('set-graphics-quality'),
    };
  }

  // ==========================================================================
  // Screen routing
  // ==========================================================================

  private readonly handleStateChange = (to: GameState): void => {
    const activeId = SCREEN_ID_BY_STATE[to];
    for (const [id, el] of this.screens) {
      el.hidden = id !== activeId;
    }
    if (this.refs.hud) {
      this.refs.hud.hidden = !HUD_VISIBLE_STATES.has(to);
    }

    // Both of these read straight off the save file, which changes while these
    // screens are *not* on show - a run banks fish and can beat the record.
    // Refreshing on entry rather than on write means neither screen has to be
    // told when that happened; there is nowhere for the two to drift apart.
    if (to === GameState.MainMenu) this.renderBestDistance();
    if (to === GameState.Shop) {
      // Browsing does not persist - the screen always opens on the coat the
      // player is actually wearing, so what the preview shows on entry matches
      // what they just saw themselves running in.
      this.previewSkin = this.save.data.selectedSkin;
      this.closePurchaseConfirm();
      this.renderShop();
    }
  };

  // ==========================================================================
  // Delegated button handling (audio feedback + fixed-id routing)
  // ==========================================================================

  /**
   * Maps every static button id in index.html to the callback it triggers.
   * Dynamically rendered level/skin cards are NOT in this map - they're
   * routed by their own grid-level delegated listeners instead, since they
   * carry per-card data this generic map can't express.
   *
   * Note: #hud-pause has no entry here (and no `onPause` callback exists at
   * all) - the HUD's pause button is wired directly to
   * `stateMachine.transition(GameState.Paused)` in `handleHudPauseClick`,
   * since pausing needs no game-level orchestration beyond a legal state
   * transition and UIManager already holds a state machine reference for
   * exactly this kind of simple, unambiguous case.
   */
  private buildButtonActions(): Map<string, () => void> {
    return new Map<string, () => void>([
      ['btn-play', () => this.callbacks.onPlay()],
      ['btn-shop', () => this.callbacks.onOpenShop()],
      ['btn-settings', () => this.callbacks.onOpenSettings()],
      ['btn-sound-toggle', () => this.callbacks.onToggleSound()],
      ['btn-shop-back', () => this.callbacks.onReturnToMenu()],
      ['btn-skin-action', () => this.handleSkinAction()],
      ['btn-buy-cancel', () => this.closePurchaseConfirm()],
      ['btn-buy-confirm', () => this.handleConfirmPurchase()],
      // Settings is reachable from both the main menu and the pause overlay.
      // #btn-settings-back always just calls onCloseSettings() with no
      // destination info - Game resolves where "back" goes (it already gets
      // the `from` state for free via its own GameState.Settings onEnter
      // handler), so this UI layer never hard-codes or guesses the target.
      ['btn-settings-back', () => this.callbacks.onCloseSettings()],
      ['btn-resume', () => this.callbacks.onResume()],
      ['btn-pause-restart', () => this.callbacks.onRestart()],
      ['btn-pause-settings', () => this.callbacks.onOpenSettings()],
      ['btn-pause-menu', () => this.callbacks.onReturnToMenu()],
      ['btn-fail-retry', () => this.callbacks.onRestart()],
      ['btn-fail-menu', () => this.callbacks.onReturnToMenu()],
      ['btn-reset-progress', () => this.callbacks.onResetProgress()],
    ]);
  }

  private readonly handleUiRootClick = (e: MouseEvent): void => {
    const target = e.target;
    if (!(target instanceof Element)) return;
    const btn = target.closest('button');
    if (!btn || btn.disabled) return;

    this.audio.play('uiClick');
    // A little extra personality on the button that actually starts a run -
    // alongside the generic click, not instead of it. Judgment call, worth
    // confirming by ear rather than a hard requirement per the task.
    if (btn.id === 'btn-play') this.audio.play('catMeow');

    const action = this.buttonActions.get(btn.id);
    if (action) action();
  };

  private readonly handleUiRootPointerOver = (e: PointerEvent): void => {
    const target = e.target;
    if (!(target instanceof Element)) return;
    const btn = target.closest('button');
    if (!btn || btn.disabled) return;

    // Ignore pointer moves that stay within the same button (e.g. between an
    // icon and its label) - only a genuine "entered a new button" counts.
    const related = e.relatedTarget;
    if (related instanceof Node && btn.contains(related)) return;

    this.audio.play('uiHover');
  };

  private readonly handleHudPauseClick = (): void => {
    this.audio.play('uiClick');
    this.stateMachine.transition(GameState.Paused);
  };

  /**
   * A card click only ever *shows* a coat on the preview cat.
   *
   * This used to be the commit: clicking bought an unowned coat outright and
   * wore an owned one, which meant every card was a live control whose meaning
   * depended on save state, and the only way to see a coat on the cat was to
   * already own it. Locked cards therefore had to be `disabled` - the one
   * thing a player most wants to click, "show me the one I am saving up for",
   * was the one thing the grid refused.
   *
   * Now every card is clickable, including coats that cannot be afforded, and
   * nothing is spent or equipped until the player uses the action button under
   * the preview. That is also what makes a confirmation step meaningful: the
   * question can name a coat the player has already had a proper look at.
   */
  private readonly handleSkinGridClick = (e: MouseEvent): void => {
    const target = e.target;
    if (!(target instanceof Element)) return;
    const card = target.closest<HTMLButtonElement>('.skin-card');
    if (!card || card.disabled) return;

    const id = card.dataset.skinId as CatSkinId | undefined;
    if (!id || id === this.previewSkin) return;

    this.previewSkin = id;
    this.callbacks.onPreviewSkin(id);
    this.renderShop();
  };

  /**
   * The one control that spends or equips: wear the previewed coat, or open
   * the confirmation for buying it.
   *
   * Both re-read the save rather than trusting what was last rendered, because
   * the button's label was written at render time and the save is the only
   * authority on what is owned or affordable.
   */
  private readonly handleSkinAction = (): void => {
    const id = this.previewSkin;
    if (this.save.isSkinUnlocked(id)) {
      if (this.save.data.selectedSkin !== id) this.callbacks.onSelectSkin(id);
      this.renderShop();
      return;
    }
    if (this.save.fish < getSkinDef(id).cost) return;
    this.openPurchaseConfirm(id);
  };

  /**
   * Asks before spending.
   *
   * Worth a step of its own because a coat is bought with a currency that took
   * runs to earn and is gone the moment it is spent - there is no sell-back,
   * and a mis-click on a premium coat costs a couple of dozen runs. The dialog
   * names the coat and the price so the question can be answered without
   * looking anywhere else on the screen.
   */
  private openPurchaseConfirm(id: CatSkinId): void {
    const skin = getSkinDef(id);
    this.pendingPurchase = id;
    if (this.refs.shopConfirmBody) {
      this.refs.shopConfirmBody.textContent =
        `Unlock ${skin.name} for ${formatFish(skin.cost)} fish? ` +
        `You will have ${formatFish(this.save.fish - skin.cost)} left.`;
    }
    if (this.refs.shopConfirm) this.refs.shopConfirm.hidden = false;

    // `aria-modal` is a claim, not a mechanism: without moving focus, a
    // keyboard or screen-reader user is left on the button behind the dialog
    // being told they are inside one. Cancel rather than Buy takes it, so
    // that a stray Enter costs nothing.
    this.refs.shopConfirm?.querySelector<HTMLButtonElement>('#btn-buy-cancel')?.focus();
  }

  /**
   * @param restoreFocus put focus back on the control that opened the dialog.
   *   Dismissing should: the player is exactly where they were. Completing a
   *   purchase should not - that button is about to become a disabled "Worn",
   *   and focusing an element that is then disabled drops focus to the body,
   *   sending the next Tab back to the top of the page.
   */
  private closePurchaseConfirm(restoreFocus = true): void {
    const wasOpen = this.pendingPurchase !== null;
    this.pendingPurchase = null;
    if (this.refs.shopConfirm) this.refs.shopConfirm.hidden = true;
    if (wasOpen && restoreFocus && !this.refs.btnSkinAction?.disabled) {
      this.refs.btnSkinAction?.focus();
    }
  }

  /**
   * Completes a confirmed purchase, then wears what was bought.
   *
   * Equipping is the UI's decision, not the save layer's - `unlockSkin` still
   * only unlocks. But the player just answered "yes" to a dialog about a coat
   * they are looking at on the cat, so leaving them to click again to actually
   * wear it would read as the purchase not having taken.
   *
   * Whether it *did* take is read back off the save rather than assumed:
   * `onBuySkin` reports nothing, and `unlockSkin` refuses a purchase the shop
   * only believed was affordable.
   */
  private readonly handleConfirmPurchase = (): void => {
    const id = this.pendingPurchase;
    this.closePurchaseConfirm(false);
    if (!id) return;

    this.callbacks.onBuySkin(id);
    if (this.save.isSkinUnlocked(id)) this.callbacks.onSelectSkin(id);
    this.renderShop();

    // The grid is rebuilt from scratch by `renderShop`, so the card focused
    // before the purchase no longer exists. Land on the coat just bought -
    // the action button beside it now reads "Worn" and is disabled, so it is
    // not somewhere focus can rest.
    this.refs.skinGrid
      ?.querySelector<HTMLButtonElement>(`.skin-card[data-skin-id="${id}"]`)
      ?.focus();
  };

  /** Escape closes the confirmation, which is the only modal in the game. */
  private readonly handleKeyDown = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape' || !this.pendingPurchase) return;
    e.preventDefault();
    this.closePurchaseConfirm();
    this.audio.play('uiClick');
  };

  // ==========================================================================
  // Settings two-way binding
  // ==========================================================================

  private bindNumeric(el: HTMLInputElement | null, key: NumericSettingKey): void {
    if (!el) return;
    const handler = (): void => {
      if (this.isApplyingSettings) return; // a settings->control sync is in progress, not a user edit
      this.settings.set(key, Number(el.value));
    };
    el.addEventListener('input', handler);
    this.settingsCleanup.push(() => el.removeEventListener('input', handler));
  }

  private bindBoolean(el: HTMLInputElement | null, key: BooleanSettingKey): void {
    if (!el) return;
    const handler = (): void => {
      if (this.isApplyingSettings) return;
      this.settings.set(key, el.checked);
    };
    el.addEventListener('input', handler);
    this.settingsCleanup.push(() => el.removeEventListener('input', handler));
  }

  private bindGraphicsQuality(el: HTMLSelectElement | null): void {
    if (!el) return;
    const handler = (): void => {
      if (this.isApplyingSettings) return;
      const value = el.value;
      if (value === 'low' || value === 'medium' || value === 'high') {
        this.settings.set('graphicsQuality', value);
      }
    };
    el.addEventListener('input', handler);
    this.settingsCleanup.push(() => el.removeEventListener('input', handler));
  }

  /** Pushes `GameSettings` onto every bound control. Fires on load and on every `settings.onChange`. */
  private syncControlsFromSettings(s: GameSettings): void {
    this.isApplyingSettings = true;
    try {
      if (this.refs.setMasterVolume) this.refs.setMasterVolume.value = String(s.masterVolume);
      if (this.refs.setMusicVolume) this.refs.setMusicVolume.value = String(s.musicVolume);
      if (this.refs.setEffectsVolume) this.refs.setEffectsVolume.value = String(s.effectsVolume);
      if (this.refs.setMuted) this.refs.setMuted.checked = s.muted;
      if (this.refs.setReducedCamera) this.refs.setReducedCamera.checked = s.reducedCameraMotion;
      if (this.refs.setReducedShake) this.refs.setReducedShake.checked = s.reducedScreenShake;
      if (this.refs.setAssistMode) this.refs.setAssistMode.checked = s.assistMode;
      if (this.refs.setHighContrast) this.refs.setHighContrast.checked = s.highContrastText;
      if (this.refs.setPauseOnBlur) this.refs.setPauseOnBlur.checked = s.pauseOnFocusLoss;
      if (this.refs.setGraphicsQuality) this.refs.setGraphicsQuality.value = s.graphicsQuality;

      this.refs.uiRoot?.classList.toggle('high-contrast', s.highContrastText);

      this.refs.btnSoundToggle?.setAttribute('aria-pressed', String(s.muted));
      this.refs.soundToggleUse?.setAttribute('href', s.muted ? '#icon-sound-off' : '#icon-sound-on');
    } finally {
      this.isApplyingSettings = false;
    }
  }

  // ==========================================================================
  // Shop grid
  // ==========================================================================

  /** Re-reads save data and rebuilds everything it drives - call after progress
   *  changes outside the normal flow (e.g. a progress reset from Settings,
   *  which can zero the wallet and the record while the shop is not on show). */
  refresh(): void {
    this.renderShop();
    this.renderBestDistance();
  }

  /** The wallet, the grid and the action bar: three views of the same two save
   *  fields plus `previewSkin`, so they are never rendered one without the
   *  others - a bought coat has to change all three at once. */
  private renderShop(): void {
    if (this.refs.shopWalletCount) {
      this.refs.shopWalletCount.textContent = formatFish(this.save.fish);
    }
    if (this.refs.skinGrid) {
      this.refs.skinGrid.innerHTML = CAT_SKINS.map((skin) => this.buildSkinCardHtml(skin)).join('');
    }
    this.renderShopAction();
  }

  /**
   * The name and button under the preview, in one of four states:
   *
   *   worn                - "Worn", disabled: nothing left to do to this coat
   *   owned, not worn     - "Wear"
   *   affordable          - "Buy" plus the price
   *   too expensive       - how many more fish are needed, disabled
   *
   * The last one is a label rather than a hidden button because it answers the
   * question the player actually has while looking at a locked coat, which is
   * not "can I buy this" - the greyed card already said no - but "how much
   * further is it". A disabled button with no number would make them work that
   * out from the price and the wallet themselves.
   */
  private renderShopAction(): void {
    const skin = getSkinDef(this.previewSkin);
    const owned = this.save.isSkinUnlocked(skin.id);
    const worn = owned && this.save.data.selectedSkin === skin.id;
    const shortfall = skin.cost - this.save.fish;

    if (this.refs.shopPreviewName) this.refs.shopPreviewName.textContent = skin.name;

    const button = this.refs.btnSkinAction;
    if (!button) return;

    if (worn) {
      button.textContent = 'Worn';
      button.disabled = true;
    } else if (owned) {
      button.textContent = 'Wear';
      button.disabled = false;
    } else if (shortfall <= 0) {
      button.textContent = `Buy for ${formatFish(skin.cost)} fish`;
      button.disabled = false;
    } else {
      button.textContent = `${formatFish(shortfall)} more fish needed`;
      button.disabled = true;
    }
  }

  /** The main menu's personal best, hidden entirely until there is one. */
  private renderBestDistance(): void {
    const best = this.save.bestDistance;
    if (this.refs.menuBest) this.refs.menuBest.hidden = best <= 0;
    if (this.refs.menuBestValue) this.refs.menuBestValue.textContent = formatDistance(best);
  }

  /**
   * One card per coat. Every card does the same thing - show that coat on the
   * preview cat - so what varies is only what it says about itself:
   *
   *   worn              - the check badge, no price
   *   owned             - no price, nothing owed
   *   affordable        - its price, highlighted
   *   too expensive     - its price, greyed
   *
   * The last of those is rendered rather than hidden on purpose: a coat the
   * player cannot afford yet is the reason to go and collect fish, so hiding
   * it would remove the only thing the currency is *for*.
   *
   * No card is ever `disabled` any more. It used to be, because a card was the
   * buy button and an unaffordable one had nothing to do; now the greying says
   * "you cannot buy this yet" while the card still answers "what does it look
   * like", which is the question a locked coat exists to provoke. Disabling it
   * would also drop it out of the tab order, leaving the roster only partly
   * reachable from a keyboard.
   *
   * `aria-pressed` tracks the *preview*, not what is worn, because pressing a
   * card is what moves the preview - it is the state the control actually
   * toggles. What is worn is carried by the label instead.
   */
  private buildSkinCardHtml(skin: CatSkinDef): string {
    const owned = this.save.isSkinUnlocked(skin.id);
    const worn = owned && this.save.data.selectedSkin === skin.id;
    const affordable = owned || this.save.fish >= skin.cost;
    const previewed = skin.id === this.previewSkin;

    const classes = ['skin-card'];
    if (worn) classes.push('skin-card--selected');
    if (previewed) classes.push('skin-card--previewed');
    if (!owned) classes.push('skin-card--locked');
    if (!owned && affordable) classes.push('skin-card--affordable');

    // A price is only information while the coat is unowned; once bought, the
    // number is history and the card should read as a wearable thing.
    const price = owned
      ? ''
      : `<span class="skin-card__cost">` +
        `<svg class="icon" aria-hidden="true"><use href="#icon-fish"/></svg>` +
        `${formatFish(skin.cost)}</span>`;

    // Spelled out rather than left to the visuals: a swatch, a name and a
    // number tell a screen reader nothing about whether this coat is worn,
    // buyable, or out of reach.
    const status = owned
      ? worn
        ? 'worn'
        : 'owned'
      : affordable
        ? `costs ${formatFish(skin.cost)} fish`
        : `locked, costs ${formatFish(skin.cost)} fish`;

    return (
      `<button class="${classes.join(' ')}" data-skin-id="${skin.id}" type="button"` +
      ` aria-pressed="${previewed}"` +
      ` aria-label="${escapeHtml(`${skin.name}, ${status}. Show on the cat.`)}">` +
      `<span class="skin-card__swatch" style="background: ${skin.swatch}"></span>` +
      `<span class="skin-card__name">${escapeHtml(skin.name)}</span>` +
      price +
      `</button>`
    );
  }

  // ==========================================================================
  // Loading screen
  // ==========================================================================

  setLoadingProgress(fraction: number, status?: string): void {
    const clamped = clamp01(fraction);
    if (this.refs.loadingBar) this.refs.loadingBar.style.width = `${(clamped * 100).toFixed(1)}%`;
    if (status !== undefined && this.refs.loadingStatus) this.refs.loadingStatus.textContent = status;
  }

  // ==========================================================================
  // HUD
  // ==========================================================================

  /** Called every rendered frame while playing. Only touches the DOM when a value actually changed. */
  updateHud(state: HudState): void {
    // A bare count, not "N of M": these fish are deposits into a wallet the
    // shop spends, so there is no denominator to be a fraction of.
    const fishText = formatFish(state.fishCollected);
    if (fishText !== this.hudFishText) {
      this.hudFishText = fishText;
      if (this.refs.hudFishCount) this.refs.hudFishCount.textContent = fishText;
    }

    const distanceText = formatDistance(state.distance);
    if (distanceText !== this.hudDistanceText) {
      this.hudDistanceText = distanceText;
      if (this.refs.hudDistance) this.refs.hudDistance.textContent = distanceText;
    }

    this.updateLivesPill(state);
    this.updatePowerUps(state);
    this.updateSpeedLines(state);

    this.updateChaseWarning(state.chasePressure);
    this.updateTurnWarning(state);
    this.updateTutorialCue(state.tutorialCue);

    if (state.tutorialText !== this.hudTutorialText) {
      this.hudTutorialText = state.tutorialText;
      if (this.refs.hudTutorial) {
        if (state.tutorialText) {
          this.refs.hudTutorial.textContent = state.tutorialText;
          this.refs.hudTutorial.hidden = false;
        } else {
          this.refs.hudTutorial.hidden = true;
        }
      }
    }

    const touchActive = this.input.isTouchActive;
    if (touchActive !== this.hudPauseVisible) {
      this.hudPauseVisible = touchActive;
      if (this.refs.hudPause) this.refs.hudPause.hidden = !touchActive;
    }
  }

  /**
   * Draws the paw counter.
   *
   * Every paw is always rendered and the spent ones are dimmed rather than
   * removed, so the pill never changes width mid-run and the player can read
   * "one left of three" at a glance instead of counting. Rewritten only when the
   * count or the invulnerable flag actually changes.
   */
  private updateLivesPill(state: HudState): void {
    const el = this.refs.hudLives;
    if (!el) return;

    const key = `${state.lives}/${state.livesTotal}/${state.invulnerable}`;
    if (key === this.hudLivesKey) return;
    this.hudLivesKey = key;

    let html = '';
    for (let i = 0; i < state.livesTotal; i++) {
      const spent = i >= state.lives;
      html += `<span class="hud-life${spent ? ' hud-life--spent' : ''}">🐾</span>`;
    }
    el.innerHTML = html;

    el.classList.toggle('is-invulnerable', state.invulnerable);
    el.setAttribute('aria-label', `${state.lives} of ${state.livesTotal} lives left`);
  }

  /**
   * The active power-up icon row. Rebuilt only when the *set* of active
   * types changes (a timer ticking down doesn't change which icons exist,
   * only how "full" each one reads) - each icon's own countdown is then a
   * per-frame `--remaining` custom-property write, the same pattern
   * {@link updateTurnWarning} uses for `--proximity`.
   */
  private updatePowerUps(state: HudState): void {
    const el = this.refs.hudPowerUps;
    if (!el) return;

    const types = state.powerUps.map((p) => p.type);
    const setKey = types.join(',');
    if (setKey !== this.hudPowerUpsSetKey) {
      this.hudPowerUpsSetKey = setKey;
      el.innerHTML = state.powerUps
        .map(
          (p) =>
            `<span class="hud-powerup" data-type="${p.type}" title="${POWERUP_LABEL[p.type]}">` +
            `<span class="hud-powerup__icon">${POWERUP_ICON[p.type]}</span></span>`,
        )
        .join('');
      el.hidden = state.powerUps.length === 0;
    }

    const icons = el.querySelectorAll<HTMLElement>('.hud-powerup');
    icons.forEach((icon: HTMLElement, i: number) => {
      const frac = state.powerUps[i]?.remainingFrac ?? 0;
      const quantised = Math.round(clamp01(frac) * 20) / 20;
      icon.style.setProperty('--remaining', String(quantised));
    });
  }

  /**
   * Fades the radial comic-style speed lines in with Catnip Rush's remaining
   * duration, and fades them back out over roughly the effect's last
   * second (`remainingFrac * 4`, so full opacity for the first 3/4 of the
   * run and a taper on the way out) rather than popping off at the exact
   * expiry frame. Reads directly off `state.powerUps` - already carrying
   * `{type, remainingFrac}` per active type - rather than adding a parallel
   * `HudState` field for the same data.
   */
  private updateSpeedLines(state: HudState): void {
    const el = this.refs.hudSpeedLines;
    if (!el) return;

    const catnip = state.powerUps.find((p) => p.type === 'catnipRush');
    const intensity = catnip ? Math.min(1, catnip.remainingFrac * 4) : 0;
    const quantised = Math.round(clamp01(intensity) * 20) / 20;
    if (quantised === this.hudSpeedLinesIntensity) return;
    this.hudSpeedLinesIntensity = quantised;
    el.style.setProperty('--speedlines-intensity', String(quantised));
  }

  private updateChaseWarning(rawPressure: number): void {
    const pressure = Math.round(clamp01(rawPressure) * 100) / 100;
    const visible = pressure >= 0.35;
    const critical = pressure >= 0.75;
    const el = this.refs.hudChaseWarning;

    if (visible !== this.hudChaseVisible) {
      this.hudChaseVisible = visible;
      if (el) {
        el.hidden = !visible;
        el.setAttribute('aria-hidden', String(!visible));
      }
    }

    if (critical !== this.hudChaseCritical) {
      this.hudChaseCritical = critical;
      el?.classList.toggle('is-critical', critical);
    }

    if (visible && pressure !== this.hudChasePressure) {
      this.hudChasePressure = pressure;
      el?.style.setProperty('--pressure', String(pressure));
    }
  }

  /**
   * The first-time lesson prompt, drawn over a world `Game.updateTutorial`
   * has slowed underneath it.
   *
   * The clothesline's is a bare arrow, no plate and no words - the same
   * treatment `updateTurnWarning` gives a corner, and for the same reason.
   * "Swipe down to slide!" was a sentence to read at the one moment the
   * player has least attention to spare, and the arrow had already said it:
   * down is the whole instruction, and pointing is a faster way to say down
   * than spelling it. The trampoline keeps its line, because "run onto it,
   * don't jump" is a thing an arrow genuinely cannot say.
   *
   * `announce` is what the label would have been, kept for the container's
   * `aria-label` whether or not it is drawn - a screen reader gets no arrow.
   * It is the one string still decided here rather than handed over in the
   * state, because it depends on something only this class knows: whether the
   * player is on a touch screen. "Swipe down" is meaningless on a keyboard
   * and "Press down" is meaningless on a phone.
   *
   * Rewritten only when the prompt actually changes - the cue is up for a
   * couple of seconds at a time, which at 60 fps is a hundred-odd identical
   * writes to two text nodes otherwise.
   */
  private updateTutorialCue(cue: TutorialCue | null): void {
    const el = this.refs.hudTutorialCue;
    if (!el) return;

    const key = cue ? `${cue.lesson}|${cue.steer}` : '';
    if (key === this.hudTutorialCueKey) return;
    this.hudTutorialCueKey = key;

    el.hidden = !cue;
    el.setAttribute('aria-hidden', String(!cue));
    if (!cue) return;

    const touch = this.input.isTouchActive;
    let arrow: string;
    let label: string;
    let announce: string;

    if (cue.lesson === 'duck') {
      arrow = '⬇️';
      label = '';
      announce = touch ? 'Swipe down to slide' : 'Press down to slide';
    } else if (cue.steer !== 0) {
      arrow = cue.steer === -1 ? '⬅️' : '➡️';
      label = 'Line up with the trampoline!';
      announce = label;
    } else {
      arrow = '⬆️';
      label = "Run onto the trampoline - don't jump!";
      announce = label;
    }

    if (this.refs.hudTutorialArrow) this.refs.hudTutorialArrow.textContent = arrow;
    if (this.refs.hudTutorialLabel) {
      this.refs.hudTutorialLabel.textContent = label;
      // Hidden rather than merely empty, so the flex gap above it goes too -
      // an empty plate under the arrow is still a plate's worth of layout.
      this.refs.hudTutorialLabel.hidden = label === '';
    }
    el.setAttribute('aria-label', announce);
  }

  /**
   * The directional arrow that appears shortly before a 90-degree corner:
   * plain ⬅️/➡️ emoji, no plate, no instructional text - the arrow is the
   * whole message. `state.turnDirection` is never 0 while `turnWarning` is
   * true (a warning only fires inside an actual turn zone, which always has
   * a direction - see `Game.updateHud`), so there is no neutral glyph to fall
   * back to.
   *
   * Nothing about the turn *logic* changed: the controller still opens the same
   * window, still accepts the same input and still holds a buffered turn for the
   * corner. This is presentation only.
   *
   * Shape deliberately mirrors {@link updateChaseWarning}: everything is
   * change-detected against a cached key, because this runs on every rendered
   * frame and writing an unchanged class or custom property still costs a
   * style recalculation on the whole subtree.
   */
  private updateTurnWarning(state: HudState): void {
    const el = this.refs.hudTurnWarning;
    if (!el) return;

    const key = `${state.turnWarning}|${state.turnDirection}`;
    if (key !== this.hudTurnKey) {
      this.hudTurnKey = key;
      el.hidden = !state.turnWarning;
      el.setAttribute('aria-hidden', String(!state.turnWarning));
      const arrow = state.turnDirection === -1 ? '⬅️' : '➡️';
      if (this.refs.hudTurnArrow) this.refs.hudTurnArrow.textContent = arrow;
      el.setAttribute(
        'aria-label',
        state.turnDirection === -1 ? 'Corner ahead: turn left' : 'Corner ahead: turn right',
      );
    }

    if (!state.turnWarning) return;

    // Quantised, or a continuously changing float would write a custom property
    // every single frame for no visible difference.
    const proximity = Math.round(clamp01(state.turnProximity) * 20) / 20;
    if (proximity !== this.hudTurnProximity) {
      this.hudTurnProximity = proximity;
      el.style.setProperty('--proximity', String(proximity));
    }
  }

  // ==========================================================================
  // Failure overlay
  // ==========================================================================

  /**
   * Draws the results overlay for a finished run.
   *
   * The numbers come in as a {@link RunSummary} rather than being read off
   * `save` here, because by this point the save no longer holds them: the fish
   * have gone into a running wallet total, and the record has already been
   * overwritten with this run's distance if it beat it. See `Game.fail`.
   */
  showFailure(reason: FailReason, summary: RunSummary): void {
    const messages = FAIL_MESSAGES[reason];
    const message = messages[Math.floor(Math.random() * messages.length)];
    if (this.refs.failTitle) this.refs.failTitle.textContent = FAIL_TITLES[reason];
    if (this.refs.failMessage) this.refs.failMessage.textContent = message ?? '';

    // The headline number carries its own unit in the markup, so only the
    // figure is written here.
    if (this.refs.failDistance) {
      this.refs.failDistance.textContent = Math.max(
        0,
        Math.floor(summary.distance),
      ).toLocaleString('en-US');
    }
    if (this.refs.failFish) this.refs.failFish.textContent = formatFish(summary.fish);
    if (this.refs.failBest) {
      this.refs.failBest.textContent = formatDistance(summary.bestDistance);
    }
    // Shown only when this run is what set the record. A first run sets it by
    // definition, which is the right time to say so - it is also the moment
    // the player learns there is a record at all.
    if (this.refs.failNewBest) this.refs.failNewBest.hidden = !summary.isNewBest;
  }

  // ==========================================================================
  // Debug panel (F2, development builds only)
  // ==========================================================================

  /**
   * The F2 overlay, created the first time it is asked for rather than living
   * in `index.html`.
   *
   * Poki rejects a build with dev or debug code in it, and the callers here
   * are behind `import.meta.env.DEV` (see `Game.bindInput`), so in a
   * production build nothing ever reaches this and the element is never made.
   * It carries its own styling for the same reason: a dev-only widget should
   * not leave rules in the shipped stylesheet.
   */
  private debugPanel: HTMLElement | null = null;

  setDebugVisible(visible: boolean): void {
    if (!visible) {
      this.debugPanel?.remove();
      this.debugPanel = null;
      return;
    }
    if (this.debugPanel) return;

    const panel = document.createElement('div');
    panel.id = 'debug-panel';
    panel.style.cssText = [
      'position:fixed',
      'top:8px',
      'left:8px',
      'z-index:100',
      'max-width:60vw',
      'padding:8px 12px',
      'background:rgba(46,27,18,0.78)',
      'color:#B9F0C6',
      "font:0.72rem/1.5 'SFMono-Regular',Consolas,Menlo,monospace",
      'white-space:pre',
      'border-radius:10px',
      'pointer-events:none',
    ].join(';');
    document.body.appendChild(panel);
    this.debugPanel = panel;
  }

  setDebugText(text: string): void {
    if (this.debugPanel) this.debugPanel.textContent = text;
  }

  // ==========================================================================
  // Cleanup
  // ==========================================================================

  dispose(): void {
    this.unsubscribeState();
    this.unsubscribeSettings();

    this.refs.uiRoot?.removeEventListener('click', this.handleUiRootClick);
    this.refs.uiRoot?.removeEventListener('pointerover', this.handleUiRootPointerOver);
    this.refs.skinGrid?.removeEventListener('click', this.handleSkinGridClick);
    this.refs.hudPause?.removeEventListener('click', this.handleHudPauseClick);
    document.removeEventListener('keydown', this.handleKeyDown);

    for (const cleanup of this.settingsCleanup) cleanup();
    this.settingsCleanup.length = 0;
  }
}
