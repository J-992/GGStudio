import type { LevelDef } from "../types";
import { pat, rep, seq, solidRun } from "../helpers";

const E = ".....";

export const level18: LevelDef = {
  name: "HELIX",
  hints: [
    { atSlice: 4, text: "AROUND THE WORLD — AND THE GROUND MOVES" },
    { atSlice: 74, text: "LAST LAP" },
  ],
  slices: seq(
    solidRun(10),
    rep(4, { f: pat(".===.") }),
    solidRun(5),
    rep(4, { f: pat("...##"), c: E, l: E }),
    rep(12, { f: E, c: E, l: E }),
    rep(6, { f: E, c: E, l: E }),
    rep(4, { f: E, c: E, l: E }),
    rep(4, { f: E, c: E, l: E, r: pat("=====") }),
    rep(4, { f: E, l: E, r: pat(".####") }),
    rep(4, { f: E, l: E, r: pat("..###") }),
    rep(10, { f: E, r: E, l: E }),
    rep(4, { f: E, r: E, l: E }),
    rep(4, { f: E, r: E, l: E, c: pat("=====") }),
    rep(8, { f: E, r: E, l: E }),
    rep(8, { f: E, r: E, c: pat("###..") }),
    rep(10, { f: E, r: E, c: E }),
    rep(4, { f: E, r: E, c: E }),
    rep(4, { f: E, r: E, c: E, l: pat("=====") }),
    rep(4, { f: E, r: E, c: E }),
    rep(4, { f: E, r: E, c: E, l: pat("####.") }),
    rep(4, { f: E, r: E, c: E, l: pat("###..") }),
    rep(4, { f: pat("##..."), r: E, c: E, l: pat("###..") }),
    rep(8, { f: pat("##..."), l: E, r: E, c: E }),
    rep(4, { f: pat(".===.") }),
    solidRun(16),
  ),
};
