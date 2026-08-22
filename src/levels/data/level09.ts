import type { LevelDef } from "../types";
import { pat, rep, seq, slice, solidRun } from "../helpers";

const E = ".....";

export const level09: LevelDef = {
  name: "TENSION",
  hints: [
    { atSlice: 1, text: "DISTANCE CREATES TENSION" },
    { atSlice: 28, text: "THE TETHER PULLS YOU BACK TOGETHER" },
  ],
  slices: seq(
    solidRun(9),
    rep(12, { f: E }),
    rep(6, { f: E, r: pat("#...#") }),
    rep(2, { f: E, r: E }),
    rep(6, { f: E, r: pat("#...#") }),
    rep(10, { r: E }),
    slice({ f: E }), solidRun(2),
    slice({ f: E }), solidRun(2),
    slice({ f: E }),
    solidRun(14),
  ),
};
