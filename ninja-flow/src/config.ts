/**
 * Every tunable number in NINJA FLOW lives here.
 *
 * Poki playtesting turns into config edits, never code edits. Nothing in
 * src/game may hard-code a timing window, a spawn cadence or a camera impulse.
 * All times are in SECONDS unless the name ends in `Ms`.
 */

export const TIMING = {
  /** Half-width of the PERFECT window around an enemy's ideal impact time. */
  perfectMs: 100,
  /** A swing this far BEFORE ideal impact still connects, as a GOOD hit. */
  goodEarlyMs: 260,
  /** A swing this far AFTER ideal impact still connects, as a GOOD hit. */
  goodLateMs: 160,
  /**
   * Swinging earlier than goodEarlyMs whiffs: the attack commits, recovers, and
   * the threat keeps coming. This is what makes mashing strictly worse.
   */
  whiffBeyondMs: 900,
} as const;

export const ATTACK = {
  startup: 0.07,
  impact: 0.1,
  recovery: 0.165,
  /** Total commitment: no second input resolves until this elapses. */
  get total() {
    return this.startup + this.impact + this.recovery;
  },
  /** A whiffed swing recovers slower — the cost of guessing. */
  whiffRecoveryScale: 1.35,
  /**
   * How much longer the ANIMATION runs than the commitment window.
   *
   * Commitment is a gameplay number — it sets the fairness floor and is what
   * makes mashing lose — so it must not move. But a strike played across
   * exactly that window is over before the eye can read it. The body is
   * allowed to finish its follow-through after control has already returned,
   * which is how a strike can look weighty without feeling sluggish.
   */
  animScale: 2.2,
  /** Flow stays faster than normal combat, but still leaves each hit readable. */
  flowAnimScale: 1.45,
  /** Lunge distance toward the target, in world units. */
  lungeDistance: 0.62,
  lungeReturn: 7.5,
} as const;

export const INPUT = {
  /** A press during attack commitment is remembered this long. */
  bufferMs: 110,
  /** Never queue more than one action; long queues feel unresponsive. */
  maxBuffered: 1,
} as const;

export const FLOW = {
  max: 100,
  /*
   * Calibrated against scripted playthroughs: a first-time player who misses a
   * fair share reaches their first Flow around 30 s, while a clean run gets
   * there closer to 15 s. Mastery arriving sooner is intended — what the
   * numbers must prevent is the signature mechanic showing up minutes in.
   */
  gainGood: 7,
  gainPerfect: 15,
  /** Consecutive perfects ramp the gain up to this ceiling. */
  gainPerfectMax: 18,
  perfectRampStep: 1,
  loseMiss: 4,
  loseDamage: 18,
  /** Small bonus scaled by combo tier, added to every connecting hit. */
  comboBonusMax: 2,
  /**
   * Reaction budget per Flow target, walked down as the chain accelerates.
   *
   * Deliberately forgiving, and the first entry more so than the rest: that
   * press is made while the player is still taking in a brand-new screen.
   *
   * These are DEADLINES, not durations. A player who reads fast still tears
   * through a chain at their own pace, because every correct press advances
   * immediately — widening the window costs a quick player nothing and only
   * ever helps a slower one. Flow is the reward for playing well, so the
   * chain's pressure should come from its pace and its noise, never from a
   * deadline that beats human reaction time.
   */
  reactionWindows: [1.7, 1.45, 1.35, 1.25, 1.18, 1.12, 1.05],
  minTargets: 6,
  maxTargets: 9,
  /** Slow-motion factor while Flow targets are live. */
  timeScale: 0.82,
  /**
   * Hold before the chain accepts input. The first target is lit for the whole
   * of it, so this is read time rather than dead time — the player is told
   * which way to press before the clock on that press starts.
   */
  activationHold: 0.55,
  finisherWindup: 0.42,
  finisherWindow: 1.5,
  /** Breathing room after Flow before the next readable threat. */
  recoverPause: 0.8,
  scorePerHit: 260,
  finisherScore: 1500,
  /**
   * Flow the meter starts with on a player's very first run, and only then.
   *
   * Flow Mode is the game's best moment and the thing its name promises, and a
   * scrappy first-timer takes about thirty seconds to earn one — long enough on
   * a portal to lose them before they ever see it. Starting the first run part
   * way up brings the signature mechanic inside the first ten seconds without
   * touching the economy of any later run.
   */
  firstRunHead: 55,
} as const;

export const COMBO = {
  /** [minCombo, scoreMultiplier] — first match from the top wins. */
  tiers: [
    [40, 3],
    [20, 2],
    [10, 1.5],
    [5, 1.2],
    [0, 1],
  ] as ReadonlyArray<readonly [number, number]>,
  milestones: [10, 20, 40, 60, 100],
} as const;

