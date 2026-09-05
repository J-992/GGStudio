import type { LevelDef } from "../types";
import { pat, rep, seq, solidRun } from "../helpers";

const E = ".....";

export const level06: LevelDef = {
  name: "TWO TURN",
  hints: [
    { atSlice: 20, text: "KEEP CLIMBING — THE CEILING HOLDS YOU TOO" },
    { atSlice: 50, text: "NOW WALK IT BACK DOWN" },
  ],
  slices: seq(
    solidRun(10),
    rep(4, { f: pat("...##") }),
    rep(16, { f: E, l: E }),
    rep(4, { f: E, l: E, r: pat(".####") }),
    rep(4, { f: E, l: E, r: pat("..###") }),
    rep(10, { f: E, r: E, l: E }),
    rep(6, { f: E, l: E }),
    rep(10, { f: E, c: E, l: E }),
    rep(8, { f: pat("...##"), c: E, l: E }),
    rep(6, { f: pat("...##"), r: E, c: E, l: E }),
    solidRun(14),
  ),
};
