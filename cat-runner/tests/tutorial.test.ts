import { describe, expect, it } from 'vitest';
import { TutorialDirector, type TutorialView } from '../src/game/Tutorial';
import { SaveManager, type StorageAdapter } from '../src/game/SaveManager';

/**
 * The first-time lessons.
 *
 * Two things are being pinned here, and they pull against each other. One is
 * that the lesson actually interrupts: the world has to slow down far enough,
 * early enough, that a player who has never tucked can read an arrow and act
 * on it before a wall of laundry arrives. The other is that it can never
 * become the game: it lets go the instant the input lands, it lets go on a
 * timer if the input never comes, and it never fires twice.
 *
 * The cases worth writing down are the ones where those two disagree.
 */

const FRAME = 1 / 60;

function view(overrides: Partial<TutorialView> = {}): TutorialView {
  return {
    arc: 100,
    duckArc: Infinity,
    padArc: Infinity,
    lane: 0,
    ducked: false,
    suspended: false,
    ...overrides,
  };
}

/** Runs `seconds` of frames, letting the caller mutate the view each frame. */
function run(
  director: TutorialDirector,
  seconds: number,
  each: (frame: number) => TutorialView,
): void {
  const frames = Math.round(seconds / FRAME);
  for (let i = 0; i < frames; i++) director.update(FRAME, each(i));
}

/**
 * Settles the eased time scale on a steady view, so it can be asserted on.
 *
 * One second, not two: `TIME_SCALE_RATE` is 7, so a second is seven time
 * constants and the scale has long since snapped to its target - and the
 * clothesline's slowdown now only lasts two, so a two-second settle would
 * measure the cap rather than the lesson.
 */
function settle(director: TutorialDirector, v: TutorialView): void {
  for (let i = 0; i < 60; i++) director.update(FRAME, v);
}

