import type { LevelDef } from "../types";
import { pat, rep, seq, slice, solidRun } from "../helpers";

const E = ".....";

export const level15: LevelDef = {
  name: "GAUNTLET",
  hints: [{ atSlice: 20, text: "OFF THE FLOOR - KEEP THE BEAT ON THE WALL" }],
  slices: seq(
    solidRun(8),
    slice({ f: E }), solidRun(2),
    slice({ f: E }), solidRun(2),
    slice({ f: E }), solidRun(2),
    slice({ f: E }), solidRun(2),
    rep(10, { f: E }),
    rep(1, { f: E, r: E }),
    rep(2, { f: E }),
    rep(1, { f: E, r: E }),
    rep(2, { f: E }),
    rep(1, { f: E, r: E }),
    rep(2, { f: E }),
    rep(1, { f: E, r: E }),
    rep(2, { f: E }),
    rep(10, { r: E }),
    rep(2, { f: pat("#..##") }),
    rep(2, { f: pat("##..#") }),
    rep(2, { f: E }),
    solidRun(14),
  ),
};
