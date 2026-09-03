import type { Lane } from '../levels/chunkTemplate';

/**
 * The six things a first-time player has not yet worked out.
 *
 * Taught exactly once each, in order, by a single completely hand-authored,
 * non-procedural level (`src/levels/procedural/TutorialLevel.ts`) reachable
 * from the main menu's Tutorial button and auto-launched on the very first
 * ever install - never woven into ordinary endless play, which stays purely
 * procedural and shows none of this:
 *
 *  - **Lane changing.** A single blocked lane, placed at the loosest spacing
 *    the `obstacle` generator has, with a fish trail leading into the open
 *    lane.
 *  - **Jumping.** The horizontal pipe (`'vent'` chunk) - a real, un-dodgeable,
 *    un-duckable collider that only a jump clears.
 *  - **The clothesline.** A wall of hanging sheets three times the cat's
 *    height (see `ChunkTypes.BEAM_TOP`), so the shape reads as "do not touch"
 *    but says nothing about *how*. The instinct a runner arrives with is to
 *    jump, and jumping into it is exactly how it catches you. The answer -
 *    swipe down - is the one input in the game with no other use, so a player
 *    who has never tucked has no reason to guess it exists.
 *  - **The gap.** A plain deck gap, roof height held flat so nothing about it
 *    is ambiguous - a second, distinct jump lesson from the pipe, in a
 *    different shape.
 *  - **The trampoline.** It is the only way up a roof tier, and firing it
 *    still means lining up in (or committing to) the *centre* lane
 *    (`TRAMPOLINE_TRIGGER_RADIUS`, see `RoofFeatures.ts`) - missing it is not
 *    a graze: the deck steps up three units, six times `PHYSICS.maxStepUp`,
 *    and a runner who drifted a lane wide lands against a lip nothing can
 *    climb. The level's trampoline chunk is the only chunk anywhere in it
 *    that changes roof tier, so the higher rooftop genuinely cannot be
 *    reached any other way.
 *  - **Turning.** A forced corner. Committing to it is a single press once
 *    the runner is in the turn zone, same as any other lesson here.
 *
 * A seventh section, the Combined Challenge, restages three of these
 * (lane change, gap, turn) back-to-back with tighter spacing and teaches
 * nothing new - see `TutorialLevel.ts`'s own doc comment for why its cues
 * stay silent even on a failure there.
 *
 * Each lesson is learned once per attempt, the first time its hazard is
 * passed correctly, and never taught again within that attempt - `learned`
 * lives only in memory, one fresh `TutorialDirector` per playthrough (see
 * `Game.startTutorial()`), so a replay from the menu teaches everything
 * again. Failing a lesson's hazard does not spend it: `Game`'s
 * checkpoint respawn puts the runner back before it and this director's own
 * {@link reset} re-arms the cue, so the prompt is simply shown again.
 *
 * Deliberately a pure state machine over a plain snapshot rather than
 * something that reaches into `PlayerController`/`ChunkBuilder` itself. What
 * it does is *timing* - how early to interrupt, when to hand control back -
 * and timing is only cheap to get right if it can be exercised without a
 * physics world or a streamed track behind it.
 *
 * Runs at ordinary game speed throughout - deliberately. An earlier version
 * of this eased time down while a cue was up, on the theory that a first-time
 * player needed the extra beat to read an arrow and react. It doesn't slow
 * anything now: the tutorial is meant to teach the mechanics the game
 * actually runs at, not a gentler version of them, and "normal speed,
 * consistent with Endless Mode" is the whole point of a tutorial that's
 * supposed to prepare a player for it.
 */

export type TutorialLesson = 'laneChange' | 'jump' | 'duck' | 'gap' | 'trampoline' | 'turn';

/** Level order: also the order `learnedLessons()` reports in. */
export const TUTORIAL_LESSONS: readonly TutorialLesson[] = [
  'laneChange',
  'jump',
  'duck',
  'gap',
  'trampoline',
  'turn',
];

export function isTutorialLesson(value: unknown): value is TutorialLesson {
  return (
    value === 'laneChange' ||
    value === 'jump' ||
    value === 'duck' ||
    value === 'gap' ||
    value === 'trampoline' ||
    value === 'turn'
  );
}

