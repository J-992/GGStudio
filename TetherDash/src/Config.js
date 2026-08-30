// All tuning in one place.
//
// The world is a square tube running along +z. Each of its four faces carries
// its own 2D coordinate system: `u` runs across the face, `h` rises off it, and
// the runner's own gravity always points at whichever face it is standing on.
// Face 0 is the floor, and 1/2/3 are the right wall, ceiling and left wall --
// the order you meet them walking right around the inside of the tube.
//
// One unit is roughly a runner's width; a face is TUBE_R * 2 units across.
const CFG = {
  GAME_W: 960,
  GAME_H: 540,

  // ----- fake-3D projection -----
  HORIZON_Y: 240,      // screen y of the vanishing line
  FOCAL: 620,          // px per world unit at 1 unit of camera depth
  CAM_HEIGHT: 2.6,     // camera height above the face being run on
  CAM_BACK: 9,         // camera distance behind the runner
  CAM_LEAD: 0.25,      // how much of the runner's position across the face the
                       // camera follows sideways
  NEAR: 3,             // near clip: closer than this a panel is a wall of
                       // colour across the screen and costs a fill to say it
  DRAW_DIST: 72,       // far clip
  FOG_START: 46,       // where tunnel colors start fading into the dark.
                       // Late, deliberately: a piece you cannot read from a
                       // long way off is a piece you cannot plan a flip for.

  // ----- the tube -----
  TUBE_R: 2.8,         // half-width of a face: u runs -TUBE_R .. +TUBE_R.
                       // Sized so a corner is under a second of running away
                       // -- the flip has to be a reflex, not a journey.
  RING_LEN: 9,         // the all-four-faces coupler Track welds before every
                       // piece. Long enough to walk from any point on a face to
                       // either of its corners, which is what makes "you can
                       // always reach the route this piece wants" true.
  STRIP: 3,            // depth of one drawn panel strip

  // ----- movement -----
  RUN_SPEED: 11,       // forward units/sec at the start of a run
  SPEED_MAX: 21,
  SPEED_RAMP: 0.0059,  // + units/sec per metre travelled
  LAT_MAX: 8,          // max speed across the face
  LAT_ACCEL: 76,
  LAT_DRAG: 50,        // deceleration when no input
  AIR_CONTROL: 0.8,    // lateral authority while airborne
  GRAVITY: 34,
  JUMP_VEL: 11.6,      // full jump ~ 2.0 units high, ~ 0.68s of air
  JUMP_CUT: 0.5,       // early-release trim for variable jump height
  COYOTE: 0.13,
  BUFFER: 0.15,
  PAD_BOOST: 1.6,      // launch pads multiply jump velocity
  EDGE_MARGIN: 0.22,   // forgiving ledge-grab margin on panel edges

  // ----- flipping between faces -----
  // Stepping past a corner (|u| > TUBE_R) puts the runner on the next face
  // round the tube, if that face has a panel there. The camera rolls to keep
  // the new face underfoot, which is what makes a wall read as a floor.
  ROLL_RATE: 11,       // how fast the camera catches up to the new face
  FLIP_GRACE: 0.12,    // no second flip for this long -- one corner at a time

  // ----- falling -----
  FALL_H: -6.5,        // this far below a face, the fall is unrecoverable

  STUN_TIME: 0.5,      // stumble from clipping a hazard
  STUN_SLOW: 0.45,     // ...and it costs this fraction of forward speed

  // ----- run economy -----
  BOLT_SCORE: 10,      // score per bolt; distance in metres is the rest
  REVIVE_BACK: 14,     // metres rewound when a rewarded revive is taken

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

  // ----- colors -----
  // Dark panels, neon edges. The panel a runner is standing on is the least
  // bright thing on screen, which is the only way a bright character reads
  // against a surface that fills half the frame -- and it leaves holes,
  // which are pure void, still darker than any panel.
  VOID_TOP: 0x070b1c, VOID_BOT: 0x101736,
  FOG_COLOR: 0x16203f,   // what distant panels fade toward -- lighter than the
                         // void, so the tunnel stays legible to the far clip
  // per-face body colors and the neon that outlines them, indexed by face:
  // amber floor, teal right wall, pink ceiling, violet left wall, so a glance
  // at the edges says which way is currently down.
  FACE_A: [0x4a3f22, 0x1d4a45, 0x4d2340, 0x2f2a5e],
  FACE_B: [0x3d3419, 0x173d39, 0x421e37, 0x272251],
  FACE_EDGE: [0xffd45c, 0x5ef0cf, 0xff8fc4, 0xa694ff],
  // the coupler ring: near-black with a cold rim, so the one place you can
  // always change face announces itself without competing with the neon
  RING_A: 0x14293f, RING_B: 0x0f2134, RING_EDGE: 0x59e0ff,
  PANEL_LIP: 0x080d1c,
  PAD_COLOR: 0xff7ab8,
  CORD_COLOR: 0x59d98c,
  CORD_FLIP: 0xffd35c
};
