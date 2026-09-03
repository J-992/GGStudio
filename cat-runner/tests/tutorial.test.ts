import { describe, expect, it } from 'vitest';
import { TutorialDirector, type TutorialView } from '../src/game/Tutorial';
import { SaveManager, type StorageAdapter } from '../src/game/SaveManager';

/**
 * The first-time lessons.
 *
 * Runs at ordinary speed throughout - there is no slow-motion any more (see
 * `Tutorial.ts`'s own doc comment for why), so a lesson's behaviour is
 * entirely a function of a single `update(view)` call each frame: it lets go
 * the instant the input lands, it lets go once the hazard is passed without
 * one, and it never fires twice. The cases worth writing down are the ones
 * around exactly when that happens.
 */

function view(overrides: Partial<TutorialView> = {}): TutorialView {
  return {
    arc: 100,
    obstacleArc: Infinity,
    blocked: [false, false, false],
    jumpArc: Infinity,
    gapArc: Infinity,
    duckArc: Infinity,
    padArc: Infinity,
    turnArc: Infinity,
    turnDir: 0,
    lane: 0,
    ducked: false,
    laneChanged: false,
    jumped: false,
    turned: false,
    suspended: false,
    ...overrides,
  };
}

describe('first-run tutorial', () => {
  it('says nothing on empty track', () => {
    const director = new TutorialDirector();
    director.update(view());
    expect(director.cue).toBeNull();
  });

  it('waits until the clothesline is close before interrupting', () => {
    const director = new TutorialDirector();
    director.update(view({ duckArc: 200 }));
    expect(director.cue).toBeNull();
  });

  it('shows the duck arrow once close enough', () => {
    const director = new TutorialDirector();
    director.update(view({ duckArc: 110 }));
    expect(director.cue).toEqual({ lesson: 'duck', steer: 0 });
  });

  it('takes the arrow away the moment the player swipes', () => {
    const director = new TutorialDirector();
    director.update(view({ duckArc: 110 }));
    expect(director.cue).not.toBeNull();

    director.update(view({ duckArc: 110, ducked: true }));
    expect(director.cue).toBeNull();
  });

  it('banks the lesson on the swipe, and never teaches it again', () => {
    const director = new TutorialDirector();
    director.update(view({ duckArc: 110 }));
    const taught = director.update(view({ duckArc: 110, ducked: true }));
    expect(taught).toBe('duck');
    expect(director.learnedLessons()).toEqual(['duck']);

    // A second swipe after the prompt has gone is not a second lesson.
    expect(director.update(view({ duckArc: 110, ducked: true }))).toBeNull();

    // Nor is the next clothesline, in this run or any other.
    director.reset();
    director.update(view({ arc: 300, duckArc: 310 }));
    expect(director.cue).toBeNull();
  });

  it('starts the clothesline lesson closer in than the trampoline one', () => {
    const duck = new TutorialDirector();
    duck.update(view({ arc: 100, duckArc: 120 })); // 20 units out
    expect(duck.cue).toBeNull();

    const pad = new TutorialDirector();
    pad.update(view({ arc: 100, padArc: 120 }));
    expect(pad.cue).not.toBeNull();
  });

  it('teaches the clothesline again if the player walked into it', () => {
    const director = new TutorialDirector();
    director.update(view({ duckArc: 110 }));
    // Past it, without ever tucking.
    director.update(view({ arc: 130, duckArc: 110 }));

    expect(director.cue).toBeNull();
    expect(director.learnedLessons()).toEqual([]);
  });

  describe('trampolines', () => {
    it('points the player at the centre lane, from either side', () => {
      const left = new TutorialDirector();
      left.update(view({ padArc: 120, lane: -1 }));
      expect(left.cue).toEqual({ lesson: 'trampoline', steer: 1 });

      const right = new TutorialDirector();
      right.update(view({ padArc: 120, lane: 1 }));
      expect(right.cue).toEqual({ lesson: 'trampoline', steer: -1 });
    });

    it('drops the steer once they are lined up', () => {
      const director = new TutorialDirector();
      director.update(view({ padArc: 120, lane: 1 }));
      director.update(view({ padArc: 120, lane: 0 }));
      expect(director.cue).toEqual({ lesson: 'trampoline', steer: 0 });
    });

    it('counts a pad crossed as a pad understood', () => {
      const director = new TutorialDirector();
      director.update(view({ padArc: 120 }));
      const taught = director.update(view({ arc: 121, padArc: 120 }));

      expect(taught).toBe('trampoline');
      expect(director.cue).toBeNull();
    });
  });

  describe('lane changes', () => {
    it('shows the lane-change lesson', () => {
      const director = new TutorialDirector();
      director.update(view({ obstacleArc: 110 }));
      expect(director.cue?.lesson).toBe('laneChange');
    });

    it('steers away from whichever lane the obstacle blocks', () => {
      const director = new TutorialDirector();
      director.update(view({ obstacleArc: 110, lane: 0, blocked: [false, true, false] }));
      expect(director.cue?.steer).not.toBe(0);
    });

    it('banks the lesson on a lane change, and never teaches it again', () => {
      const director = new TutorialDirector();
      director.update(view({ obstacleArc: 110 }));
      const taught = director.update(view({ obstacleArc: 110, laneChanged: true }));
      expect(taught).toBe('laneChange');
      expect(director.learnedLessons()).toEqual(['laneChange']);

      director.reset();
      director.update(view({ arc: 300, obstacleArc: 310 }));
      expect(director.cue).toBeNull();
    });

    it('teaches it again if the player walked into the obstacle without changing lanes', () => {
      const director = new TutorialDirector();
      director.update(view({ obstacleArc: 110 }));
      director.update(view({ arc: 130, obstacleArc: 110 }));

      expect(director.cue).toBeNull();
      expect(director.learnedLessons()).toEqual([]);
    });
  });

  describe('jumping (the horizontal pipe)', () => {
    it('shows the jump lesson', () => {
      const director = new TutorialDirector();
      director.update(view({ jumpArc: 110 }));
      expect(director.cue?.lesson).toBe('jump');
    });

    it('banks the lesson on a jump, and never teaches it again', () => {
      const director = new TutorialDirector();
      director.update(view({ jumpArc: 110 }));
      const taught = director.update(view({ jumpArc: 110, jumped: true }));
      expect(taught).toBe('jump');
      expect(director.learnedLessons()).toEqual(['jump']);
    });

    it('teaches it again if the player ran into the pipe without jumping', () => {
      const director = new TutorialDirector();
      director.update(view({ jumpArc: 110 }));
      director.update(view({ arc: 130, jumpArc: 110 }));

      expect(director.learnedLessons()).toEqual([]);
    });
  });

  describe('the gap (a distinct lesson from the pipe)', () => {
    it('shows the gap lesson', () => {
      const director = new TutorialDirector();
      director.update(view({ gapArc: 110 }));
      expect(director.cue?.lesson).toBe('gap');
    });

    it('banks the lesson on a jump, and never teaches it again', () => {
      const director = new TutorialDirector();
      director.update(view({ gapArc: 110 }));
      const taught = director.update(view({ gapArc: 110, jumped: true }));
      expect(taught).toBe('gap');
      expect(director.learnedLessons()).toEqual(['gap']);
    });

    it('teaches it again if the player fell in the gap without jumping', () => {
      const director = new TutorialDirector();
      director.update(view({ gapArc: 110 }));
      director.update(view({ arc: 130, gapArc: 110 }));

      expect(director.learnedLessons()).toEqual([]);
    });

    it('is a separate lesson from the pipe, even though both are read off `jumped`', () => {
      const director = new TutorialDirector();
      director.update(view({ jumpArc: 110 }));
      director.update(view({ jumpArc: 110, jumped: true }));
      expect(director.learnedLessons()).toEqual(['jump']);

      // The gap hazard, later on, still owes its own lesson.
      director.update(view({ arc: 200, gapArc: 210 }));
      expect(director.cue?.lesson).toBe('gap');
    });
  });

  describe('turning', () => {
    it('shows the turn arrow, pointing the way the corner goes', () => {
      const director = new TutorialDirector();
      director.update(view({ turnArc: 120, turnDir: 1 }));
      expect(director.cue).toEqual({ lesson: 'turn', steer: 1 });
    });

    it('banks the lesson once the player commits to the turn', () => {
      const director = new TutorialDirector();
      director.update(view({ turnArc: 120, turnDir: 1 }));
      const taught = director.update(view({ turnArc: 120, turnDir: 1, turned: true }));
      expect(taught).toBe('turn');
      expect(director.learnedLessons()).toEqual(['turn']);
    });

    it('teaches it again if the player missed the corner', () => {
      const director = new TutorialDirector();
      director.update(view({ turnArc: 120 }));
      director.update(view({ arc: 130, turnArc: 120 }));

      expect(director.learnedLessons()).toEqual([]);
    });
  });

  it('takes the nearer hazard when the track deals both at once', () => {
    // Both inside their own lead, so this is a real contest rather than one
    // of the two being out of range.
    const director = new TutorialDirector();
    director.update(view({ duckArc: 112, padArc: 108 }));
    expect(director.cue?.lesson).toBe('trampoline');
  });

  it('teaches only what is still owed', () => {
    const director = new TutorialDirector(['trampoline']);
    director.update(view({ duckArc: 110, padArc: 112 }));
    expect(director.cue?.lesson).toBe('duck');
  });

  it('stops scanning once all six are banked', () => {
    expect(
      new TutorialDirector(['laneChange', 'jump', 'duck', 'gap', 'trampoline', 'turn']).finished,
    ).toBe(true);
    expect(new TutorialDirector(['duck']).finished).toBe(false);
  });

  it('ignores junk in the save file', () => {
    const director = new TutorialDirector(['duck', 'nonsense', 7] as never);
    expect(director.learnedLessons()).toEqual(['duck']);
  });

  it('gets out of the way while a power-up is driving', () => {
    const director = new TutorialDirector();
    director.update(view({ duckArc: 110 }));
    expect(director.cue).not.toBeNull();

    director.update(view({ duckArc: 110, suspended: true }));
    expect(director.cue).toBeNull();
    expect(director.learnedLessons()).toEqual([]);
  });

  it('drops an interrupted lesson', () => {
    const director = new TutorialDirector();
    director.update(view({ duckArc: 110 }));
    expect(director.cue).not.toBeNull();

    director.reset();
    expect(director.cue).toBeNull();
    // Still owed, so the next run teaches it.
    expect(director.learnedLessons()).toEqual([]);
  });

  /**
   * The mechanism the standalone tutorial level's Combined Challenge section
   * relies on: it restages lane-change/gap/turn hazards a second time, later
   * in the same attempt, with no instructional cue - not because anything
   * special-cases it, but because a single `TutorialDirector` instance never
   * re-arms a lesson once `learned` has it, and the level only ever
   * constructs one director per attempt (see `Game.startTutorial()`).
   */
  it('never re-arms an already-learned lesson within the same instance', () => {
    const director = new TutorialDirector();
    director.update(view({ obstacleArc: 110 }));
    director.update(view({ obstacleArc: 110, laneChanged: true }));
    director.update(view({ arc: 200, gapArc: 210 }));
    director.update(view({ arc: 200, gapArc: 210, jumped: true }));
    expect(director.learnedLessons()).toEqual(['laneChange', 'gap']);

    // Both hazards again, further down the (hypothetical) track - as the
    // Combined Challenge's own restaged chunks would present them.
    director.update(view({ arc: 300, obstacleArc: 310 }));
    expect(director.cue).toBeNull();
    director.update(view({ arc: 320, gapArc: 330 }));
    expect(director.cue).toBeNull();
    expect(director.learnedLessons()).toEqual(['laneChange', 'gap']);
  });
});

