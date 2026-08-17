/**
 * The curtain call on a new player's first wave.
 *
 * This is the only celebration in the game that is not a payout screen. The
 * wave-clear card exists to price a repair and warn about what is coming next,
 * and both of those are meaningless here: the rig the player just drove is a
 * loaner they are about to hand back (see `firstPlayRig`), and the thing that
 * happens next is not a wave at all, it is the Garage. So this replaces it —
 * three numbers, one sentence, and one button.
 *
 * The showmanship is deliberate and it is the point. A portal player has just
 * spent ninety seconds finding out whether this game is worth their afternoon,
 * and the answer is being delivered right here. So: a rotating ray burst, a
 * shower of sparks thrown from the middle of the card, a title that lands hard
 * enough to shake, and the three stats counting themselves up. Everything is
 * CSS animation over a handful of generated elements — no canvas, no library,
 * and it all folds flat under `prefers-reduced-motion`.
 *
 * `SurvivalMode` owns when it shows and what happens when the button is hit;
 * this owns nothing but the presentation and its own timers.
 */

import './FirstPlayVictory.css';
import { playSfx } from '../app/sfx.ts';

export interface FirstPlayVictoryView {
  /** Zombies killed this wave. */
  kills: number;
  /** Cash the wave paid, already banked. */
  cashEarned: number;
  /** Arena seconds the wave took. */
  elapsedSeconds: number;
}

export interface FirstPlayVictoryHandlers {
  /** The one button: hand the player to the Garage and the rig picker. */
  onStartRun(): void;
}

/** Sparks thrown out of the card when it lands. */
const SPARK_COUNT = 34;
/** How long each stat spends counting up to its value. */
const COUNT_UP_MS = 620;
/**
 * When each beat fires, in milliseconds after `show`. The card has to land
 * before the sparks are thrown from it, and the numbers have to be still for a
 * moment before the button invites a click — a CTA that arrives during the
 * fireworks gets pressed before anything has been read.
 */
const SPARK_DELAY_MS = 170;
const COUNT_DELAY_MS = 420;
const CTA_DELAY_MS = 1150;

interface StatCell {
  readonly root: HTMLDivElement;
  readonly value: HTMLSpanElement;
  /** Turns the counted number into what the cell shows. */
  readonly format: (value: number) => string;
  target: number;
}

export class FirstPlayVictory {
  readonly root: HTMLElement;

  private readonly sparkLayer: HTMLDivElement;
  private readonly stats: StatCell[] = [];
  private readonly cta: HTMLButtonElement;
  private readonly timeouts = new Set<number>();
  private animationFrame = 0;
  private handlers: FirstPlayVictoryHandlers | null;
  private disposed = false;

  constructor(parent: HTMLElement, handlers: FirstPlayVictoryHandlers) {
    this.handlers = handlers;

    this.root = element('section', 'first-play-victory');
    this.root.hidden = true;
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'true');
    this.root.setAttribute('aria-label', 'First wave cleared');

    // Two decorative layers behind the card: a slow rotating ray fan, and a
    // ring of sparks the card throws when it lands.
    const rays = element('div', 'first-play-victory__rays');
    rays.setAttribute('aria-hidden', 'true');
    this.sparkLayer = element('div', 'first-play-victory__sparks');
    this.sparkLayer.setAttribute('aria-hidden', 'true');

    const card = element('article', 'first-play-victory__card');
    const eyebrow = element('div', 'first-play-victory__eyebrow');
    eyebrow.textContent = 'WAVE 01 // SECURED';
    const title = element('h2', 'first-play-victory__title');
    title.textContent = 'Nice Driving';
    const lede = element('p', 'first-play-victory__lede');
    lede.textContent = 'You cleared your first wave.';

    const statRow = element('div', 'first-play-victory__stats');
    this.stats.push(
      this.buildStat(statRow, 'Zombies', formatInteger),
      this.buildStat(statRow, 'Earned', formatMoney),
      this.buildStat(statRow, 'Time', formatDuration),
    );

    const note = element('p', 'first-play-victory__note');
    note.textContent =
      'That rig was a loaner. Pick your own and spend what you just earned on it.';

    this.cta = element('button', 'first-play-victory__cta');
    this.cta.type = 'button';
    this.cta.textContent = 'Start Run';
    this.cta.addEventListener('click', this.onCtaClick);

