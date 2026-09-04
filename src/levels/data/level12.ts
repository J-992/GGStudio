import type { LevelDef } from "../types";
import { pat, rep, seq, solidRun } from "../helpers";

const E = ".....";

export const level12: LevelDef = {
  name: "CROSSCURRENT",
  hints: [
    { atSlice: 30, text: "THE BELT IS AIMING YOU AT THE WALL — GO WITH IT" },
    { atSlice: 60, text: "BELTS CLIMB WALLS" },
  ],
  slices: seq(
    solidRun(10),
    rep(6, { f: pat(">>>>>") }),
    rep(3, { f: pat("...##") }),
    solidRun(6),
    rep(6, { f: pat("<<<<<") }),
    rep(3, { f: pat("##...") }),
    solidRun(8),
    rep(8, { f: pat(">>>>>") }),
    rep(12, { f: E, c: E, l: E }),
    rep(6, { f: E, c: E, l: E, r: pat(">>>>>") }),
    rep(6, { f: E, c: E, l: E, r: pat("..###") }),
    rep(8, { f: pat("...##"), c: E, l: E }),
    rep(8, { f: pat("...##"), r: E, c: E, l: E }),
    solidRun(14),
  ),
};
