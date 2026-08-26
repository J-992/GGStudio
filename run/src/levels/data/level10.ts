import type { LevelDef } from "../types";
import { pat, rep, seq, slice, solidRun } from "../helpers";

const E = ".....";

export const level10: LevelDef = {
  name: "LEASH",
  hints: [
    { atSlice: 1, text: "FAR APART MEANS HARD PULL" },
    { atSlice: 39, text: "LONG STRETCHES SNAP BACK HARDER" },
  ],
  slices: seq(
    solidRun(10),
    rep(12, { f: E }),
    rep(4, { f: E, r: pat("#..#.") }),
    rep(4, { f: E, r: pat(".#..#") }),
    rep(4, { f: E, r: pat("#..#.") }),
    rep(3, { f: E, r: "~~~~~" }),
    rep(2, { f: E, r: E }),
    rep(8, { f: E, r: pat("#...#") }),
    rep(10, { r: E }),
    slice({ f: E }), solidRun(2),
    slice({ f: E }), solidRun(2),
    slice({ f: E }),
    solidRun(14),
  ),
};