export const HITSTOP = {
  good: 0.03,
  perfect: 0.06,
  flowHit: 0.045,
  finisher: 0.1,
  playerHit: 0.07,
  /** A deep combo freezes the frame harder, up to this multiplier. */
  comboScaleMax: 2.2,
  comboScaleAt: 30,
} as const;

export const SCORE = {
  good: 100,
  perfect: 250,
  rareBonus: 900,
  /** Points per second survived, awarded on death. */
  survivalPerSecond: 12,
} as const;

/**
 * Breathing room granted after a pause, so the first threat back is readable
 * rather than landing the instant control returns.
 */
export const PAUSE_GRACE = 1.1;

export const HEALTH = {
  hearts: 4,
  /** Invulnerable recovery after taking a hit. */
  recovery: 0.65,
} as const;

export const ENEMY = {
  /** Distance from arena centre where enemies spawn. */
  /** Both lanes begin at the visible ends of the imported bridge. */
  spawnDistance: 6.4,
  /**
   * Body-to-centre distance at which an average weapon lands its strike.
   * Enemies should feel inside the hero's personal space before committing,
   * rather than stopping at the edge of the bridge action.
   */
  strikeDistance: 1.12,
  /** Weapon reach changes the stop point, but never by a full body length. */
  reachDistanceScale: 0.45,
  strikeDistanceMin: 0.96,
  strikeDistanceMax: 1.3,
  /** How long after ideal impact the enemy's own attack resolves. */
  enemyAttackDelay: 0.22,
  /** Time before an enemy that hit the player completes its next strike. */
  retrySeconds: 0.95,
  /** Brief reset step after landing a hit, before the next approach begins. */
  retryRetreatSeconds: 0.28,
  retryRetreatSpeed: 3.2,
  launchSpeed: 13,
  launchSpin: 14,
  despawnAfter: 1.6,
  /** Chance a threat is the rare high-value target, once unlocked. */
  rareChance: 0.055,
  rareUnlockAfter: 45,
  rareSpeedScale: 1.18,
} as const;

/**
 * Difficulty is expressed as phases keyed on elapsed run time. Spacing is the
 * gap between consecutive scheduled IMPACT times, not between spawns.
 */
export const DIFFICULTY = {
  phases: [
    { at: 0, spacing: [1.15, 1.3], approach: 2.15, complexity: 0 },
    { at: 15, spacing: [0.95, 1.12], approach: 1.95, complexity: 1 },
    { at: 30, spacing: [0.86, 1.02], approach: 1.75, complexity: 2 },
    { at: 60, spacing: [0.74, 0.9], approach: 1.6, complexity: 3 },
    { at: 95, spacing: [0.62, 0.8], approach: 1.45, complexity: 4 },
    { at: 140, spacing: [0.54, 0.72], approach: 1.35, complexity: 5 },
  ],
  /** Cadence stops accelerating here; further difficulty is pattern-only. */
  floorSpacing: 0.46,
  /** Every Nth pattern is a deliberate breather. */
  breatherEvery: 4,
  breatherBonus: 0.45,
  burstEvery: 3,
} as const;

/**
 * Guarded enemies.
 *
 * The second thing the game asks the player to read. A guarded enemy carries a
 * plate it raises into the first strike: the hit lands, the guard breaks, and
 * the enemy is knocked back and comes again — so it costs a second read and a
 * second piece of timing rather than a second button press. Mashing still
 * loses, because the re-armed strike has its own impact time to be answered.
 *
 * They are introduced well after the tutorial, and their share of threats ramps
 * with the run rather than appearing all at once.
 */
export const GUARD = {
  /** No guarded enemy before this point in a run. */
  fromSeconds: 40,
  /** Share of threats carrying a guard, at introduction and at full ramp. */
  chanceStart: 0.14,
  chanceMax: 0.38,
  chanceRampSeconds: 120,
  /** Two-plate enemies start appearing this late, once one plate is familiar. */
  doubleFromSeconds: 105,
  doubleChance: 0.3,
  /** Time bought by breaking a plate before the re-armed strike lands. */
  recoverSeconds: 0.72,
  /** How far the enemy is knocked back before it comes again. */
  recoilDistance: 2.4,
  /** Time spent physically recoiling before the next approach begins. */
  recoilSeconds: 0.18,
  /** Air resistance on the guard-break shove. */
  recoilDamping: 8.5,
  /** Breaking a plate is worth this, before the combo multiplier. */
  breakScore: 60,
  /** Flow earned for a break — less than a kill, enough to feel like progress. */
  flowGain: 4,
} as const;