/**
 * The tutorial prefix is only ever included once automatically - on a
 * genuinely fresh install - and otherwise forced onto a run at will from the
 * main menu's Tutorial button. `SaveData.tutorialCompleted` is the only
 * thing that remembers whether that first run has already happened; nothing
 * about individual lessons persists across runs (see `Tutorial.ts`'s own
 * module doc comment for why `TutorialDirector.learned` is in-memory only).
 */
describe('remembering whether the tutorial has run', () => {
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

  it('starts a genuinely fresh install owing the tutorial', () => {
    expect(new SaveManager(new MemoryAdapter()).data.tutorialCompleted).toBe(false);
  });

  /**
   * A save existing at all is proof the game has already been launched
   * once - see `SaveData.tutorialCompleted`'s own doc comment. Forcing the
   * tutorial on a returning player (even one from before this field existed)
   * would be far more jarring than the reactive one-off prompts it replaced
   * ever were.
   */
  it('marks a save that predates this field as already having seen the tutorial', () => {
    const adapter = new MemoryAdapter();
    adapter.set(KEY, JSON.stringify({ version: 1 }));

    const save = new SaveManager(adapter);
    expect(save.data.tutorialCompleted).toBe(true);
  });

  it('marks any pre-existing save complete regardless of its other fields', () => {
    const adapter = new MemoryAdapter();
    adapter.set(KEY, JSON.stringify({ version: 4, fish: 120, bestDistance: 300 }));

    const save = new SaveManager(adapter);
    expect(save.data.tutorialCompleted).toBe(true);
    expect(save.data.fish).toBe(120); // and nothing else was thrown away
  });

  it('banks the tutorial as complete once set, and it survives a reload', () => {
    const adapter = new MemoryAdapter();
    const first = new SaveManager(adapter);
    expect(first.data.tutorialCompleted).toBe(false);

    first.setTutorialCompleted();
    first.flush();

    expect(new SaveManager(adapter).data.tutorialCompleted).toBe(true);
  });

  it('setTutorialCompleted is one-way and idempotent', () => {
    const adapter = new MemoryAdapter();
    const save = new SaveManager(adapter);
    save.setTutorialCompleted();
    save.setTutorialCompleted();
    save.flush();

    expect(new SaveManager(adapter).data.tutorialCompleted).toBe(true);
  });
});
