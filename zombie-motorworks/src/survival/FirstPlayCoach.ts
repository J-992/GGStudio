/**
 * The card that stops time over a new player's first wave.
 *
 * Presentation and timing for `core/firstPlay.ts`. It owns one small card and
 * nothing else: no scrim, no arrow, no dimming. The freeze is the emphasis —
 * a stopped arena with one line of text on it does not need the screen darkened
 * as well, and the player has to be able to see the crowd they are about to be
 * asked to drive at.
 *
 * `SurvivalMode` drives it: `fixedUpdate` on the arena clock while the world is
 * running, `notifyInput` from the same handlers that feed the vehicle, and
 * `isFrozen` gates the physics step. The card itself is never interactive —
 * every step is dismissed by playing, so there is no button to mis-click and
 * nothing here steals the pointer the player is aiming with.
 */

import './FirstPlayCoach.css';
import {
  FIRST_PLAY_ABILITY_KEY_TOKEN,
  FIRST_PLAY_STEPS,
  firstPlayRevealed,
  releasesStep,
  type FirstPlayInput,
  type FirstPlayReveal,
  type FirstPlayStep,
} from '../core/firstPlay.ts';
import { playSfx } from '../app/sfx.ts';
import { shouldUseTouchControls } from '../ui/device.ts';

/**
 * Wall-clock milliseconds a fresh card ignores input for.
 *
 * The world is stopped, so this cannot be counted in arena time. It exists
 * because the player's hand is still on the key from the last beat: without it
 * the press that ended one lesson also ends the next, and neither is read.
 */
const INPUT_LOCKOUT_MS = 320;

/**
 * The same window for an input that was *already* being held when the card
 * opened.
 *
 * A card that only ever listens for a fresh press can be waited out forever by
 * a player who simply never lets go of W — which is most of them, since the
 * previous lesson was "hold W". So a continuing input counts too, just after
 * long enough for the line to have been read rather than blinked past.
 */
const HELD_LOCKOUT_MS = 1400;

export interface FirstPlayCoachHandlers {
  /**
   * A step opened, was dismissed, or the lesson finished. `SurvivalMode`
   * re-reads `isRevealed` and re-syncs the HUD rather than being told which
   * piece moved, so the two can never disagree about what is on screen.
   */
  onChanged(): void;
}

export class FirstPlayCoach {
  readonly root: HTMLElement;

  private readonly card: HTMLElement;
  private readonly titleValue: HTMLElement;
  private readonly textValue: HTMLElement;
  private readonly hintValue: HTMLElement;

  /** -1 until `begin`, then the step on screen or waiting to open. */
  private index = -1;
  private frozen = false;
  private finished = false;
  private runSeconds = 0;
  private openedAtMs = 0;
  private abilityKey = '';

  constructor(
    parent: HTMLElement,
    private readonly handlers: FirstPlayCoachHandlers,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'first-play';
    this.root.hidden = true;
    // Purely a read-out: it never takes the pointer the player aims with.
    this.root.setAttribute('aria-live', 'assertive');

    this.card = document.createElement('section');
    this.card.className = 'first-play__card';
    this.titleValue = document.createElement('strong');
    this.titleValue.className = 'first-play__title';
    this.textValue = document.createElement('p');
    this.textValue.className = 'first-play__text';
    this.hintValue = document.createElement('span');
    this.hintValue.className = 'first-play__hint';
    this.card.append(this.titleValue, this.textValue, this.hintValue);
    this.root.appendChild(this.card);
    parent.appendChild(this.root);
  }

  /**
   * Which ability box the Shield Bubble ended up in, so the card can quote a
   * key that is actually bound. Safe to call every frame; only a change repaints.
   */
  setAbilityKey(key: string): void {
    const next = key.trim().toUpperCase();
    if (next === this.abilityKey) return;
    this.abilityKey = next;
    if (this.frozen) this.paint();
  }

