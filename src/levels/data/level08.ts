import type { LevelDef } from "../types";
import { pat, rep, seq, solidRun } from "../helpers";

const E = ".....";

export const level08: LevelDef = {
  name: "CAROUSEL",
  hints: [
    { atSlice: 4, text: "FOUR FACES, ONE LAP" },
    { atSlice: 62, text: "ALL THE WAY AROUND — RIDE THE LAST WALL DOWN" },
  ],
  slices: seq(
    solidRun(10),
    rep(4, { f: pat("...##") }),
    rep(14, { f: E }),
    rep(4, { f: E, r: pat(".####") }),
    rep(4, { f: E, r: pat("..###") }),
    rep(10, { f: E, r: E }),
    rep(4, { f: E, r: E, c: pat("###..") }),
    rep(10, { f: E, r: E, c: E }),
    rep(4, { f: E, r: E, c: E, l: pat("####.") }),
    rep(4, { f: E, r: E, c: E, l: pat("###..") }),
    rep(4, { f: pat("##..."), r: E, c: E, l: pat("###..") }),
    rep(8, { f: pat("##..."), l: E, r: E, c: E }),
    solidRun(14),
  ),
};
