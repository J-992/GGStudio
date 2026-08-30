import type { Lane } from '../levels/chunkTemplate';

/**
 * The two things nobody works out on their own.
 *
 * Everything else this game asks for is discoverable by being wrong once: run
 * into a crate and you learn to change lanes, run off a roof and you learn to
 * jump. Two are not, and both fail the same way - the player does not get a
 * second look at them.
 *
 *  - **The clothesline.** It is a wall of hanging sheets three times the cat's
 *    height (see `ChunkTypes.BEAM_TOP`), so the shape reads as "do not touch"
 *    but says nothing about *how*. The instinct a runner arrives with is to
 *    jump, and jumping into it is exactly how it catches you. The answer -
 *    swipe down - is the one input in the game with no other use, so a player
 *    who has never tucked has no reason to guess it exists.
 *  - **The trampoline.** It is the only way up a roof tier, it fires only for
 *    a runner who is *grounded* and in the *centre* lane
 *    (`TRAMPOLINE_TRIGGER_RADIUS` is 1.4 against a `laneSpacing` of 2.4), and
 *    missing it is not a graze: the deck steps up three units, six times
 *    `PHYSICS.maxStepUp`, and a runner who jumped over the pad or drifted a
 *    lane wide lands against a lip nothing can climb.
 *
 * So each gets exactly one lesson, the first time the track deals one, and
 * then never again - {@link TutorialDirector.learnedLessons} is what the save
 * file keeps.
 *
 * Deliberately a pure state machine over a plain snapshot rather than
 * something that reaches into `PlayerController`/`ChunkBuilder` itself. What
 * it does is *timing* - how early to interrupt, how far to slow down, when to
 * hand control back - and timing is only cheap to get right if it can be
 * exercised without a physics world or a streamed track behind it.
 */

export type TutorialLesson = 'duck' | 'trampoline';

export const TUTORIAL_LESSONS: readonly TutorialLesson[] = ['duck', 'trampoline'];

export function isTutorialLesson(value: unknown): value is TutorialLesson {
  return value === 'duck' || value === 'trampoline';
}

/** What the director needs to know about the runner and the track ahead. */
export interface TutorialView {
  /** Arc length along the route, the same units `TrackAhead` speaks. */
  arc: number;
  /** Arc of the next clothesline, or `Infinity` when none is in scan range. */
  duckArc: number;
  /** Arc of the next trampoline pad, or `Infinity` when none is. */
  padArc: number;
  lane: Lane;
  /** True on the frame the player asked to tuck. */
  ducked: boolean;
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
   * Only ever non-zero for `trampoline` - a clothesline spans every lane.
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
 * The two are not the same number because the two lessons are not the same
 * length of thought. The trampoline's asks the player to *get somewhere* -
 * notice the pad, notice which side of it they are on, change lane - so it
 * needs the room to do that in. The clothesline's asks for one press, and
 * the press is available on the first frame the arrow is up; every unit of
 * lead past that is a player who has already understood the prompt watching
 * it hang there. At 26 units and a third speed the duck arrow was up for the
 * better part of six seconds, which is where "it stays for way too long"
 * came from - so it is a little over half that now, and (with
 * {@link MAX_SLOW_SECONDS}) about two and a half seconds on screen.
 */
const LESSON_LEAD: Readonly<Record<TutorialLesson, number>> = {
  duck: 14,
  trampoline: 26,
};

/**
 * How far time is slowed while a lesson is up.
 *
 * The clothesline gets the harder stop of the two because its lesson is a
 * *press*: the player has to notice an arrow, work out what it means and then
 * do something they have never done, and at full speed the hazard arrives
 * during step two. The trampoline only has to be understood - the correct
 * action is to keep running - so it is eased rather than halted.
 */
const SLOW_SCALE: Readonly<Record<TutorialLesson, number>> = {
  duck: 0.3,
  trampoline: 0.5,
};

/**
 * Longest the world may stay slowed, in real seconds.
 *
 * A player who never works out the input still has to reach the hazard;
 * without this, the slowdown would stretch the walk to it into a
 * fifteen-second crawl, which teaches nothing and reads as the game having
 * hung. Time comes back at the cap, the cue stays up, and the hazard arrives
 * at full speed like any other.
 *
 * The clothesline's is the shorter of the two for the same reason its
 * {@link LESSON_LEAD} is: it is a single press, and a slowdown outlasting the
 * moment the player worked that out is just the game running slowly. The
 * trampoline's lesson is "keep doing what you are doing while you line up,"
 * which takes as long as the lining up does.
 */
const MAX_SLOW_SECONDS: Readonly<Record<TutorialLesson, number>> = {
  duck: 2,
  trampoline: 4,
};

/** How fast the time scale eases between 1 and its target, per second. */
const TIME_SCALE_RATE = 7;

/** Below this the eased scale is snapped, so it can't settle at 0.997 forever. */
const TIME_SCALE_EPSILON = 0.005;

export class TutorialDirector {
  private readonly learned = new Set<TutorialLesson>();

