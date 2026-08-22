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
