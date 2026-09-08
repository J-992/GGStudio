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
    gun: {
      dmg: 12, rate: 6, range: 45, coneDegTouch: 7,
      // Recoil punch. `core/recoil.js` turns these into one normalized
      // spring value; `game/Player.js` multiplies that value by the
      // amplitudes below. `impulse` is normalized so a single shot peaks the
      // value at ~1.0, which makes every amplitude readable as "per shot".
      // Sustained fire at `rate` overlaps on the tail and plateaus at ~1.3x.
      recoil: {
        stiffness: 256,       // omega0 = 16 rad/s -> peaks ~4 frames after the shot
        damping: 32,          // exactly 2*omega0: critically damped, never overshoots
        impulse: 46.5,        // normalizes a single shot's peak to ~1.0
        maxValue: 1.8,        // ceiling over the ~1.3 sustained plateau
        viewBackM: 0.085,     // viewmodel slides toward the eye (base standoff 0.55)
        viewUpM: 0.022,       // and *up* -- the old code slid it down, reading as a dip
        viewPitchDeg: 7,      // muzzle-up tilt; the channel that actually sells the kick
        camPitchDeg: 1.0,     // view punch, fully self-recovering; never touches `pitch`
      },
    },
    invulnAfterReviveS: 3,
    revivePushRadius: 8,
    revivePushSpeed: 8, // m/s impulse the revive shove lands on each enemy in range.
  },

  enemies: {
    cap: 35,
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
        render: 'voxel', model: 'zed_1', hp: 30, speed: 4.2, kind: 'melee',
        dmg: 8, range: 1.6, cooldown: 1.0, energy: 10, radius: 0.5, hitHeight: 1.8,
        knockbackScale: 1,
      },
      spitter: {
        render: 'voxel', model: 'zed_3', hp: 24, speed: 4.3, kind: 'ranged',
        dmg: 6, range: 12, keepDistance: 9, preferPlayerRange: 16, cooldown: 1.8,
        projSpeed: 14, energy: 14, radius: 0.5, hitHeight: 1.8,
        knockbackScale: 1.15,
      },
      tungtung: {
        render: 'sprite', sprite: 'tungtung', height: 2.2, hp: 110, speed: 4.1,
        kind: 'melee', dmg: 18, range: 2.0, cooldown: 1.4, lunge: 3.0, energy: 30,
        radius: 0.6, hitHeight: 2.2, knockbackScale: 0.45,
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
    // stubs, data only:
    bombardiro: { stub: true, sprite: 'bombardiro', kind: 'ranged', groundDenial: true },
    tralalero: { stub: true, sprite: 'tralalero', kind: 'dash' },
    assassino: { stub: true, sprite: 'assassino', kind: 'phases' },
    lirili: { stub: true, sprite: 'lirili', kind: 'melee', adds: true },
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

  waves: [
    { n: 1, hpMul: 1.0, maxAlive: 8, spawns: [{ enemy: 'shambler', n: 5, everyS: 1.5 }] }, // 5 kills x 10 energy = 50 = gun cost (test-enforced)
    { n: 2, hpMul: 1.0, maxAlive: 10, spawns: [{ enemy: 'shambler', n: 8, everyS: 1.2 }] },
    {
      n: 3, hpMul: 1.0, maxAlive: 12,
      spawns: [
        { enemy: 'shambler', n: 8, everyS: 1.2 },
        { enemy: 'spitter', n: 3, everyS: 3, startS: 4 },
      ],
    },
    {
      n: 4, hpMul: 1.1, maxAlive: 14,
      spawns: [
        { enemy: 'shambler', n: 10, everyS: 1.0 },
        { enemy: 'spitter', n: 4, everyS: 2.5, startS: 3 },
        { enemy: 'tungtung', n: 1, everyS: 1, startS: 12 },
      ],
    },
    { n: 5, hpMul: 1.0, maxAlive: 8, boss: 'patapim', spawns: [] },
    {
      n: 6, hpMul: 1.15, maxAlive: 16,
      spawns: [
        { enemy: 'shambler', n: 10, everyS: 1.0 },
        { enemy: 'spitter', n: 5, everyS: 2.2, startS: 2 },
        { enemy: 'tungtung', n: 2, everyS: 6, startS: 8 },
      ],
    },
    {
      n: 7, hpMul: 1.2, maxAlive: 18,
      spawns: [
        { enemy: 'shambler', n: 12, everyS: 0.9 },
        { enemy: 'spitter', n: 6, everyS: 2.0, startS: 2 },
        { enemy: 'tungtung', n: 3, everyS: 5, startS: 6 },
      ],
    },
    {
      n: 8, hpMul: 1.3, maxAlive: 22,
      spawns: [
        { enemy: 'shambler', n: 8, everyS: 1.0 },
        { enemy: 'spitter', n: 8, everyS: 1.6, startS: 1 },
        { enemy: 'tungtung', n: 4, everyS: 4, startS: 5 },
      ],
    },
    {
      n: 9, hpMul: 1.4, maxAlive: 26,
      spawns: [
        { enemy: 'shambler', n: 14, everyS: 0.8 },
        { enemy: 'spitter', n: 8, everyS: 1.5, startS: 2 },
        { enemy: 'tungtung', n: 5, everyS: 4, startS: 4 },
      ],
    },
    {
      n: 10, hpMul: 1.5, maxAlive: 30,
      spawns: [
        { enemy: 'shambler', n: 12, everyS: 0.8 },
        { enemy: 'spitter', n: 10, everyS: 1.3, startS: 1 },
        { enemy: 'tungtung', n: 7, everyS: 3.5, startS: 3 },
      ],
    },
  ],

  run: { finalWave: 10, bossEvery: 5, activeGates: 2, reviveOncePerRun: true },

  save: { key: 'arenadefense.v1', maxCoins: 1e9 },

  touch: { joystickRadiusPx: 56, deadzone: 0.18, saturation: 0.92 },

  sprites: { bobHz: 2.2, bobAmp: 0.08, squash: 0.06, flashS: 0.12, shadowOpacity: 0.35 },

  timing: { fixedStep: 1 / 60, maxFrameDt: 0.1, waveClearDelayS: 1.5, deathScreenDelayS: 1.0 },

  platform: { pokiInitTimeoutMs: 4000, adsEnabled: true },

  credits: 'Voxel zombies & graveyard: Max Parata (CC BY-ND). Rocks: Quaternius (CC0). UI SFX: lolurio (CC BY 4.0). Font: Lilita One (OFL). See ASSET_LICENSES.md',
}));
