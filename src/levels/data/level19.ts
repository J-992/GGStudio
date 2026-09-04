import type { LevelDef } from "../types";
import { pat, rep, seq, solidRun } from "../helpers";
import { voidRun } from "../sections";

const E = ".....";

export const level19: LevelDef = {
  name: "LONGFALL",
  spinners: [{ atSlice: 88, speed: 2.8 }],
  hints: [
    { atSlice: 6, text: "PAD, FERRY, BARRIER — IN THAT ORDER" },
    { atSlice: 70, text: "NO FLOOR LEFT. LIVE ON THE WALL" },
  ],
  slices: seq(
    solidRun(10),
    rep(2, { f: pat("^^^^^") }),
    voidRun(3),
    solidRun(6),
    rep(5, { f: pat(".===.") }),
    solidRun(4),
    rep(1, { f: pat("!###?") }),
    solidRun(6),
    rep(2, { f: pat("^^^^^") }),
    voidRun(3),
    solidRun(6),
    rep(4, { f: pat("..=..") }),
    solidRun(6),
    rep(6, { f: pat(">>>>>") }),
    solidRun(3),
    rep(1, { f: pat("?#!#?") }),
    solidRun(2),
    rep(3, { f: pat("~~~~~") }),
    solidRun(6),
    rep(4, { f: pat("...##"), c: E, l: E }),
    rep(12, { f: E, c: E, l: E }),
    rep(6, { f: E, c: E, l: E }),
    rep(4, { f: E, c: E, l: E }),
    rep(4, { f: E, c: E, l: E, r: pat(".===.") }),
    rep(6, { f: E, c: E, l: E, r: pat("##.##") }),
    rep(1, { f: E, c: E, l: E, r: pat("!#?#!") }),
    rep(6, { f: E, c: E, l: E, r: pat("..###") }),
    rep(8, { f: pat("..###"), c: E, l: E }),
    rep(8, { f: pat("..###"), r: E, c: E, l: E }),
    solidRun(4),
    rep(1, { f: pat("!#?#!") }),
    solidRun(5),
    rep(1, { f: pat("?#!#?") }),
    solidRun(14),
  ),
};
