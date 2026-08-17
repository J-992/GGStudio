/**
 * The First Play coach: the time-stop lesson that runs over a brand-new
 * player's very first wave (pure logic).
 *
 * A first-time player boots straight into the arena rather than the garage (see
 * `App.beginFirstRun`), so this is the first thing anyone reads in this game.
 * That budget is about fifteen seconds, which rules out a tour: what is here
 * instead is five beats, each of which stops the world dead, says one short
 * line, and starts it again the instant the player does the thing. Nobody is
 * asked to read while zombies are closing, and nobody is asked to read more
 * than a line.
 *
 * The order is what the hands need, not what the systems are: drive, shoot,
 * press the ability, and only then the two HUD readouts. Those two arrive last
 * *and hidden* — the health bar and the wave timeline stay off the screen until
 * their own beat reveals them, because a full HUD in front of someone who does
 * not yet know what a wave is reads as noise rather than information.
 *
 * The counterpart to `core/tutorial.ts`, which is the Garage Tour. Same split:
 * the steps and the advance rule are pure and live here; the card, the scrim
 * and the freeze live in `survival/FirstPlayCoach.ts` and `SurvivalMode`.
 */

/** A piece of HUD furniture a step uncovers as it opens. */
export type FirstPlayReveal = 'health' | 'waveTimeline';

/**
 * What the player has to do to start the world again.
 *
 * Deliberately the same input the step is teaching, rather than a Next button:
 * the lesson is over when the hand has done it once, and a card dismissed by
 * pressing W has taught driving more reliably than one dismissed by clicking
 * "Got it". `any` is for the two read-only reveals, which are not asking for a
 * skill.
 */
export type FirstPlayRelease = 'drive' | 'fire' | 'ability' | 'any';

/** Inputs the live mode reports back; they are matched against `release`. */
export type FirstPlayInput = 'drive' | 'fire' | 'ability' | 'other';

export interface FirstPlayStep {
  id: string;
  /** Two words at most, in caps on the card. */
  title: string;
  /** One line. Keyboard and mouse. */
  text: string;
  /** The same line for touch controls, where none of the keys exist. */
  touchText: string;
  release: FirstPlayRelease;
  /** Shown as the card's footer: the input, in the player's own words. */
  hint: string;
  touchHint: string;
  reveals?: FirstPlayReveal;
  /**
   * Live arena seconds to let run after this step's card is dismissed, before
   * the next one stops the world again. Sized to be long enough to actually use
   * what was just taught and short enough that the lesson is one continuous
   * beat rather than five interruptions.
   */
  runSeconds: number;
}

/**
 * `%KEY%` is substituted with the ability box the Shield Bubble actually landed
 * in. The rig pins it to the first slot (see `firstPlayRig`), but the loadout
 * resolver owns the final answer and the card has to quote what is true.
 */
export const FIRST_PLAY_ABILITY_KEY_TOKEN = '%KEY%';

export const FIRST_PLAY_STEPS: readonly FirstPlayStep[] = [
  {
    id: 'drive',
    title: 'Drive',
    text: 'Steer with W A S D.',
    touchText: 'Steer with the stick.',
    release: 'drive',
    hint: 'Press W to go',
    touchHint: 'Push the stick',
    runSeconds: 5,
  },
  {
    id: 'shoot',
    title: 'Shoot',
    text: 'Point at a zombie and hold left click.',
    touchText: 'Drag to aim. Hold FIRE.',
    release: 'fire',
    hint: 'Hold left click',
    touchHint: 'Hold FIRE',
    runSeconds: 6,
  },
  {
    id: 'ability',
    title: 'Shield',
    text: `${FIRST_PLAY_ABILITY_KEY_TOKEN} puts a bubble around you. Nothing gets through it.`,
    touchText: 'Tap the shield box. Nothing gets through it.',
    release: 'ability',
    hint: `Press ${FIRST_PLAY_ABILITY_KEY_TOKEN}`,
    touchHint: 'Tap the shield',
    runSeconds: 6,
  },
  {
    id: 'health',
    title: 'Your truck',
    text: 'Zombies chew through this. At zero you are done.',
    touchText: 'Zombies chew through this. At zero you are done.',
    release: 'any',
    hint: 'Press any key',
    touchHint: 'Tap to continue',
    reveals: 'health',
    runSeconds: 4,
  },
  {
    id: 'wave',
    title: 'Clear it',
    text: 'Kill every last one and the wave is yours.',
    touchText: 'Kill every last one and the wave is yours.',
    release: 'any',
    hint: 'Press any key',
    touchHint: 'Tap to continue',
    reveals: 'waveTimeline',
    // Nothing follows, so this is only how long the last card's dismissal is
    // allowed to hold the next one off. There is no next one.
    runSeconds: 0,
  },
];

/** Whether `input` is the thing `step` is waiting for. */
export function releasesStep(
  step: FirstPlayStep,
  input: FirstPlayInput,
): boolean {
  return step.release === 'any' ? true : step.release === input;
}

/**
 * Which HUD pieces are visible once `stepIndex` steps have *opened*.
 *
 * Reads off the step list rather than being tracked as its own flags, so a
 * reveal can never drift from the step that promised it, and a coach that is
 * finished or was never started answers correctly without a special case:
 * an index past the end reveals everything, which is also what happens on a
 * save that has already played its first wave.
 */
export function firstPlayRevealed(
  stepIndex: number,
  reveal: FirstPlayReveal,
): boolean {
  if (stepIndex >= FIRST_PLAY_STEPS.length) return true;
  return FIRST_PLAY_STEPS.slice(0, stepIndex + 1).some(
    (step) => step.reveals === reveal,
  );
}
