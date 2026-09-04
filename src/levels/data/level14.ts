import type { LevelDef } from "../types";
import { pat, rep, seq, solidRun } from "../helpers";
import { voidRun } from "../sections";

export const level14: LevelDef = {
  name: "FERRY",
  hints: [
    { atSlice: 8, text: "PAD OUT, LAND, THEN TAKE THE FERRY" },
    { atSlice: 56, text: "TWO FERRIES, OPPOSITE SWINGS" },
  ],
  slices: seq(
    solidRun(10),
    rep(2, { f: pat("^^^^^") }),
    voidRun(3),
    solidRun(6),
    rep(5, { f: pat(".===.") }),
    solidRun(8),
    rep(4, { f: pat(".===.") }),
    rep(3, { f: pat(".###.") }),
    rep(4, { f: pat(".===.") }),
    solidRun(8),
    rep(2, { f: pat("^^^^^") }),
    voidRun(3),
    solidRun(6),
    rep(4, { f: pat("..=..") }),
    solidRun(6),
    rep(5, { f: pat(".===.") }),
    solidRun(16),
  ),
};