describe('first-run tutorial', () => {
  it('says nothing on empty track', () => {
    const director = new TutorialDirector();
    settle(director, view());
    expect(director.cue).toBeNull();
    expect(director.timeScale).toBe(1);
  });

  it('waits until the clothesline is close before interrupting', () => {
    const director = new TutorialDirector();
    director.update(FRAME, view({ duckArc: 200 }));
    expect(director.cue).toBeNull();
    expect(director.timeScale).toBe(1);
  });

  it('slows the world right down and shows the duck arrow', () => {
    const director = new TutorialDirector();
    const approach = view({ duckArc: 110 });
    settle(director, approach);

    expect(director.cue).toEqual({ lesson: 'duck', steer: 0 });
    expect(director.timeScale).toBeLessThan(0.5);
  });

  /**
   * Both halves of "it stays for way too long": the arrow goes the frame the
   * swipe lands rather than riding out the approach, and the world comes back
   * up to speed with it.
   */
  it('takes the arrow away the moment the player swipes, and resumes full speed', () => {
    const director = new TutorialDirector();
    settle(director, view({ duckArc: 110 }));
    expect(director.timeScale).toBeLessThan(0.5);

    // The press itself, then the ease back up.
    director.update(FRAME, view({ duckArc: 110, ducked: true }));
    expect(director.cue).toBeNull();

    settle(director, view({ duckArc: 110 }));
    expect(director.timeScale).toBe(1);
    expect(director.cue).toBeNull();
  });

  /**
   * And the other half of "too long" - how long it is up for a player who
   * does nothing at all. The clothesline's prompt starts 14 units out and
   * slows time for at most two seconds, so the whole approach is a couple of
   * seconds of arrow rather than the six it used to be.
   */
  it('holds the clothesline prompt for a couple of seconds, not six', () => {
    const director = new TutorialDirector();
    let real = 0;
    let arc = 96; // the full 14-unit lead short of the clothesline
    const frames = Math.round(6 / FRAME);
    let visible = 0;

    for (let i = 0; i < frames; i++) {
      director.update(FRAME, view({ arc, duckArc: 110 }));
      if (director.cue) visible += FRAME;
      // The world moves at whatever the director slowed it to.
      arc += 11 * FRAME * director.timeScale;
      real += FRAME;
    }

    expect(real).toBeCloseTo(6, 5);
    expect(visible, `the duck arrow was up for ${visible.toFixed(2)}s`).toBeLessThan(3.2);
    expect(visible).toBeGreaterThan(1.5); // still long enough to read and act on
  });

  it('banks the lesson on the swipe, and never teaches it again', () => {
    const director = new TutorialDirector();
    settle(director, view({ duckArc: 110 }));
    const taught = director.update(FRAME, view({ duckArc: 110, ducked: true }));
    expect(taught).toBe('duck');
    expect(director.learnedLessons()).toEqual(['duck']);

    // A second swipe after the prompt has gone is not a second lesson.
    expect(director.update(FRAME, view({ duckArc: 110, ducked: true }))).toBeNull();

    // Nor is the next clothesline, in this run or any other.
    director.reset();
    settle(director, view({ arc: 300, duckArc: 310 }));
    expect(director.cue).toBeNull();
    expect(director.timeScale).toBe(1);
  });

  /**
   * The failure this guards is the one that reads as a hang: a player who
   * never works out the input still has to *reach* the clothesline, and at
   * a third speed that walk is fifteen seconds of nothing.
   */
  it('gives time back on a timer even if the swipe never comes', () => {
    const director = new TutorialDirector();
    run(director, 8, () => view({ duckArc: 110 }));

    expect(director.timeScale).toBe(1);
    expect(director.cue).not.toBeNull(); // the arrow stays up; only time returns
  });

  /**
   * The two lessons are deliberately not the same length. The clothesline is
   * one press and lets go quickly; the trampoline is a lane change and needs
   * the room to make it in.
   */
  it('lets the clothesline go sooner than the trampoline', () => {
    const duck = new TutorialDirector();
    const pad = new TutorialDirector();
    run(duck, 3, () => view({ duckArc: 110 }));
    run(pad, 3, () => view({ padArc: 120 }));

    expect(duck.timeScale).toBe(1); // capped at 2s
    expect(pad.timeScale).toBeLessThan(1); // still has 4s to spend
  });

  it('starts the clothesline lesson closer in than the trampoline one', () => {
    const duck = new TutorialDirector();
    duck.update(FRAME, view({ arc: 100, duckArc: 120 })); // 20 units out
    expect(duck.cue).toBeNull();

    const pad = new TutorialDirector();
    pad.update(FRAME, view({ arc: 100, padArc: 120 }));
    expect(pad.cue).not.toBeNull();
  });

  it('teaches the clothesline again if the player walked into it', () => {
    const director = new TutorialDirector();
    settle(director, view({ duckArc: 110 }));
    // Past it, without ever tucking.
    settle(director, view({ arc: 130, duckArc: 110 }));

    expect(director.cue).toBeNull();
    expect(director.learnedLessons()).toEqual([]);
    expect(director.timeScale).toBe(1);
  });

  describe('trampolines', () => {
    it('points the player at the centre lane, from either side', () => {
      const left = new TutorialDirector();
      settle(left, view({ padArc: 120, lane: -1 }));
      expect(left.cue).toEqual({ lesson: 'trampoline', steer: 1 });

      const right = new TutorialDirector();
      settle(right, view({ padArc: 120, lane: 1 }));
      expect(right.cue).toEqual({ lesson: 'trampoline', steer: -1 });
    });

    it('drops the steer once they are lined up', () => {
      const director = new TutorialDirector();
      settle(director, view({ padArc: 120, lane: 1 }));
      director.update(FRAME, view({ padArc: 120, lane: 0 }));
      expect(director.cue).toEqual({ lesson: 'trampoline', steer: 0 });
    });

    it('eases time rather than halting it - the answer is to keep running', () => {
      const director = new TutorialDirector();
      const duck = new TutorialDirector();
      settle(director, view({ padArc: 120 }));
      settle(duck, view({ duckArc: 110 }));

      expect(director.timeScale).toBeLessThan(1);
      expect(director.timeScale).toBeGreaterThan(duck.timeScale);
    });

    it('counts a pad crossed as a pad understood', () => {
      const director = new TutorialDirector();
      settle(director, view({ padArc: 120 }));
      const taught = director.update(FRAME, view({ arc: 121, padArc: 120 }));

      expect(taught).toBe('trampoline');
      expect(director.cue).toBeNull();
      settle(director, view({ arc: 130 }));
      expect(director.timeScale).toBe(1);
    });
  });

  it('takes the nearer hazard when the track deals both at once', () => {
    // Both inside their own lead, so this is a real contest rather than one
    // of the two being out of range.
    const director = new TutorialDirector();
    settle(director, view({ duckArc: 112, padArc: 108 }));
    expect(director.cue?.lesson).toBe('trampoline');
  });

  it('teaches only what is still owed', () => {
    const director = new TutorialDirector(['trampoline']);
    settle(director, view({ duckArc: 110, padArc: 112 }));
    expect(director.cue?.lesson).toBe('duck');
  });

  it('stops scanning once both are banked', () => {
    expect(new TutorialDirector(['duck', 'trampoline']).finished).toBe(true);
    expect(new TutorialDirector(['duck']).finished).toBe(false);
  });

  it('ignores junk in the save file', () => {
    const director = new TutorialDirector(['duck', 'nonsense', 7] as never);
    expect(director.learnedLessons()).toEqual(['duck']);
  });

  /**
   * Halving the speed of the one power-up whose entire point is speed would be
   * a strange way to spend the player's first one - and a runner who cannot be
   * hurt by the clothesline anyway (they go straight through it, see
   * `tests/catnip.test.ts`) is not in a position to learn anything from it.
   */
  it('gets out of the way while a power-up is driving', () => {
    const director = new TutorialDirector();
    settle(director, view({ duckArc: 110 }));
    expect(director.cue).not.toBeNull();

    settle(director, view({ duckArc: 110, suspended: true }));
    expect(director.cue).toBeNull();
    expect(director.timeScale).toBe(1);
    expect(director.learnedLessons()).toEqual([]);
  });

  /**
   * A run that ends mid-lesson leaves the director holding a time scale of
   * 0.3. Carrying that into the next run's first frame is a game that starts
   * in slow motion for no reason anyone can see.
   */
  it('drops an interrupted lesson, and the slowdown with it', () => {
    const director = new TutorialDirector();
    settle(director, view({ duckArc: 110 }));
    expect(director.timeScale).toBeLessThan(1);

    director.reset();
    expect(director.timeScale).toBe(1);
    expect(director.cue).toBeNull();
    // Still owed, so the next run teaches it.
    expect(director.learnedLessons()).toEqual([]);
  });
});

