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
    rep(4, { f: pat("...##") }),
    rep(12, { f: E }),
    rep(6, { f: E }),
    rep(4, { f: E }),
    rep(4, { f: E, r: pat(".===.") }),
    rep(4, { f: E, r: pat(".####") }),
    rep(4, { f: E, r: pat("..###") }),
    rep(10, { f: E, r: E }),
    rep(4, { f: E, r: E }),
    rep(4, { f: E, r: E, c: pat(".===.") }),
    rep(4, { f: E, r: E, c: pat("###..") }),
    rep(10, { f: E, r: E, c: E }),
    rep(4, { f: E, r: E, c: E }),
    rep(4, { f: E, r: E, c: E, l: pat(".===.") }),
    rep(4, { f: E, r: E, c: E, l: pat("####.") }),
    rep(4, { f: E, r: E, c: E, l: pat("###..") }),
    rep(4, { f: pat("##..."), r: E, c: E, l: pat("###..") }),
    rep(8, { f: pat("##..."), l: E, r: E, c: E }),
    rep(4, { f: pat(".===.") }),
    solidRun(16),
  ),
};