/**
 * Feints.
 *
 * The third thing the player has to read, and the only one that asks for the
 * opposite instinct to everything else in the game. A feint runs at you like
 * any other threat and pulls up short: swinging at it whiffs, with the whiff's
 * full cost, while holding your nerve is worth Flow and points.
 *
 * It is only fair because it is readable BEFORE the moment of decision, never
 * at it. A feint carries no weapon and wears bone-white against four warm clan
 * palettes, so the answer to "is this one real" is settled at spawn — the
 * pressure comes from having to notice under time pressure, not from a guess.
 *
 * Introduced well after guards, so a player is only ever learning one new read
 * at a time, and its share ramps rather than arriving all at once.
 */
export const FEINT = {
  /** No feints before this point in a run. */
  fromSeconds: 70,
  /** Share of threats that are feints, at introduction and at full ramp. */
  chanceStart: 0.1,
  chanceMax: 0.22,
  chanceRampSeconds: 90,
  /** Flow for holding. Below a kill's — it is the right call, not a feat. */
  flowGain: 5,
  /** Points for holding, before the combo multiplier. */
  score: 120,
  /** Time between the feint's moment and it clearing the lane. */
  retreatAfter: 0.2,
} as const;

/**
 * Physics for everything that gets knocked around.
 *
 * These numbers are deliberately not real-world: gravity is roughly 2.6x Earth
 * so bodies come down inside a cut rather than hanging, and restitution is low
 * so the arena settles quickly. What matters is that the motion is SIMULATED —
 * arcs, bounces, friction and roll — rather than keyframed, because that is
 * what makes a hit read as force applied to a mass.
 */
export const PHYSICS = {
  gravity: 26,
  /** Bounce retained by a launched body hitting the floor. */
  restitution: 0.3,
  /** Horizontal speed retained per bounce. */
  friction: 0.62,
  angularDamping: 1.35,
  sleepSpeed: 0.42,
  /** Ground offset for a body lying on its side. */
  bodyRadius: 0.3,

  /** Dropped weapons and armour shards. */
  propGravity: 32,
  propRestitution: 0.4,
  propFriction: 0.55,
  propLife: 2.8,

  /** Secondary motion: how hard limbs and cloth resist the body's motion. */
  lagStiffness: 120,
  lagDamping: 17,
  /** Radians of lean per metre/second^2 of body acceleration. */
  lagPerAccel: 0.0042,
  maxLag: 0.55,

  /** Hero inertia: the torso and head trail the root through a dash. */
  heroLagStiffness: 90,
  heroLagDamping: 15,
  heroLagPerAccel: 0.0026,
  heroMaxLag: 0.34,
} as const;

/** Runtime alignment and equal/opposite response for player attack contacts. */
export const CONTACT = {
  /** Approximate enemy surface inset from its root centre. */
  bodyRadius: 0.28,
  /** Maximum root correction; keeps warping invisible rather than teleporting. */
  maxWarp: 0.48,
  /** Normalised portion of a move used to blend into its contact target. */
  warpWindow: 0.24,
  /** How quickly the correction releases after the striking limb separates. */
  warpRelease: 9,
  /** Player/enemy effective mass ratio used for equal-and-opposite recoil. */
  playerMassRatio: 3.6,
  /** Bounds measured bone velocity before it feeds the stylised impulse. */
  minEffectorSpeed: 4.5,
  maxEffectorSpeed: 15,
} as const;

export const TUTORIAL = {
  /** Bump when the lesson changes so existing players see the correction once. */
  version: 4,
  /** Threats that cannot damage the player, no matter how badly missed. */
  safeThreats: 8 as number,
  /** Extra approach time granted to the very first threats. */
  slowFactor: 2.1,
  /** Extra breathing room between first-run enemies. */
  gapScale: 1.6,
  /** Show GET READY this long before the reaction-compensated tap cue. */
  readySeconds: 0.8,
  /** Visual reaction lead: a normal response lands inside the ±100 ms window. */
  perfectCueLeadMs: 230,
  /** The first-ever Flow gives players time to read an unfamiliar state. */
  flowFirstWindow: 3.5,
  flowWindowScale: 1.35,
  slowDecay: 0.12,
  /** Prompts fade out once the player has proven each side this many times. */
  proveCount: 1,
} as const;