/**
 * The lessons are once *per install*, not once per run, so the only thing
 * standing between a player and being taught the same input every session is
 * the save file. These are the ways it can get that wrong.
 */
describe('remembering what has been taught', () => {
  class MemoryAdapter implements StorageAdapter {
    store = new Map<string, string>();
    get(key: string): string | null {
      return this.store.get(key) ?? null;
    }
    set(key: string, value: string): void {
      this.store.set(key, value);
    }
    remove(key: string): void {
      this.store.delete(key);
    }
  }

  const KEY = 'rooftop-rascal:save:v1';

  it('starts a fresh install owing both lessons', () => {
    expect(new SaveManager(new MemoryAdapter()).data.tutorialsLearned).toEqual([]);
  });

  it('survives a reload', () => {
    const adapter = new MemoryAdapter();
    const first = new SaveManager(adapter);
    first.setTutorialsLearned(['duck']);
    first.flush();

    expect(new SaveManager(adapter).data.tutorialsLearned).toEqual(['duck']);
  });

  /**
   * The reason this migrates empty rather than pre-marked: a player whose
   * file predates the tutorial has never seen the duck prompt either, and
   * silently deciding they have been taught is how the one input with no
   * other use in the game stays undiscovered forever.
   */
  it('owes both lessons to a save that predates them', () => {
    const adapter = new MemoryAdapter();
    adapter.set(KEY, JSON.stringify({ version: 4, fish: 120, bestDistance: 300 }));

    const save = new SaveManager(adapter);
    expect(save.data.tutorialsLearned).toEqual([]);
    expect(save.data.fish).toBe(120); // and nothing else was thrown away
  });

  it('refuses lessons a hand-edited file invented', () => {
    const adapter = new MemoryAdapter();
    adapter.set(
      KEY,
      JSON.stringify({ version: 5, tutorialsLearned: ['duck', 'duck', 'fly', 42] }),
    );

    expect(new SaveManager(adapter).data.tutorialsLearned).toEqual(['duck']);
  });
});
