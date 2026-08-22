import type { LevelDef } from "../types";
import { pat, rep, seq, solidRun } from "../helpers";

export const level19: LevelDef = {
  name: "LONGFALL",
  hints: [{ atSlice: 1, text: "SWING UNDER. CLIMB BACK. KEEP GOING." }],
  slices: seq(
    solidRun(10),
    rep(8, { f: pat("..#..") }),
    solidRun(6),
    rep(8, { f: pat(".#...") }),
    solidRun(6),
    rep(3, { f: pat("..#..") }),
    rep(3, { f: pat(".#...") }),
    rep(2, { f: pat("..#..") }),
    solidRun(8),
    rep(2, { f: pat(".....") }),
    solidRun(6),
    rep(10, { f: pat("..#..") }),
    solidRun(14),
  ),
};