    card.append(eyebrow, title, lede, statRow, note, this.cta);
    this.root.append(rays, card, this.sparkLayer);
    parent.appendChild(this.root);
  }

  /** True while the celebration owns the screen. */
  get visible(): boolean {
    return !this.disposed && !this.root.hidden;
  }

  show(view: FirstPlayVictoryView): void {
    if (this.disposed) return;
    this.clearTimers();

    this.stats[0].target = Math.max(0, Math.round(view.kills));
    this.stats[1].target = Math.max(0, Math.round(view.cashEarned));
    this.stats[2].target = Math.max(0, view.elapsedSeconds);
    for (const stat of this.stats) stat.value.textContent = stat.format(0);

    this.root.hidden = false;
    // Restart every entrance animation from the top. The class carries all of
    // them, so it has to leave the document's animation list for a frame.
    this.root.classList.remove('is-in');
    void this.root.offsetWidth;
    this.root.classList.add('is-in');
    this.cta.classList.remove('is-in');
    this.cta.disabled = true;

    playSfx('waveClear');
    this.after(SPARK_DELAY_MS, () => {
      this.throwSparks();
      playSfx('badgeStamp');
    });
    this.after(COUNT_DELAY_MS, () => this.startCountUp());
    this.after(CTA_DELAY_MS, () => {
      this.cta.disabled = false;
      this.cta.classList.add('is-in');
      // Focused so Enter works and so a screen reader lands on the only thing
      // there is to do. It cannot be pressed before this: it was disabled.
      this.cta.focus();
    });
  }

  hide(): void {
    this.clearTimers();
    this.root.hidden = true;
    this.root.classList.remove('is-in');
    this.sparkLayer.replaceChildren();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.handlers = null;
    this.clearTimers();
    this.cta.removeEventListener('click', this.onCtaClick);
    this.root.remove();
  }

  private readonly onCtaClick = (): void => {
    if (this.disposed || this.cta.disabled) return;
    // No click cue here: the survival UI layer already plays one for every
    // button in it, and two would fire on the same press.
    //
    // Read before the handler runs, because it disposes this mode — and with
    // it this component — before returning.
    const handlers = this.handlers;
    this.hide();
    handlers?.onStartRun();
  };

  private buildStat(
    parent: HTMLElement,
    label: string,
    format: (value: number) => string,
  ): StatCell {
    const root = element('div', 'first-play-victory__stat');
    const value = element('span', 'first-play-victory__stat-value');
    value.textContent = format(0);
    const caption = element('span', 'first-play-victory__stat-label');
    caption.textContent = label;
    root.append(value, caption);
    parent.appendChild(root);
    return { root, value, format, target: 0 };
  }

  /**
   * Count all three stats up together on one rAF loop.
   *
   * One loop rather than three because they finish together by design: three
   * staggered counters read as a slot machine, and the beat this is going for
   * is a single snap to the final numbers.
   */
  private startCountUp(): void {
    const startedAt = performance.now();
    let lastTickAt = 0;
    const step = (): void => {
      if (this.disposed || this.root.hidden) return;
      const elapsed = performance.now() - startedAt;
      const t = Math.min(1, elapsed / COUNT_UP_MS);
      // Ease out: the numbers sprint and then settle, rather than crawling to
      // the end at a constant rate.
      const eased = 1 - (1 - t) * (1 - t) * (1 - t);
      for (const stat of this.stats) {
        stat.value.textContent = stat.format(stat.target * eased);
      }
      // A tick per 90ms of counting, not per frame: at 60fps the latter is a
      // buzz rather than a sound.
      if (elapsed - lastTickAt > 90 && t < 1) {
        lastTickAt = elapsed;
        playSfx('coinTick', { pitch: 1 + t * 0.5 });
      }
      if (t >= 1) {
        for (const stat of this.stats) {
          stat.value.textContent = stat.format(stat.target);
          stat.root.classList.add('is-landed');
        }
        return;
      }
      this.animationFrame = requestAnimationFrame(step);
    };
    step();
  }

  /**
   * Fling a ring of sparks out of the middle of the card.
   *
   * Direction, distance, size and delay are per-spark custom properties read by
   * one keyframe, so the whole shower is a single animation definition and the
   * elements cost nothing but a style attribute each. Angles are jittered off
   * an even fan rather than fully random, so the ring never leaves a bald patch.
   */
  private throwSparks(): void {
    this.sparkLayer.replaceChildren();
    for (let index = 0; index < SPARK_COUNT; index += 1) {
      const spark = element('span', 'first-play-victory__spark');
      const angle =
        (index / SPARK_COUNT) * 360 +
        (Math.random() - 0.5) * (360 / SPARK_COUNT);
      const distance = 130 + Math.random() * 210;
      spark.style.setProperty('--spark-angle', `${angle.toFixed(1)}deg`);
      spark.style.setProperty('--spark-distance', `${distance.toFixed(0)}px`);
      spark.style.setProperty(
        '--spark-size',
        `${(4 + Math.random() * 6).toFixed(1)}px`,
      );
      spark.style.setProperty(
        '--spark-delay',
        `${Math.round(Math.random() * 160)}ms`,
      );
      spark.style.setProperty(
        '--spark-spin',
        `${Math.round((Math.random() - 0.5) * 540)}deg`,
      );
      // Two thirds signal green, the rest bone, so the shower reads as the
      // game's own colours rather than as generic confetti.
      if (index % 3 === 0) spark.classList.add('is-gold');
      this.sparkLayer.appendChild(spark);
    }
  }

  private after(delayMs: number, run: () => void): void {
    const id = window.setTimeout(() => {
      this.timeouts.delete(id);
      if (!this.disposed) run();
    }, delayMs);
    this.timeouts.add(id);
  }

  private clearTimers(): void {
    for (const id of this.timeouts) window.clearTimeout(id);
    this.timeouts.clear();
    if (this.animationFrame !== 0) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = 0;
    }
  }
}

function formatMoney(value: number): string {
  return `$${Math.max(0, Math.round(value)).toLocaleString()}`;
}

function formatInteger(value: number): string {
  return Math.max(0, Math.round(value)).toLocaleString();
}

function formatDuration(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(whole / 60);
  const remainder = whole % 60;
  return `${minutes}:${String(remainder).padStart(2, '0')}`;
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}