  private active: TutorialLesson | null = null;
  /** Arc of the hazard the live prompt is about. */
  private hazardArc = Infinity;
  /** Real seconds the live prompt has been up. */
  private promptTime = 0;
  /** True once the player has done the thing, while the cue rides out. */
  private satisfied = false;

  private scale = 1;
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

  /** What to multiply the simulation's delta by this frame. */
  get timeScale(): number {
    return this.scale;
  }

  /** For the save file. Order is stable, so a rewrite isn't a spurious diff. */
  learnedLessons(): TutorialLesson[] {
    return TUTORIAL_LESSONS.filter((lesson) => this.learned.has(lesson));
  }

  /**
   * Drops any prompt in flight and restores full speed, keeping what has been
   * learned. Called between runs: a lesson interrupted by a death is still
   * un-taught and must be free to fire again next run - but the time scale it
   * was holding must not survive into that run's first frame.
   */
  reset(): void {
    this.active = null;
    this.currentCue = null;
    this.hazardArc = Infinity;
    this.promptTime = 0;
    this.satisfied = false;
    this.scale = 1;
  }

  /**
   * One frame. `dt` is *real* time - the slowdown must not slow its own
   * timeout, or {@link MAX_SLOW_SECONDS} would scale with the thing it caps.
   *
   * Returns the lesson learned on this frame, so the caller knows when - and
   * only when - the save file needs writing.
   */
  update(dt: number, view: TutorialView): TutorialLesson | null {
    this.taught = null;

    if (view.suspended) {
      this.active = null;
      this.satisfied = false;
    } else if (this.active) {
      this.advance(dt, view);
    } else {
      this.tryStart(view);
    }

    this.currentCue = this.active
      ? { lesson: this.active, steer: steerFor(this.active, view) }
      : null;

    // The cue stays up for as long as the player still has something to do
    // about it, and not one frame longer. It used to ride out the rest of the
    // approach after a successful input "so the player sees what their input
    // did" - which they do, because the cat tucks; what the arrow adds after
    // that is an instruction to do a thing already done, sitting over the
    // hazard it was pointing at. {@link advance} drops it on success instead.
    const target =
      this.active && !this.satisfied && this.promptTime < MAX_SLOW_SECONDS[this.active]
        ? SLOW_SCALE[this.active]
        : 1;
    this.scale += (target - this.scale) * (1 - Math.exp(-TIME_SCALE_RATE * dt));
    if (Math.abs(this.scale - target) < TIME_SCALE_EPSILON) this.scale = target;

    return this.taught;
  }

  /** Banks a lesson and lets the slowdown go. Idempotent within a prompt. */
  private learn(lesson: TutorialLesson): void {
    this.satisfied = true;
    if (this.learned.has(lesson)) return;
    this.learned.add(lesson);
    this.taught = lesson;
  }

  /** Picks up the nearer of the two hazards, if its lesson is still owed. */
  private tryStart(view: TutorialView): void {
    const candidates: readonly (readonly [TutorialLesson, number])[] = [
      ['duck', view.duckArc],
      ['trampoline', view.padArc],
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
    this.promptTime = 0;
    this.satisfied = false;
  }

  private advance(dt: number, view: TutorialView): void {
    this.promptTime += dt;

    if (view.arc <= this.hazardArc) {
      // Success ends the prompt outright - the arrow has been read and acted
      // on, and the cat tucking is the acknowledgement. The time scale is
      // eased rather than snapped (see {@link update}), so the world still
      // comes back up to speed smoothly with the arrow already gone.
      if (this.active === 'duck' && view.ducked) {
        this.learn('duck');
        this.active = null;
      }
      return;
    }

    // Past the hazard the lesson is over either way. A trampoline crossed is a
    // trampoline understood - the correct action was to keep running, and they
    // did. A clothesline reached without a tuck is not: they walked into it,
    // and the next one deserves the same prompt.
    if (this.active === 'trampoline') this.learn('trampoline');
    this.active = null;
    this.satisfied = false;
  }
}

/**
 * Which way the player still has to move to line up with the hazard.
 *
 * Only the trampoline has a lane to be in. `TRAMPOLINE_TRIGGER_RADIUS` (1.4)
 * is smaller than `PHYSICS.laneSpacing` (2.4), so a pad approached from an
 * outer lane is simply missed - silently, along with the tier change it was
 * carrying.
 */
function steerFor(lesson: TutorialLesson, view: TutorialView): -1 | 0 | 1 {
  if (lesson !== 'trampoline' || view.lane === 0) return 0;
  return view.lane > 0 ? -1 : 1;
}
