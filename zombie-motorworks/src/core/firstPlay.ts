/**
 * The First Play coach: the time-stop lesson that runs over a brand-new
 * player's very first wave (pure logic).
 *
 * A first-time player boots straight into the arena rather than the garage (see
 * `App.beginFirstRun`), so this is the first thing anyone reads in this game.
 * That budget is about fifteen seconds, which rules out a tour: what is here
 * instead is three beats, each of which stops the world dead, says one short
 * line, and starts it again the instant the player does the thing. Nobody is
 * asked to read while zombies are closing, and nobody is asked to read more
 * than a line.
 *
 * The order is what the hands need, not what the systems are: drive, shoot,
 * press the ability. Nothing else stops the world. The HUD used to cost two
 * more time-stops — one to point at the health bar, one at the wave timeline —
 * and neither was teaching a skill; a stopped fight with a caption on it is the
 * most expensive way to introduce a bar that could simply slide in at the
 * moment it starts mattering. So the readouts are event-revealed instead (see
 * `FIRST_PLAY_HUD_TRIGGERS`), and the coach is three beats of hands.
 *
 * The counterpart to `core/tutorial.ts`, which is the Garage Tour. Same split:
 * the steps and the advance rule are pure and live here; the card, the scrim
 * and the freeze live in `survival/FirstPlayCoach.ts` and `SurvivalMode`.
 */

/**
 * What the player has to do to start the world again.
 *
 * Deliberately the same input the step is teaching, rather than a Next button:
 * the lesson is over when the hand has done it once, and a card dismissed by
 * pressing W has taught driving more reliably than one dismissed by clicking
 * "Got it".
 */
export type FirstPlayRelease = 'drive' | 'fire' | 'ability';

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
  /**
   * Live arena seconds to let run after this step's card is dismissed, before
   * the next one stops the world again. Sized to be long enough to actually use
   * what was just taught and short enough that the lesson is one continuous
   * beat rather than three interruptions.
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
    runSeconds: 4,
  },
  {
    id: 'shoot',
    title: 'Shoot',
    text: 'Point at a zombie and hold left click.',
    touchText: 'Drag to aim. Hold FIRE.',
    release: 'fire',
    hint: 'Hold left click',
    touchHint: 'Hold FIRE',
    runSeconds: 5,
  },
  {
    id: 'ability',
    title: 'Shield',
    text: `${FIRST_PLAY_ABILITY_KEY_TOKEN} puts a bubble around you. Nothing gets through it.`,
    touchText: 'Tap the shield box. Nothing gets through it.',
    release: 'ability',
    hint: `Press ${FIRST_PLAY_ABILITY_KEY_TOKEN}`,
    touchHint: 'Tap the shield',
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
  return step.release === input;
}

/** A piece of HUD furniture the first wave keeps off screen until it earns it. */
export type FirstPlayHudPiece =
  'health' | 'waveTimeline' | 'cash' | 'fuel' | 'speed' | 'minimap';

/** Something that happened in the arena and is allowed to uncover a readout. */
export type FirstPlayHudTrigger = 'damaged' | 'kill' | 'ramSpeed' | 'lowFuel';

/**
 * What has to happen before each readout is worth screen space.
 *
 * A bar that slides in at the moment it starts meaning something teaches itself
 * and costs nothing; the same bar sitting there from frame one is instrument
 * clutter in front of somebody who does not yet know what a wave is. `null` is
 * a piece the first wave never shows at all — the minimap is a wave-2 tool, and
 * a new player cannot read a blip map and learn to steer at the same time.
 *
 * `ramSpeed` fires the first time the rig is moving fast enough for a ram to
 * hurt, which is the first moment the tiered speed bar is describing anything.
 */
export const FIRST_PLAY_HUD_TRIGGERS: Readonly<
  Record<FirstPlayHudPiece, FirstPlayHudTrigger | null>
> = {
  health: 'damaged',
  waveTimeline: 'kill',
  cash: 'kill',
  speed: 'ramSpeed',
  fuel: 'lowFuel',
  minimap: null,
};

/** Every readout `trigger` uncovers. */
export function firstPlayHudPiecesFor(
  trigger: FirstPlayHudTrigger,
): FirstPlayHudPiece[] {
  return (Object.keys(FIRST_PLAY_HUD_TRIGGERS) as FirstPlayHudPiece[]).filter(
    (piece) => FIRST_PLAY_HUD_TRIGGERS[piece] === trigger,
  );
}
