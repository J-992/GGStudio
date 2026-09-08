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
    // `model` is a mesh from `props.glb` (only two guns exist — weapons are
    // told apart by `color`/`scale`, the same way turret heads are);
    // `sound` is a name from `AUDIO_NAMES` in `game/assets.js`.
    weapons: {
      order: ['pistol', 'ak47', 'm4a1', 'spas12', 'm82', 'rpg7'],
      types: {
        pistol: {
          name: 'M9', blurb: 'Sidearm. Accurate, endless reach, unspectacular.',
          dmg: 14, rate: 6, range: 45, spreadDeg: 0.35, pellets: 1,
          coneDegTouch: 7,
          recoil: { impulse: 46.5, viewBackM: 0.085, viewUpM: 0.022, viewPitchDeg: 7.0, camPitchDeg: 1.0 },
          model: 'Gun_03', color: 0xcfd4dc, scale: 1.0, sound: 'pistol-shot-1',
        },
        ak47: {
          name: 'AK-47', blurb: 'Hits hard, wanders wide. Punishing past mid range.',
          dmg: 13, rate: 8, range: 40, spreadDeg: 3.5, pellets: 1,
          coneDegTouch: 7,
          recoil: { impulse: 46.5, viewBackM: 0.1148, viewUpM: 0.0297, viewPitchDeg: 9.45, camPitchDeg: 1.12 },
          model: 'Gun_02', color: 0x8a5a2b, scale: 1.15, sound: 'gunfire',
        },
        m4a1: {
          name: 'M4A1', blurb: 'The easiest to land, and the slowest to kill.',
          dmg: 8, rate: 10, range: 38, spreadDeg: 2.8, pellets: 1,
          coneDegTouch: 7,
          recoil: { impulse: 46.5, viewBackM: 0.068, viewUpM: 0.0176, viewPitchDeg: 5.6, camPitchDeg: 0.93 },
          model: 'Gun_02', color: 0x4a4f57, scale: 1.05, sound: 'pistol-shot-2',
        },
        spas12: {
          name: 'SPAS-12', blurb: 'Nine pellets. Devastating close, useless far.',
          dmg: 7, rate: 1.5, range: 16, spreadDeg: 9, pellets: 9,
          coneDegTouch: 12,
          recoil: { impulse: 46.5, viewBackM: 0.221, viewUpM: 0.0572, viewPitchDeg: 18.2, camPitchDeg: 1.56 },
          model: 'Gun_02', color: 0x2f3540, scale: 1.25, sound: 'cannon-shot-1',
        },
        m82: {
          name: 'M82', blurb: 'One shot, one kill, straight through the queue.',
          dmg: 110, rate: 0.8, range: 80, spreadDeg: 0, pellets: 1, pierce: 3,
          coneDegTouch: 4,
          recoil: { impulse: 46.5, viewBackM: 0.272, viewUpM: 0.0704, viewPitchDeg: 22.4, camPitchDeg: 1.77 },
          model: 'Gun_02', color: 0x6d7b52, scale: 1.4, sound: 'sniper-shot-1',
        },
        rpg7: {
          name: 'RPG-7', blurb: 'Travels, then removes the crowd around it.',
          dmg: 60, rate: 0.45, range: 60, spreadDeg: 1.0, pellets: 1,
          coneDegTouch: 7,
          recoil: { impulse: 46.5, viewBackM: 0.306, viewUpM: 0.0792, viewPitchDeg: 25.2, camPitchDeg: 1.91 },
          projSpeed: 30, splash: 4.5, splashDmg: 45,
          model: 'Gun_02', color: 0x3d5a3d, scale: 1.5, sound: 'explosion-metal',
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

  // Wave LENGTH is set by the spawn counts; `maxAlive` is a concurrency
  // throttle, not a total. `SpawnScheduler` holds entries back when the cap is
  // reached and retries them, so raising `n` while leaving `maxAlive` alone
  // makes a wave run longer rather than get denser — and keeps every wave
  // inside `enemies.cap`, which `test/waves.test.js` enforces.
  //
  // Wave 1 is deliberately untouched: its total energy is pinned to the gun
  // turret's cost (5 kills x 10 = 50) by that same test, so the player can
  // always afford exactly one turret after it.
  waves: [
    { n: 1, hpMul: 1.0, maxAlive: 8, spawns: [{ enemy: 'shambler', n: 5, everyS: 1.5 }] }, // 5 kills x 10 energy = 50 = gun cost (test-enforced)
    { n: 2, hpMul: 1.0, maxAlive: 10, spawns: [{ enemy: 'shambler', n: 13, everyS: 1.2 }] },
    {
      n: 3, hpMul: 1.0, maxAlive: 12,
      spawns: [
        { enemy: 'shambler', n: 13, everyS: 1.2 },
        { enemy: 'spitter', n: 5, everyS: 3, startS: 4 },
      ],
    },
    {
      n: 4, hpMul: 1.1, maxAlive: 14,
      spawns: [
        { enemy: 'shambler', n: 16, everyS: 1.0 },
        { enemy: 'spitter', n: 7, everyS: 2.5, startS: 3 },
        { enemy: 'tungtung', n: 2, everyS: 6, startS: 12 },
      ],
    },
    { n: 5, hpMul: 1.0, maxAlive: 8, boss: 'patapim', spawns: [] },
    {
      n: 6, hpMul: 1.15, maxAlive: 16,
      spawns: [
        { enemy: 'shambler', n: 16, everyS: 1.0 },
        { enemy: 'spitter', n: 8, everyS: 2.2, startS: 2 },
        { enemy: 'tungtung', n: 3, everyS: 6, startS: 8 },
      ],
    },
    {
      n: 7, hpMul: 1.2, maxAlive: 18,
      spawns: [
        { enemy: 'shambler', n: 19, everyS: 0.9 },
        { enemy: 'spitter', n: 10, everyS: 2.0, startS: 2 },
        { enemy: 'tungtung', n: 5, everyS: 5, startS: 6 },
      ],
    },
    {
      n: 8, hpMul: 1.3, maxAlive: 22,
      spawns: [
        { enemy: 'shambler', n: 13, everyS: 1.0 },
        { enemy: 'spitter', n: 13, everyS: 1.6, startS: 1 },
        { enemy: 'tungtung', n: 6, everyS: 4, startS: 5 },
      ],
    },
    {
      n: 9, hpMul: 1.4, maxAlive: 26,
      spawns: [
        { enemy: 'shambler', n: 22, everyS: 0.8 },
        { enemy: 'spitter', n: 13, everyS: 1.5, startS: 2 },
        { enemy: 'tungtung', n: 8, everyS: 4, startS: 4 },
      ],
    },
    {
      n: 10, hpMul: 1.5, maxAlive: 30,
      spawns: [
        { enemy: 'shambler', n: 19, everyS: 0.8 },
        { enemy: 'spitter', n: 16, everyS: 1.3, startS: 1 },
        { enemy: 'tungtung', n: 11, everyS: 3.5, startS: 3 },
      ],
    },
  ],

  run: { finalWave: 10, bossEvery: 5, activeGates: 2, reviveOncePerRun: true },

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