  /** Open the first card. Called once, when the first wave actually starts. */
  begin(): void {
    if (this.index >= 0 || this.finished) return;
    this.index = 0;
    this.openStep();
  }

  /** True while the world must not step. */
  isFrozen(): boolean {
    return this.frozen;
  }

  /** True from `begin` until the last card is dismissed. */
  get active(): boolean {
    return this.index >= 0 && !this.finished;
  }

  /** Has the lesson uncovered this piece of HUD yet? */
  isRevealed(reveal: FirstPlayReveal): boolean {
    if (this.finished) return true;
    return firstPlayRevealed(this.index, reveal);
  }

  /** True while the card on screen is the one introducing `reveal`. */
  isSpotlighting(reveal: FirstPlayReveal): boolean {
    return this.frozen && this.step()?.reveals === reveal;
  }

  /**
   * Report an input. Returns true when it was spent dismissing a card, which
   * is only informational — the input is deliberately *not* swallowed, so the
   * press that ends the driving lesson is also the press that drives.
   *
   * `held` marks an input that is merely still down rather than freshly
   * pressed; it waits out the longer window above.
   */
  notifyInput(input: FirstPlayInput, held = false): boolean {
    if (!this.frozen) return false;
    const step = this.step();
    if (step === undefined) return false;
    const lockout = held ? HELD_LOCKOUT_MS : INPUT_LOCKOUT_MS;
    if (performance.now() - this.openedAtMs < lockout) return false;
    if (!releasesStep(step, input)) return false;
    this.release(step);
    return true;
  }

  /** Arena clock. Only runs between cards; a frozen coach is not stepping. */
  fixedUpdate(dt: number): void {
    if (this.frozen || this.finished || this.index < 0) return;
    this.runSeconds -= Math.max(0, dt);
    if (this.runSeconds > 0) return;
    this.index += 1;
    if (this.index >= FIRST_PLAY_STEPS.length) {
      this.finish();
      return;
    }
    this.openStep();
  }

  /** Abandon the lesson wherever it is: the wave ended, or the rig died. */
  finish(): void {
    if (this.finished) return;
    this.finished = true;
    this.frozen = false;
    this.root.hidden = true;
    this.card.classList.remove('is-in');
    this.handlers.onChanged();
  }

  dispose(): void {
    this.root.remove();
  }

  private step(): FirstPlayStep | undefined {
    return this.index < 0 ? undefined : FIRST_PLAY_STEPS[this.index];
  }

  private openStep(): void {
    this.frozen = true;
    this.openedAtMs = performance.now();
    this.root.hidden = false;
    this.paint();
    // Restart the entrance animation: two cards in quick succession would
    // otherwise leave the second one silently already-arrived.
    this.card.classList.remove('is-in');
    void this.card.offsetWidth;
    this.card.classList.add('is-in');
    playSfx('cardIn');
    this.handlers.onChanged();
  }

  private release(step: FirstPlayStep): void {
    this.frozen = false;
    this.root.hidden = true;
    this.card.classList.remove('is-in');
    if (this.index >= FIRST_PLAY_STEPS.length - 1) {
      this.finish();
      return;
    }
    this.runSeconds = step.runSeconds;
    this.handlers.onChanged();
  }

  private paint(): void {
    const step = this.step();
    if (step === undefined) return;
    const touch = shouldUseTouchControls();
    // Falls back to the card's own wording rather than printing the token: an
    // ability box that somehow ended up unbound should read as a missing key,
    // not as "%KEY%".
    const key = this.abilityKey === '' ? 'the shield key' : this.abilityKey;
    const fill = (copy: string): string =>
      copy.split(FIRST_PLAY_ABILITY_KEY_TOKEN).join(key);
    this.titleValue.textContent = step.title;
    this.textValue.textContent = fill(touch ? step.touchText : step.text);
    this.hintValue.textContent = fill(touch ? step.touchHint : step.hint);
    this.card.dataset.step = step.id;
  }
}
