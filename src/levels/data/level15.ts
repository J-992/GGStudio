import type { LevelDef } from "../types";
import { pat, rep, seq, solidRun } from "../helpers";

export const level15: LevelDef = {
  name: "SHUTTER LINE",
  hints: [
    { atSlice: 8, text: "RED BARRIERS KILL WHILE THEY ARE UP — READ THE RHYTHM" },
    { atSlice: 50, text: "TWO BARRIERS, ONE ALWAYS DOWN" },
  ],
  slices: seq(
    solidRun(12),
    rep(1, { f: pat("!####") }),
    solidRun(7),
    rep(1, { f: pat("####!") }),
    solidRun(7),
    rep(1, { f: pat("##!##") }),
    solidRun(7),
    rep(1, { f: pat("!###?") }),
    solidRun(7),
    rep(1, { f: pat("?###!") }),
    solidRun(7),
    rep(1, { f: pat("!#?#!") }),
    solidRun(8),
    rep(1, { f: pat("?#!#?") }),
    solidRun(6),
    rep(1, { f: pat("!#!#!") }),
    solidRun(18),
  ),
};
