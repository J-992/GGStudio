// Every tunable number lives here; game code never hardcodes a balance value.
//
// Units: seconds, metres, degrees (converted to radians only inside
// `core/arenaGeometry.js`). `CONFIG` is deep-frozen so a stray write throws
// immediately in dev instead of silently drifting one system out of sync
// with another.

/**
 * @param {any} value
 * @returns {any} `value`, with itself and every nested object/array frozen.
 */
function deepFreeze(value) {
  if (value !== null && (typeof value === 'object')) {
    for (const key of Object.keys(value)) {
      deepFreeze(value[key]);
    }
    Object.freeze(value);
  }
  return value;
}

export const CONFIG = Object.freeze(deepFreeze({
  arena: {
    radius: 26,
    wallHeight: 3,
    gateAngles: [0, 120, 240],
    gateRadius: 25.5,
    gateWidth: 4,
    slotRadius: 16,
    slotOffsets: [40, 60, 80], // 9 slots, all between gates
    dressingRadius: [28, 34],
    dressingCount: { fence: 24, pillar: 6, tomb: 8, rock: 14 },
  },

  player: {
    speed: 4.0,
    hp: 100,
    regenPerS: 4,
    regenDelayS: 4,
    eyeHeight: 1.6,
    radius: 0.5,
    lookSensMouse: 0.0022,
    lookSensTouch: 0.006,
    pitchLimitDeg: 75,
    invulnAfterReviveS: 3,
    revivePushRadius: 8,
    revivePushSpeed: 8, // m/s impulse the revive shove lands on each enemy in range.

    // The recoil spring itself: shared by every weapon, because these are
    // normalization and stability constants rather than feel knobs.
    // `core/recoil.js` integrates them into one value; each weapon's own
    // `recoil` block below scales that value into metres and degrees.
    recoil: {
      stiffness: 256, // omega0 = 16 rad/s -> peaks ~4 frames after the shot
      damping: 32,    // exactly 2*omega0: critically damped, never overshoots
      maxValue: 1.8,  // ceiling over the ~1.3 sustained plateau
    },

    // The weapon a player starts a run with when they have never picked one.
    defaultWeapon: 'pistol',

    // Shaped like `turrets` above — an `order` array driving display/selection
    // and a `types` record of defs — so `core/weapons.js` and the select UI can
    // reuse the same "iterate order, resolve by id" pattern the turret chips
    // already use.
    //
    // Every weapon is unlocked from wave 1, so these are deliberately
    // SIDEGRADES, not a power ladder: each lands in an 84-110 effective-DPS
    // band and is separated by spread, reach and burst shape instead. A
    // strictly better weapon would flatten the whole run. Balance anchors, for
    // tuning: shambler 30 hp, spitter 24, tungtung 110, Patapim 900, `hpMul`
    // to 1.5.
    //
    // SPREAD, not `range`, is what separates the automatics. The arena is 26 m
    // in radius, so anything past ~52 m of range already reaches everywhere and
    // more buys nothing — but at 20 m a 2.4-degree cone is about +/-0.85 m
    // against a 0.5 m enemy radius, so the fast weapons genuinely miss at
    // distance and the pinpoint ones genuinely don't. That is also why the M9
    // is worth picking at all next to the M4A1: less DPS, but it hits what the
    // crosshair is on. The RPG-7's 27 single-target DPS looks far off the band
    // on purpose — its damage is the splash, over a 4.5 m radius.
    //
    // `recoil` scales `player.recoil`'s shared spring into this weapon's own
    // kick. `impulse` stays at the normalized 46.5 for every weapon — that is
    // what makes one shot peak the spring at ~1.0, so each amplitude below
    // reads directly as "per shot"; scaling it too would just push into
    // `maxValue`'s clamp and count the weapon's heft twice. `camPitchDeg`
    // grows far more gently than the viewmodel channels, because it moves
    // where the player is actually aiming rather than just the gun on screen.
    // The pistol carries the baseline the spring was tuned against; the
    // SPAS-12 and M82 kick two to three times as hard, which is most of what
    // makes a slow, heavy weapon feel slow and heavy.
    //
    // Weapons carry no `model`: `game/weaponMesh.js` builds each silhouette
    // from primitives, so the roster no longer depends on `props.glb` — which
    // also retires the UNKNOWN-provenance row `ASSET_LICENSES.md` carries for
    // `Gun_02`/`Gun_03`. `color` and `scale` still drive the build, and
    // `sound` is a name from `AUDIO_NAMES` in `game/assets.js`.
    weapons: {
      // One multiplier over every viewmodel, on top of each weapon's own
      // `scale`. The builders in `game/weaponMesh.js` work in roughly real
      // proportions — an M82 really is six times an M9 — and real proportions
      // are wrong for a gun held 0.55 m from the camera, where the big ones
      // would fill the screen. This is the knob to turn if the weapons look
      // too large or too small in the hand; it changes nothing about how they
      // shoot.
      viewmodelScale: 0.5,
      order: ['pistol', 'ak47', 'm4a1', 'spas12', 'm82', 'rpg7'],
      types: {
        pistol: {
          name: 'M9', blurb: 'Sidearm. Accurate, endless reach, unspectacular.',
          dmg: 14, rate: 6, range: 45, spreadDeg: 0.35, pellets: 1,
          coneDegTouch: 7,
          recoil: { impulse: 46.5, viewBackM: 0.085, viewUpM: 0.022, viewPitchDeg: 7.0, camPitchDeg: 1.0 },
          color: 0xcfd4dc, scale: 1.0, sound: 'pistol-shot-1',
        },
        ak47: {
          name: 'AK-47', blurb: 'Hits hard, wanders wide. Punishing past mid range.',
          dmg: 13, rate: 8, range: 40, spreadDeg: 3.5, pellets: 1,
          coneDegTouch: 7,
          recoil: { impulse: 46.5, viewBackM: 0.1148, viewUpM: 0.0297, viewPitchDeg: 9.45, camPitchDeg: 1.12 },
          color: 0x8a5a2b, scale: 1.15, sound: 'gunfire',
        },
        m4a1: {
          name: 'M4A1', blurb: 'The easiest to land, and the slowest to kill.',
          dmg: 8, rate: 10, range: 38, spreadDeg: 2.8, pellets: 1,
          coneDegTouch: 7,
          recoil: { impulse: 46.5, viewBackM: 0.068, viewUpM: 0.0176, viewPitchDeg: 5.6, camPitchDeg: 0.93 },
          color: 0x4a4f57, scale: 1.05, sound: 'pistol-shot-2',
        },
        spas12: {
          name: 'SPAS-12', blurb: 'Nine pellets. Devastating close, useless far.',
          dmg: 7, rate: 1.5, range: 16, spreadDeg: 9, pellets: 9,
          coneDegTouch: 12,
          recoil: { impulse: 46.5, viewBackM: 0.221, viewUpM: 0.0572, viewPitchDeg: 18.2, camPitchDeg: 1.56 },
          color: 0x2f3540, scale: 1.25, sound: 'cannon-shot-1',
        },
        m82: {
          name: 'M82', blurb: 'One shot, one kill, straight through the queue.',
          dmg: 110, rate: 0.8, range: 80, spreadDeg: 0, pellets: 1, pierce: 3,
          coneDegTouch: 4,
          recoil: { impulse: 46.5, viewBackM: 0.272, viewUpM: 0.0704, viewPitchDeg: 22.4, camPitchDeg: 1.77 },
          color: 0x6d7b52, scale: 1.4, sound: 'sniper-shot-1',
        },
        rpg7: {
          name: 'RPG-7', blurb: 'Travels, then removes the crowd around it.',
          dmg: 60, rate: 0.45, range: 60, spreadDeg: 1.0, pellets: 1,
          coneDegTouch: 7,
          recoil: { impulse: 46.5, viewBackM: 0.306, viewUpM: 0.0792, viewPitchDeg: 25.2, camPitchDeg: 1.91 },
          projSpeed: 30, splash: 4.5, splashDmg: 45,
          color: 0x3d5a3d, scale: 1.5, sound: 'explosion-metal',
        },
      },
    },
  },

  enemies: {
    // Speeds sit BELOW `player.speed` (4.0) on purpose. They used to be 4.1-4.3,
    // so every enemy outran the player with no sprint to escape with — you
    // could never break contact, which is what made a wave feel frantic rather
    // than tense. The margin is small: backing off works, standing still does
    // not. `tungtung`'s `lunge` closing burst is a fixed distance and does NOT
    // scale with speed, so it grew proportionally more dangerous here.
    cap: 35,

    // Walk cycle for the voxel enemies. `phase` is measured in STRIDES and
    // accumulates as `speed * stepsPerMetre * dt`, so cadence rises with how
    // fast a thing is actually moving — it used to advance at a flat 1 Hz
    // regardless of speed, which is a large part of why they read as sliding.
    //
    // A stride is two footfalls, so the vertical bob runs at twice the stride
    // frequency while the roll and sway run at once per stride. That mismatch
    // is what makes a gait read as weight shifting from foot to foot rather
    // than as a body vibrating.
    // Weapons the enemies carry. A tier is chosen by wave, so later waves are
    // genuinely more dangerous rather than just differently dressed — this is
    // damage scaling on top of `waveCurve.hpMulPerWave`, not instead of it.
    //
    // `armedShare` is the fraction of SHAMBLERS that spawn as gunmen. It ramps
    // slowly and caps well below half on purpose: shamblers are the pressure
    // that makes the player move, and replacing too many of them with
    // stationary shooters removes exactly that. This is the number to turn if
    // late waves start feeling like a shooting gallery.
    //
    // `tungtung` is a flat sprite billboard, not a mesh, so it can hold
    // nothing and stays melee.
    weapons: {
      // Chosen by the highest `from` that is <= the wave number.
      tiers: [
        // `scrap` deliberately reproduces the spitter's own type-def stats
        // exactly (dmg 6 / cooldown 1.8 / projSpeed 14 / range 12). Ranged
        // types resolve a tier unconditionally, so anything else here would be
        // a silent balance change to early spitters rather than an upgrade
        // path. The tiers above it are the upgrades.
        { id: 'scrap', from: 1, dmg: 6, cooldown: 1.8, projSpeed: 14, range: 12, color: 0x8a8a8a },
        { id: 'pistol', from: 6, dmg: 9, cooldown: 1.6, projSpeed: 18, range: 15, color: 0xcfd4dc },
        { id: 'smg', from: 12, dmg: 11, cooldown: 1.1, projSpeed: 22, range: 17, color: 0x4a4f57 },
        { id: 'rifle', from: 19, dmg: 14, cooldown: 0.9, projSpeed: 26, range: 20, color: 0x6d7b52 },
      ],
      armedShare: { from: 7, start: 0.15, perWave: 0.02, max: 0.40 },
      // Where the gun sits relative to the body, and how big it draws.
      hold: { forward: 0.35, side: 0.28, height: 0.55, scale: 0.85 },
    },

    gait: {
      stepsPerMetre: 0.55, // ~1.9 strides/s at a 3.4 m/s shambler
      bobAmp: 0.06,        // metres, twice per stride
      rollRad: 0.10,       // side-to-side roll, once per stride
      leanFwdRad: 0.13,    // constant forward lean while moving
      swayM: 0.05,         // lateral weight shift, once per stride
      squashAmp: 0.05,     // heel-strike compression, twice per stride
    },
    separationRadius: 1.2,
    separationForce: 3,
    // Hit reaction: every point of damage shoves the body back along the
    // shot direction, staggers its advance and tilts it away from the hit.
    // `speed` is the impulse a `refDmg` hit lands (one pistol shot), scaled
    // per type by `knockbackScale` below.
    knockback: {
      speed: 3.0, refDmg: 12, maxSpeed: 8, decayS: 0.1, stopSpeed: 0.2,
      tiltRad: 0.55, squash: 0.16, staggerDamp: 0.6,
    },
    types: {
      shambler: {
        render: 'voxel', model: 'zed_1', hp: 30, speed: 3.4, kind: 'melee',
        dmg: 8, range: 1.6, cooldown: 1.0, energy: 10, radius: 0.5, hitHeight: 1.8,
        knockbackScale: 1,
      },
      spitter: {
        render: 'voxel', model: 'zed_3', hp: 24, speed: 3.5, kind: 'ranged',
        dmg: 6, range: 12, keepDistance: 9, preferPlayerRange: 16, cooldown: 1.8,
        projSpeed: 14, energy: 14, radius: 0.5, hitHeight: 1.8,
        knockbackScale: 1.15,
      },
      tungtung: {
        render: 'sprite', sprite: 'tungtung', height: 2.2, hp: 110, speed: 3.3,
        kind: 'melee', dmg: 18, range: 2.0, cooldown: 1.4, lunge: 3.0, energy: 30,
        radius: 0.6, hitHeight: 2.2, knockbackScale: 0.45,
      },
    },

    // Size variants. Every spawn rolls one of these, so a wave mixes darting
    // runts with slow heavies instead of a row of identical bodies. `size`
    // scales the model AND the hitbox together — a large one really is a bigger
    // target — while `knockback` moves opposite to it so a heavy is not flung
    // across the arena by a shotgun.
    //
    // `energy` is deliberately NOT scaled: `core/waves.js#waveEnergyTotal`
    // multiplies `spawn.n * type.energy` knowing nothing about variants, and
    // `test/waves.test.js` pins wave 1's total to the gun turret's cost. Paying
    // variable energy per kill would quietly break that whole economy anchor.
    //
    // `weights` drives the roll and must be same-length as `order`. The roll is
    // gameplay, not cosmetics, so it draws from the seeded `core/rng.js` stream
    // (see `Game#_rollVariant`) — the same seed still reproduces a run.
    variants: {
      order: ['small', 'normal', 'large'],
      weights: [0.25, 0.55, 0.2],
      types: {
        small: { size: 0.7, hp: 0.5, speed: 1.15, knockback: 1.4 },
        normal: { size: 1, hp: 1, speed: 1, knockback: 1 },
        large: { size: 1.4, hp: 2.5, speed: 0.85, knockback: 0.5 },
      },
    },
  },

  bosses: {
    patapim: {
      render: 'sprite', sprite: 'patapim', height: 5.5, hp: 900, speed: 2.2,
      kind: 'melee', dmg: 25, range: 2.8, cooldown: 2.0,
      addType: 'tungtung', addEveryS: 5, maxAdds: 6, castDurationS: 1.2,
      energy: 120, coins: 25, radius: 1.4, hitHeight: 5.5,
    },
    // One boss per `run.bossEvery` waves, in `run.bossOrder`. HP roughly
    // doubles across the run while the player's DPS does not, so the later
    // fights are long enough for their mechanic to matter rather than being
    // burst down before it fires.
    //
    // Every boss shares the melee/ranged core Patapim established; the field
    // that makes each one different is its `mechanic` block, which
    // `core/bossBrain.js` reads. A boss with no `mechanic` is a plain brawler.
    lirili: {
      render: 'sprite', sprite: 'lirili', height: 5.0, hp: 1400, speed: 2.5,
      kind: 'melee', dmg: 22, range: 2.6, cooldown: 1.6,
      // Swarms rather than Patapim's heavies: more, weaker, faster.
      addType: 'shambler', addEveryS: 3.0, maxAdds: 10, castDurationS: 0.9,
      energy: 150, coins: 35, radius: 1.3, hitHeight: 5.0,
    },
    bombardiro: {
      render: 'sprite', sprite: 'bombardiro', height: 5.8, hp: 2000, speed: 1.9,
      kind: 'ranged', dmg: 20, range: 20, keepDistance: 12, cooldown: 1.5,
      projSpeed: 16,
      energy: 190, coins: 45, radius: 1.5, hitHeight: 5.8,
      // Ground denial: pools that punish standing still, so the fight is
      // about being pushed off the ground you want rather than about dps.
      mechanic: {
        kind: 'groundDenial',
        everyS: 4.0, radius: 3.2, durationS: 6.0, dmgPerS: 14, maxZones: 4,
      },
    },
    tralalero: {
      render: 'sprite', sprite: 'tralalero', height: 5.2, hp: 2800, speed: 2.2,
      kind: 'melee', dmg: 30, range: 3.0, cooldown: 1.8,
      energy: 240, coins: 55, radius: 1.4, hitHeight: 5.2,
      // Charges: a telegraphed wind-up, then a fast straight-line dash. The
      // wind-up is the whole fight — it is the window to get out of the lane.
      mechanic: {
        kind: 'dash',
        everyS: 5.0, windupS: 0.9, speed: 14, durationS: 0.7,
        dmg: 45, minRange: 6,
      },
    },
    assassino: {
      render: 'sprite', sprite: 'assassino', height: 5.4, hp: 3800, speed: 2.4,
      kind: 'melee', dmg: 26, range: 2.8, cooldown: 1.4,
      addType: 'tungtung', addEveryS: 6, maxAdds: 5, castDurationS: 1.0,
      energy: 320, coins: 80, radius: 1.4, hitHeight: 5.4,
      // The finale: each phase turns on another boss's trick, so the last
      // fight tests everything the run taught. Thresholds are fractions of
      // max HP, applied in order as it drops.
      mechanic: {
        kind: 'phases',
        phases: [
          { belowHpFrac: 1.00, speedMul: 1.0, cooldownMul: 1.0 },
          { belowHpFrac: 0.66, speedMul: 1.25, cooldownMul: 0.8, adds: true },
          { belowHpFrac: 0.33, speedMul: 1.5, cooldownMul: 0.6, adds: true, enrage: true },
        ],
      },
    },
  },

  turrets: {
    hp: 200,
    // A turret shot never removes more than this fraction of a target's *max*
    // HP, so every enemy takes at least three turret hits to go down — not
    // even a maxed cannon's 85 splash deletes a 30hp shambler. Turrets soften
    // and stagger; the kill is meant to stay the player's. Enforced by
    // `core/turretLogic.js`'s `turretHitDamage`, which `game/Enemies.js`
    // applies to every `source: 'turret'` hit (direct and splash alike).
    maxDamageFracPerHit: 1 / 3,
    repair: { costPerHpMissing: 0.15, minCost: 5 },
    order: ['gun', 'tesla', 'cannon'],
    types: {
      gun: {
        cost: 50, range: 14, dmg: 10, rate: 2.0, base: 'AmmoBox_5', color: 0x4fa3ff,
        levels: [{}, { dmg: 15, rate: 2.5 }, { dmg: 22, rate: 3.0, range: 16 }],
        upgradeCost: [40, 60],
      },
      tesla: {
        cost: 70, range: 6, dmg: 4, rate: 4.0, slow: 0.4, slowDurS: 0.5,
        base: 'AttachedBoxes', color: 0xb36bff,
        levels: [{}, { dmg: 6, slow: 0.5 }, { dmg: 9, slow: 0.6, range: 7 }],
        upgradeCost: [50, 75],
      },
      cannon: {
        cost: 90, range: 18, dmg: 40, rate: 0.6, splash: 2.5,
        base: 'AttachedBoxes', color: 0xff8c42,
        levels: [{}, { dmg: 60 }, { dmg: 85, splash: 3.2 }],
        upgradeCost: [70, 100],
      },
    },
  },

  build: { durationS: 20, refundEnergyPerS: 0.5, startEnergy: 0 },

  combo: {
    windowS: 3,
    tiers: [
      { kills: 3, coins: 1 },
      { kills: 5, coins: 3 },
      { kills: 8, coins: 8 },
      { kills: 12, coins: 15 },
      { kills: 20, coins: 30 },
    ],
  },

  // The wave table is GENERATED, not authored — see `core/waves.js#waveDef`.
  // Twenty-five hand-written entries would be unmaintainable, and retuning
  // difficulty would mean editing every one of them; this way the whole curve
  // is a handful of numbers.
  //
  // Two constraints the generator must satisfy, both test-enforced:
  //
  //   * Wave 1 is exactly `baseCount` shamblers and nothing else, because
  //     `test/waves.test.js` pins wave 1's total energy to the gun turret's
  //     cost (5 kills x 10 energy = 50). That guarantees the player can afford
  //     exactly one turret after their first wave.
  //   * Every wave's `maxAlive` is clamped to `enemies.cap`. Exceeding the
  //     pool makes `Enemies#spawn` return -1 and the enemy is silently lost
  //     while the scheduler still counts it as emitted.
  //
  // `maxAlive` is a concurrency throttle, not a total: the scheduler holds
  // entries back at the cap and retries them. So `count` sets how LONG a wave
  // runs and `maxAlive` sets how DENSE it is, and they tune independently.
  waveCurve: {
    baseCount: 5,        // wave 1 total; pinned by the economy test above
    countGrowth: 1.17,   // geometric, so wave 25 is a long haul without a cliff
    countMax: 90,        // sanity ceiling on a single wave's length

    maxAliveBase: 8,
    maxAliveGrowth: 1.075,

    hpMulBase: 1.0,
    hpMulPerWave: 0.035, // +3.5%/wave -> ~1.84x by wave 25

    // Spawn interval tightens as the run goes on, floored so late waves stay
    // readable rather than becoming a wall.
    everyS: { base: 1.5, perWave: -0.035, min: 0.55 },

    // The mix. `from` is the first wave a type appears; `weight` is its share
    // of the roster once it has. Shamblers stay the backbone — they are the
    // pressure that makes the player move, and a wave that is mostly ranged
    // enemies turns the game into a shooting gallery.
    //
    // `everySMul` scales `everyS` for that type alone. The hand-written table
    // this generator replaced gave each type its own interval — at wave 10 a
    // shambler every 0.8s but a tungtung every 3.5s — and a single shared
    // interval would have quietly quadrupled the rate the heavy arrives at.
    // The multipliers below reproduce the old table's ratios.
    mix: [
      { enemy: 'shambler', from: 1, weight: 1.00, everySMul: 1.0 },
      { enemy: 'spitter', from: 3, weight: 0.42, everySMul: 1.6 },
      { enemy: 'tungtung', from: 4, weight: 0.20, everySMul: 4.4 },
    ],
  },

  run: {
    finalWave: 25,
    // `bossEvery` finally does something: it was dead config that nothing
    // read, because boss waves were hand-marked in the old literal table.
    // `core/waves.js` now derives them, so waves 5/10/15/20/25 each take the
    // next entry in `bossOrder`.
    bossEvery: 5,
    bossOrder: ['patapim', 'lirili', 'bombardiro', 'tralalero', 'assassino'],
    activeGates: 2,
    reviveOncePerRun: true,
  },

  save: { key: 'arenadefense.v1', maxCoins: 1e9 },

  touch: { joystickRadiusPx: 56, deadzone: 0.18, saturation: 0.92 },

  sprites: { bobHz: 2.2, bobAmp: 0.08, squash: 0.06, flashS: 0.12, shadowOpacity: 0.35 },

  // Shot feedback. `impact` is what a shot that hits no enemy leaves behind on
  // the arena floor or wall — without it a miss produces no visible result at
  // all and reads as though the gun never fired.
  effects: {
    muzzleFlash: true,
    impact: { groundColor: 0x9b8b7a, wallColor: 0x8f8a92, count: 5 },
    explosion: { color: 0xffa347, count: 28, soundMinIntervalS: 0.08 },
  },

  // The player's rocket, the one weapon that travels instead of hitting
  // instantly. `cap` is generous: the RPG-7 fires at 0.45/s with under two
  // seconds of flight, so one in the air is typical.
  projectiles: { cap: 16, radius: 0.12, length: 0.55 },

  timing: { fixedStep: 1 / 60, maxFrameDt: 0.1, waveClearDelayS: 1.5, deathScreenDelayS: 1.0 },

  platform: { pokiInitTimeoutMs: 4000, adsEnabled: true },

  credits: 'Voxel zombies & graveyard: Max Parata (CC BY-ND). Rocks: Quaternius (CC0). UI SFX: lolurio (CC BY 4.0). Font: Lilita One (OFL). See ASSET_LICENSES.md',
}));
