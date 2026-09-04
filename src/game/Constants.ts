export const TILE = 2;
export const COLS = 5;
export const HALF = (COLS * TILE) / 2;
export const SLICE_LEN = 2;
export const SLAB_T = 0.7;

export const FIXED_DT = 1 / 120;
export const MAX_FRAME_DT = 0.05;

export const FORWARD_SPEED = 9;
export const FWD_ACC = 60;
export const LAT_MAX = 7;
export const LAT_ACC_GROUND = 62;
export const LAT_ACC_AIR = 44;

export const GRAVITY = 27;
export const JUMP_V = 8.4;
export const JUMP_HOLD_GRAVITY_MULT = 0.62;
export const JUMP_RELEASE_GRAVITY_MULT = 2.0;
export const FALL_GRAVITY_MULT = 1.18;

export const COYOTE_TIME = 0.1;
export const JUMP_BUFFER = 0.12;

export const PLAYER_HALF_W = 0.33;
export const PLAYER_HALF_H = 0.46;

export const TETHER_REST = 4.0;
export const TETHER_SPRING_K = 26;
export const TETHER_DAMP = 5.5;
export const TETHER_MAX_ACCEL = 130;
export const TETHER_HARD_MAX = 8.0;
export const TETHER_HARD_RELAX = 0.3;
export const TETHER_REEL_STEP = 0.06;
export const TETHER_VEL_CLAMP = 26;

export const KILL_DIST = 30;
export const MAX_AIR_TIME = 6;
export const SCREEN_KILL_GRACE = 0.3;

export const CRUMBLE_DELAY = 0.3;
export const ROT_HOLD_TIME = 0.12;
export const ROT_COOLDOWN = 0.45;
export const WALL_TRIGGER_DIST = 1.05;
export const ROT_ANIM_TIME = 0.24;

export const CAM_BACK = 9.5;
export const CAM_UP = 4.4;
export const LOOK_AHEAD = 6.5;
export const LOOK_UP_OFFSET = -1.1;
export const FOV_BASE = 55;

export const P1_COLOR = 0xff8a3d;
export const P2_COLOR = 0x35e0ff;

// --- Level mechanics -------------------------------------------------------
// Every mechanic below is expressed as a character inside a face pattern, so a
// level stays readable as an ASCII map. See src/levels/types.ts for the legend.

// "^" launch pad. Fires along the face normal, well past a normal jump arc.
export const LAUNCH_V = 16.5;
export const LAUNCH_REARM = 0.3;

// "<" / ">" conveyor. A constant lateral drift while grounded on the belt.
export const CONVEYOR_SPEED = 4.6;

// "=" / "+" slider. A platform tracking back and forth across its face.
// Half a tile of travel each way. That is the largest sweep where a platform
// still covers its own lane at both ends of the stroke, so a robot standing on
// the middle of a ferry is never dropped by the ferry itself — it gets shoved
// around, which is the point, but the ground does not vanish under it.
export const SLIDER_TRAVEL = TILE / 2;
export const SLIDER_PERIOD = 2.0;

// "!" / "?" shutter. A barrier that rises out of the face on a cycle and kills
// on contact. The two characters run half a cycle apart, so a pair of them
// leaves exactly one lane open at a time.
export const SHUTTER_PERIOD = 2.6;
export const SHUTTER_CLOSED_FRAC = 0.4;
export const SHUTTER_EDGE_FRAC = 0.07;
export const SHUTTER_HEIGHT = 1.9;
export const SHUTTER_LETHAL_FRAC = 0.55;
