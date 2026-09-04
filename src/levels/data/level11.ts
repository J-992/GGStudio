import type { LevelDef } from "../types";
import { pat, rep, seq, solidRun } from "../helpers";

export const level11: LevelDef = {
  name: "BELTWAY",
  hints: [
    { atSlice: 8, text: "BLUE PANELS CARRY YOU SIDEWAYS — LEAN AGAINST THEM" },
    { atSlice: 44, text: "LET THE BELT DO THE WORK" },
  ],
  slices: seq(
    solidRun(10),
    rep(6, { f: pat(">>>>>") }),
    solidRun(8),
    rep(6, { f: pat("<<<<<") }),
    solidRun(8),
    rep(5, { f: pat(">>>##") }),
    rep(4, { f: pat("...##") }),
    solidRun(8),
    rep(5, { f: pat("##<<<") }),
    rep(4, { f: pat("##...") }),
    solidRun(6),
    rep(6, { f: pat("<<<<<") }),
    rep(3, { f: pat("###..") }),
    solidRun(14),
  ),
};