/** What the director needs to know about the runner and the track ahead. */
export interface TutorialView {
  /** Arc length along the route, the same units `TrackAhead` speaks. */
  arc: number;
  /** Arc of the next blocked lane, or `Infinity` when none is in scan range. */
  obstacleArc: number;
  /** Which lanes the next obstacle blocks, left-to-right. */
  blocked: readonly [boolean, boolean, boolean];
  /** Arc of the next horizontal pipe (`'vent'` chunk), or `Infinity` when
   *  none is in scan range. */
  jumpArc: number;
  /** Arc of the next deck gap, or `Infinity` when none is. */
  gapArc: number;
  /** Arc of the next clothesline, or `Infinity` when none is in scan range. */
  duckArc: number;
  /** Arc of the next trampoline pad, or `Infinity` when none is. */
  padArc: number;
  /**
   * Arc of the next turn junction, or `Infinity` when none is in range.
   * Synthetic - `Game` derives it from `PlayerController.turnDistance`,
   * which is a live distance rather than a scanned arc, so it is converted
   * to `arc + turnDistance` at the call site to keep every lesson here
   * arc-based.
   */
  turnArc: number;
  /** Which way the upcoming turn goes, 0 when none is pending. */
  turnDir: -1 | 0 | 1;
  lane: Lane;
  /** True on the frame the player asked to tuck. */
  ducked: boolean;
  /** True on the frame the player changed lanes. */
  laneChanged: boolean;
  /** True on the frame the player jumped. */
  jumped: boolean;
  /**
   * True once the player has committed to the upcoming turn. A state, not an
   * edge - unlike a duck or a jump, committing to a turn is not one frame's
   * input, so this rides latched (`PlayerController.turnBuffered`) rather
   * than being read at the instant of a press.
   */
  turned: boolean;
  /**
   * True while a lesson must not run at all - a power-up is driving, the run
   * is over, anything where interrupting would be worse than not teaching. A
   * prompt already up is dropped rather than paused.
   */
  suspended: boolean;
}

/** The prompt on screen, or `null`. Rendered by `UIManager.updateTutorialCue`. */
export interface TutorialCue {
  lesson: TutorialLesson;
  /**
   * Which way the player still has to move to line up, 0 once they are.
   * Non-zero for `laneChange`, `trampoline`, and `turn`; always 0 for `duck`,
   * `jump`, and `gap`, which have nothing to line up with - a clothesline
   * and a pipe span every lane, and a gap doesn't move.
   */
  steer: -1 | 0 | 1;
}

/**
 * How far ahead of the hazard each lesson starts, in arc units.
 *
 * Far enough that the prompt is up while the hazard is still a reaction
 * rather than a surprise, and close enough that it is unambiguous which thing
 * on screen the arrow is about.
 *
 * The lessons are not all the same length of thought. `trampoline` and `turn`
 * ask the player to *get somewhere* - notice the pad or the corner, work out
 * which side of it they are on, commit to a lane or a heading - so they need
 * the room to do that in. `laneChange`, `jump`, `duck`, and `gap` ask for one
 * press, and the press is available on the first frame the arrow is up;
 * every unit of lead past that is a player who has already understood the
 * prompt watching it hang there.
 */
const LESSON_LEAD: Readonly<Record<TutorialLesson, number>> = {
  laneChange: 14,
  jump: 14,
  duck: 14,
  gap: 14,
  trampoline: 26,
  turn: 24,
};

export class TutorialDirector {
  private readonly learned = new Set<TutorialLesson>();

  private active: TutorialLesson | null = null;
  /** Arc of the hazard the live prompt is about. */
  private hazardArc = Infinity;

  private currentCue: TutorialCue | null = null;
  /** Set by {@link learn} for the duration of one {@link update}. */
  private taught: TutorialLesson | null = null;

  constructor(learned: Iterable<TutorialLesson> = []) {
    for (const lesson of learned) {
      if (isTutorialLesson(lesson)) this.learned.add(lesson);
    }
  }

  /** Nothing left to teach - the caller can stop scanning the track for it. */
  get finished(): boolean {
    return this.learned.size >= TUTORIAL_LESSONS.length;
  }

  /** The prompt to draw this frame, or `null`. */
  get cue(): TutorialCue | null {
    return this.currentCue;
  }

  /** For the save file. Order is stable, so a rewrite isn't a spurious diff. */
  learnedLessons(): TutorialLesson[] {
    return TUTORIAL_LESSONS.filter((lesson) => this.learned.has(lesson));
  }

