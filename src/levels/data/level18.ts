import type { LevelDef } from "../types";
import { pat, rep, seq, solidRun } from "../helpers";

const E = ".....";

export const level18: LevelDef = {
  name: "HELIX",
  hints: [{ atSlice: 4, text: "AROUND THE WORLD AND BACK" }],
  slices: seq(
    solidRun(10),
    rep(6, { f: E }),
    rep(6, { f: E, l: E }),
    rep(6, { f: E, l: E, r: E }),
    solidRun(6),
    rep(2, { c: E }),
    solidRun(6),
    rep(10, { c: E }),
    solidRun(6),
    rep(12, { l: E, r: E }),
    solidRun(8),
    rep(2, { f: E }),
    solidRun(4),
    rep(2, { f: E }),
    solidRun(4),
    rep(3, { f: E }),
    solidRun(14),
  ),
};
