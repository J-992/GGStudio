import type { LevelDef } from "../types";
import { pat, rep, seq, solidRun } from "../helpers";

const E = ".....";

// ACT V — everything at once, and it stops being polite.
export const level17: LevelDef = {
  name: "OVERDRIVE",
  hints: [
    { atSlice: 16, text: "THE BELT IS AIMING YOU AT A BARRIER" },
    { atSlice: 62, text: "BARRIERS ON THE WALL TOO" },
  ],
  slices: seq(
    solidRun(12),
    rep(6, { f: pat(">>>>>") }),
    solidRun(3),
    rep(1, { f: pat("###!#") }),
    rep(5, { f: pat(">>>>>") }),
    solidRun(3),
    rep(1, { f: pat("####?") }),
    solidRun(6),
    rep(6, { f: pat("<<<<<") }),
    solidRun(3),
    rep(1, { f: pat("!####") }),
    rep(5, { f: pat("<<<<<") }),
    solidRun(3),
    rep(1, { f: pat("?#!##") }),
    solidRun(6),
    rep(6, { f: pat(">>>>>") }),
    rep(10, { f: E, c: E, l: E }),
    rep(6, { f: E, c: E, l: E, r: pat(">>###") }),
    rep(3, { f: E, c: E, l: E }),
    rep(1, { f: E, c: E, l: E, r: pat("####!") }),
    rep(5, { f: E, c: E, l: E, r: pat("##<<<") }),
    rep(3, { f: E, c: E, l: E }),
    rep(1, { f: E, c: E, l: E, r: pat("!###?") }),
    rep(6, { f: E, c: E, l: E, r: pat(".####") }),
    rep(12, { c: E, l: E }),
    rep(8, { r: E, c: E, l: E }),
    rep(1, { f: pat("!#?#!") }),
    solidRun(16),
  ),
};