  /**
   * Drops any prompt in flight, keeping what has been learned. Called
   * between runs: a lesson interrupted by a death is still un-taught and
   * must be free to fire again next run.
   */
  reset(): void {
    this.active = null;
    this.currentCue = null;
    this.hazardArc = Infinity;
  }

  /**
   * One frame.
   *
   * Returns the lesson learned on this frame, so the caller knows when - and
   * only when - the save file needs writing.
   */
  update(view: TutorialView): TutorialLesson | null {
    this.taught = null;

    if (view.suspended) {
      this.active = null;
    } else if (this.active) {
      this.advance(view);
    } else {
      this.tryStart(view);
    }

    this.currentCue = this.active
      ? { lesson: this.active, steer: steerFor(this.active, view) }
      : null;

    return this.taught;
  }

  /** Banks a lesson. Idempotent within a prompt. */
  private learn(lesson: TutorialLesson): void {
    if (this.learned.has(lesson)) return;
    this.learned.add(lesson);
    this.taught = lesson;
  }

  /** Picks up the nearer of the owed hazards. */
  private tryStart(view: TutorialView): void {
    const candidates: readonly (readonly [TutorialLesson, number])[] = [
      ['laneChange', view.obstacleArc],
      ['jump', view.jumpArc],
      ['duck', view.duckArc],
      ['gap', view.gapArc],
      ['trampoline', view.padArc],
      ['turn', view.turnArc],
    ];

    let best: TutorialLesson | null = null;
    let bestArc = Infinity;
    for (const [lesson, arc] of candidates) {
      if (this.learned.has(lesson)) continue;
      const distance = arc - view.arc;
      if (distance < 0 || distance > LESSON_LEAD[lesson]) continue;
      if (arc >= bestArc) continue;
      best = lesson;
      bestArc = arc;
    }
    if (!best) return;

    this.active = best;
    this.hazardArc = bestArc;
  }

  private advance(view: TutorialView): void {
    if (view.arc <= this.hazardArc) {
      // Success ends the prompt outright - the arrow has been read and acted
      // on, and the cat's own move (duck, lane change, jump, commit to the
      // turn) is the acknowledgement.
      const succeeded =
        (this.active === 'duck' && view.ducked) ||
        (this.active === 'laneChange' && view.laneChanged) ||
        ((this.active === 'jump' || this.active === 'gap') && view.jumped) ||
        (this.active === 'turn' && view.turned);
      if (succeeded && this.active) {
        this.learn(this.active);
        this.active = null;
      }
      return;
    }

    // Past the hazard the lesson is over either way. A trampoline crossed is a
    // trampoline understood - the correct action was to keep running, and they
    // did. Everything else here is a single press: reaching the hazard
    // without having made it is not success, they walked into it, and (after
    // `Game.respawnAtTutorialCheckpoint()` puts them back before it) the same
    // hazard deserves the same prompt.
    if (this.active === 'trampoline') this.learn('trampoline');
    this.active = null;
  }
}

/**
 * Which way the player still has to move to line up with the hazard.
 *
 * `trampoline` points at the centre lane: `TRAMPOLINE_TRIGGER_RADIUS` (1.4)
 * is smaller than `PHYSICS.laneSpacing` (2.4), so a pad approached from an
 * outer lane is simply missed - silently, along with the tier change it was
 * carrying. `laneChange` points away from whichever lane the upcoming
 * obstacle blocks. `turn` points the way the upcoming corner goes. Every
 * other lesson has nowhere in particular to be, so it never steers.
 */
function steerFor(lesson: TutorialLesson, view: TutorialView): -1 | 0 | 1 {
  if (lesson === 'trampoline') {
    if (view.lane === 0) return 0;
    return view.lane > 0 ? -1 : 1;
  }
  if (lesson === 'laneChange') return laneChangeSteer(view);
  if (lesson === 'turn') return view.turnDir;
  return 0;
}

/** Steers off the current lane, toward whichever neighbour is still open. */
function laneChangeSteer(view: TutorialView): -1 | 0 | 1 {
  if (!view.blocked[view.lane + 1]) return 0;
  const left = view.lane - 1;
  if (left >= -1 && !view.blocked[left + 1]) return -1;
  const right = view.lane + 1;
  if (right <= 1 && !view.blocked[right + 1]) return 1;
  return 0;
}
