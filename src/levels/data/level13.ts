import type { LevelDef } from "../types";
import { pat, rep, seq, slice, solidRun } from "../helpers";

const E = ".....";

export const level13: LevelDef = {
  name: "FULL SEND",
  hints: [
    { atSlice: 13, text: "HOLD INTO THE WALL" },
    { atSlice: 56, text: "FLOOR GONE - WEAVE THE RIGHT WALL" },
  ],
  slices: seq(
    solidRun(8),
    slice({ f: pat("#..##") }), solidRun(1),
    slice({ f: pat("##..#") }), solidRun(1),
    slice({ f: pat("#..##") }), solidRun(1),
    slice({ f: pat("##..#") }), solidRun(1),
    rep(8, { f: E }),
    rep(2, { f: E, r: E }),
    rep(6, { f: E }),
    solidRun(8),
    rep(6, { f: pat("#...#") }),
    rep(2, { f: E }),
    solidRun(8),
    rep(4, { f: E }),
    rep(2, { f: E, r: pat("#..##") }),
    rep(2, { f: E, r: pat("##..#") }),
    rep(2, { f: E, r: E }),
    rep(2, { f: E, r: pat("#..##") }),
    rep(2, { f: E, r: pat("##..#") }),
    rep(2, { f: E }),
    solidRun(6),
    slice({ f: E }), solidRun(2),
    slice({ f: E }), solidRun(2),
    slice({ f: E }), solidRun(2),
    rep(3, { f: E }),
    solidRun(14),
  ),
};
