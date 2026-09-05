import type { LevelDef } from "../types";
import { pat, rep, seq, solidRun } from "../helpers";

const E = ".....";

export const level07: LevelDef = {
  name: "SKYLINE",
  hints: [
    { atSlice: 18, text: "THE WALL NARROWS TOO — FOLLOW THE PANELS" },
    { atSlice: 56, text: "KEEP CLIMBING — THE CEILING IS THE NEXT FLOOR" },
  ],
  slices: seq(
    solidRun(10),
    rep(4, { f: pat("...##"), c: E, l: E }),
    rep(10, { f: E, c: E, l: E }),
    rep(6, { f: E, c: E, l: E, r: pat("####.") }),
    rep(6, { f: E, c: E, l: E, r: pat(".####") }),
    rep(6, { f: E, c: E, l: E, r: pat("..###") }),
    rep(6, { f: E, c: E, l: E, r: pat(".####") }),
    rep(6, { f: E, c: E, l: E, r: pat("####.") }),
    rep(10, { f: E, c: E, l: E }),
    rep(4, { f: E, l: E, r: pat("..###") }),
    rep(8, { f: E, r: E, l: E }),
    rep(4, { f: E, r: E, l: E, c: pat("##.##") }),
    rep(6, { f: E, r: E, l: E }),
    rep(6, { f: E, l: E, c: pat("..###") }),
    rep(8, { f: E, l: E, c: E }),
    rep(8, { f: pat("...##"), l: E, c: E }),
    rep(8, { f: pat("...##"), r: E, l: E, c: E }),
    solidRun(14),
  ),
};
