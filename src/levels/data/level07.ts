import type { LevelDef } from "../types";
import { pat, rep, seq, solidRun } from "../helpers";

const E = ".....";

export const level07: LevelDef = {
  name: "SKYLINE",
  hints: [
    { atSlice: 24, text: "THE WALL HAS HOLES TOO" },
    { atSlice: 52, text: "THE CEILING IS THE ONLY WAY ON" },
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
