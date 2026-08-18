/**
 * The coach strip a new player reads while they are driving.
 *
 * Presentation and timing for `core/firstPlay.ts`. It owns one thin banner and
 * nothing else: no scrim, no arrow, no dimming, and — deliberately — no time
 * stop. This used to freeze the fixed step under every card, which read well on
 * paper and badly in the hand: the first thing the game ever did was take the
 * controls away, four times, in the opening half minute. A prompt the player
 * can ignore and drive through teaches the same thing without ever telling them
 * to stop playing.
 *
 * Everything it does is therefore on the arena clock and out of the way. The
 * banner sits along the top edge, where the wave strip will eventually live and
 * where nothing is happening yet, so the road and the crowd are never behind
 * it. It is never interactive — every step is dismissed by playing, so there is
 * no button to mis-click and nothing here steals the pointer the player is
 * aiming with.
 *
 * `SurvivalMode` drives it: `fixedUpdate` on the arena clock, and `notifyInput`
 * from the same handlers that feed the vehicle.
 */

import './FirstPlayCoach.css';
import {
  FIRST_PLAY_ABILITY_KEY_TOKEN,
  FIRST_PLAY_STEPS,
  releasesStep,
  type FirstPlayInput,
  type FirstPlayStep,
} from '../core/firstPlay.ts';
import { playSfx } from '../app/sfx.ts';
import { shouldUseTouchControls } from '../ui/device.ts';

/**
 * Arena seconds a fresh card ignores input for.
 *
 * The player's hand is still on the key from the last beat: without this the
 * press that ended one lesson also ends the next, and neither is read. Short,
 * because the world is running now — a card that hangs around after the player
 * has already done the thing is the noise this whole file is trying not to be.
 */
const INPUT_LOCKOUT_SECONDS = 0.35;

/**
 * The same window for an input that was *already* being held when the card
 * opened.
 *
 * A card that only ever listens for a fresh press can be waited out forever by
 * a player who simply never lets go of W — which is most of them, since the
 * previous lesson was "hold W". So a continuing input counts too, just after
 * long enough for the line to have been read rather than blinked past.
 */
const HELD_LOCKOUT_SECONDS = 1.2;

/**
 * How long one card is allowed to sit there before it gives up and moves on.
 *
 * Nothing is blocked while it waits, so an ignored card costs the player only
 * the strip it occupies — but a prompt that never leaves stops being a prompt.
 * Long enough that somebody reading it slowly is not cut off.
 */
const MAX_PROMPT_SECONDS = 10;

export interface FirstPlayCoachHandlers {
  /**
   * A step opened, was dismissed, or the lesson finished. `SurvivalMode`
   * re-syncs the whole HUD rather than being told which piece moved, so the
   * two can never disagree about what is on screen.
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
  /** True while a card is up and listening. */
  private showing = false;
  private finished = false;
  /** Arena seconds until the next card opens; only counts while none is up. */
  private restSeconds = 0;
  /** Arena seconds the card on screen has been up for. */
  private shownSeconds = 0;
  private abilityKey = '';

  constructor(
    parent: HTMLElement,
    private readonly handlers: FirstPlayCoachHandlers,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'first-play';
    this.root.hidden = true;
    // Purely a read-out: it never takes the pointer the player aims with.
    this.root.setAttribute('aria-live', 'polite');

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
    if (this.showing) this.paint();
  }

  /** Open the first card. Called once, when the first wave actually starts. */
  begin(): void {
    if (this.index >= 0 || this.finished) return;
    this.index = 0;
    this.openStep();
  }

  /** True while a card is up, so held inputs are worth polling. */
  isPrompting(): boolean {
    return this.showing;
  }

  /** True from `begin` until the last card is dismissed. */
  get active(): boolean {
    return this.index >= 0 && !this.finished;
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
    if (!this.showing) return false;
    const step = this.step();
    if (step === undefined) return false;
    const lockout = held ? HELD_LOCKOUT_SECONDS : INPUT_LOCKOUT_SECONDS;
    if (this.shownSeconds < lockout) return false;
    if (!releasesStep(step, input)) return false;
    this.release(step);
    return true;
  }

  /** Arena clock. Runs every step of the wave; nothing here stops the world. */
  fixedUpdate(dt: number): void {
    if (this.finished || this.index < 0) return;
    const step = Math.max(0, dt);
    if (this.showing) {
      this.shownSeconds += step;
      // Ignored for long enough that it has stopped being read. Move on rather
      // than leave a line of text parked over the fight.
      if (this.shownSeconds >= MAX_PROMPT_SECONDS) this.release(this.step());
      return;
    }
    this.restSeconds -= step;
    if (this.restSeconds > 0) return;
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
    this.showing = false;
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
    this.showing = true;
    this.shownSeconds = 0;
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

  private release(step: FirstPlayStep | undefined): void {
    this.showing = false;
    this.root.hidden = true;
    this.card.classList.remove('is-in');
    if (this.index >= FIRST_PLAY_STEPS.length - 1) {
      this.finish();
      return;
    }
    this.restSeconds = step?.runSeconds ?? 0;
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