export const CAMERA = {
  fov: { landscape: 42, portrait: 58 },
  /*
   * Closer than it used to be (7.6 / 9.4), and looking higher up the body.
   *
   * The fight happened in a band across the middle of the frame with the hero
   * about a quarter of the screen's height, roughly half the picture given over
   * to empty sky, and the bridge's near railing crossing everybody at the
   * waist. All three are the same problem — the camera was framing the garden
   * rather than the fight — and all three are fixed here and in
   * `Arena.setNearRailVisible`, which now runs for gameplay as well as for the
   * character screen.
   */
  distance: { landscape: 6.5, portrait: 8.3 },
  height: 3.0,
  /** Raised with the camera, which lifts the horizon and drops the dead sky. */
  lookHeight: 1.5,
  /** Slight off-axis so the arena reads as 2.5D rather than flat. */
  yawOffset: 0.1,
  trauma: { good: 0.18, perfect: 0.42, finisher: 0.75, damage: 0.55 },
  traumaDecay: 1.9,
  shakeAmplitude: 0.32,
  punch: { good: 0.06, perfect: 0.2, finisher: 0.5 },
  flowDistanceScale: 0.82,
  flowHeightScale: 0.9,
  restoreSpeed: 3.2,
} as const;

export const VFX = {
  slashScale: { good: 1, perfect: 1.55, flow: 1.35, finisher: 2.4 },
  poolSize: { slash: 12, burst: 10, spark: 24, label: 8 },
  /** Flash intensity added to the scene light on impact. */
  flash: { good: 0.35, perfect: 1, finisher: 1.6 },
} as const;

/**
 * Post-death highlight reel: a short cinematic re-enactment of the run's best
 * moments, staged from the recorded hit log (never a video capture). Modeled on
 * the SUPERHOT / Katana ZERO pattern of replaying the player's own actions as
 * the payoff, scaled down to Poki attention spans: a few seconds, skippable,
 * and never delaying the PLAY AGAIN button beyond it.
 */
export const HIGHLIGHTS = {
  enabled: true,
  maxVignettes: 3,
  /** Seconds from the shot opening to the first blow landing. */
  approachSeconds: 0.72,
  /** Gap between blows inside a wave — fight-scene pacing, not game pacing. */
  chainStagger: 0.15,
  /** Slow-motion aftermath held before the cut to the next shot. */
  tailSeconds: 0.5,
  /** Approach pace — brisk so the shot has energy before the strike. */
  timeScale: 0.9,
  /** Aftermath slow-mo, held until the vignette ramps out for the cut. */
  slowTimeScale: 0.3,
  /** Wave size cap — one enemy per ~5 combo at the logged moment. */
  maxChain: 5,
  /**
   * Playback speed by combo. A two-hit moment is a beat, not a set piece, so it
   * plays at speed; a thirty-hit chain is the run's highlight and is shown in
   * slow motion, where the choreography is actually readable.
   */
  pace: {
    lowCombo: 4,
    lowScale: 0.95,
    highCombo: 26,
    highScale: 0.4,
  },
  /** The big moments are always shown slowly, whatever the combo was. */
  showpieceScale: 0.5,
  /** Depth offset between wave members so they never file up single-rank. */
  waveDepth: 0.42,
  /** A run shorter than this shows no reel — nothing worth replaying. */
  minMoments: 2,
} as const;

export const AUDIO = {
  masterVolume: 0.75,
  musicVolume: 0.32,
  /** Pitch jitter applied to every one-shot so repeats do not fatigue. */
  pitchJitter: 0.07,
} as const;

/** Total Mastery thresholds for each ninja. Ninja 1 is always available. */
export const UNLOCKS = {
  order: ['fox', 'cat', 'bunny', 'masked'] as const,
  /*
   * Calibrated against simulated runs (see tests/RunModel): a first-timer earns
   * ~200 mastery per run, a casual ~2.5k, a competent player ~7k. So: ninja 2
   * lands during run 1-2 for everyone, ninja 3 after a few casual runs, and
   * ninja 4 is a session-spanning goal without becoming a grind.
   */
  thresholds: [0, 300, 4000, 20000] as const,
  /** Mastery weights — presented to the player as one bar, never as a formula. */
  mastery: {
    perKill: 3,
    perPerfect: 6,
    perFlow: 60,
    perScore: 0.015,
  },
} as const;

export type CharacterId = (typeof UNLOCKS.order)[number];

export const DEV = import.meta.env?.DEV === true;

/**
 * Poki ad breaks.
 *
 * ON. Poki's integration review fails a game that never requests a commercial
 * break, so this stays true in anything that goes to the dashboard. Turning it
 * off is a playtesting convenience only — everything else in the integration
 * (loading events, gameplayStart/Stop, telemetry) stays live either way, so the
 * switch removes the interstitial between runs and nothing else.
 */
export const PLATFORM = {
  ads: true,
} as const;
