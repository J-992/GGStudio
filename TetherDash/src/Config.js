// All tuning in one place. World units: x = lateral, y = height, z = forward.
// One unit is roughly a runner's width; the standard floor is 6 units wide.
const CFG = {
  GAME_W: 960,
  GAME_H: 540,

  // ----- fake-3D projection -----
  HORIZON_Y: 180,      // screen y of the vanishing line
  FOCAL: 700,          // px per world unit at 1 unit of camera depth
  CAM_HEIGHT: 4.4,     // camera height above the floor
  CAM_BACK: 8.5,       // camera distance behind the runners
  NEAR: 2.0,           // near clip (camera-relative z)
  DRAW_DIST: 78,       // far clip
  FOG_START: 45,       // where course colors start fading to sky

  // ----- movement -----
  RUN_SPEED: 10,       // base forward units/sec (scaled per level)
  LAT_MAX: 6.5,        // max lateral speed
  LAT_ACCEL: 60,
  LAT_DRAG: 34,        // deceleration when no input
  AIR_CONTROL: 0.72,   // lateral authority while airborne
  GRAVITY: 30,
  JUMP_VEL: 11.2,      // full jump ≈ 2.1 units high, ≈ 0.75s of air
  JUMP_CUT: 0.5,       // early-release trim for variable jump height
  COYOTE: 0.12,
  BUFFER: 0.14,
  PAD_BOOST: 1.5,      // launch pads multiply jump velocity
  CONVEYOR_PUSH: 3.0,  // forward/backward units/sec on conveyors
  EDGE_MARGIN: 0.22,   // forgiving ledge-grab margin on platform edges

  // ----- tether (live-tunable in ?debug mode) -----
  tether: {
    slackLength: 4,        // cord hangs loose inside this distance
    warningLength: 7,      // "high tension" visual/audio state
    maxLength: 10,         // hard cap: the pair cannot separate past this
    springStrength: 9,     // accel per unit of stretch
    damping: 3.5,          // relative-velocity damping along the cord
    maxTetherForce: 55     // accel cap so the spring can never explode
  },
  ANCHOR_GRIP: 0.5,        // grounded players feel only this much lateral pull

  // ----- falling / rescue -----
  FALL_Y: -4.0,        // below this the fall is real
  RESCUE_MAX: 11,      // partner must be within this distance and grounded
  RESCUE_TIME: 0.75,   // swing-back animation seconds
  RESPAWN_FADE: 0.35,

  STUN_TIME: 0.55,     // stumble from hitting gates/gears
  STUN_KNOCKBACK: -5,  // forward-speed hit while stunned

  // ----- scoring -----
  BOLT_STAR_RATIO: 0.6,   // star 2: collect at least 60% of bolts

  // ----- character sprites -----
  // The rendered Meshy sheets frame a fixed world box with the feet on the
  // bottom edge, so they carry headroom the hand-drawn fallback does not.
  // Both anchor at the feet; only the world height of the image differs.
  SPRITE_H_MESH: 1.39,
  SPRITE_H_PROC: 1.18,
  RUNNER_FRAME_W: 200,
  RUNNER_FRAME_H: 240,
  RUNNER_FRAMES: 8,
  RUNNER_JUMP_FRAME: 7,   // narrowest leg spread of the cycle
  RUNNER_FPS: 16,

  // colors
  SKY_TOP: 0x8ecdf4, SKY_BOT: 0xd7ecfb,
  FLOOR_A: 0xffd45c, FLOOR_B: 0xffc247, FLOOR_EDGE: 0xe09a2a, FLOOR_SIDE: 0xc77f1d,
  CONV_A: 0xa7b6c9, CONV_B: 0x8b9cb1, CONV_EDGE: 0x6d7f96,
  PAD_COLOR: 0xff7ab8, WALL_COLOR: 0x7e6ff0, WALL_EDGE: 0x5e4fd0,
  TETHER_SLACK: 0x59d98c, TETHER_TENSE: 0xffd35c, TETHER_HIGH: 0xff9d42, TETHER_CRIT: 0xff5252
};
