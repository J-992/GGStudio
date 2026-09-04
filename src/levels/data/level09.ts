import type { LevelDef } from "../types";
import { pat, rep, seq, solidRun } from "../helpers";
import { voidRun } from "../sections";

// ACT III — launch pads and the rope between you.
export const level09: LevelDef = {
  name: "SLINGSHOT",
  hints: [
    { atSlice: 10, text: "GREEN PADS THROW YOU — YOU DO NOT NEED TO JUMP" },
    { atSlice: 34, text: "NOTHING TO ROLL ONTO. THE PAD IS THE ONLY WAY OVER" },
    { atSlice: 66, text: "MIND WHERE YOU COME DOWN" },
  ],
  slices: seq(
    solidRun(12),
    rep(2, { f: pat("^^^^^") }),
    solidRun(10),
    rep(2, { f: pat("^^^^^") }),
    voidRun(3),
    solidRun(10),
    rep(2, { f: pat("^^^^^") }),
    voidRun(3),
    rep(4, { f: pat(".###.") }),
    solidRun(8),
    rep(2, { f: pat("^^^^^") }),
    voidRun(3),
    rep(5, { f: pat("..#..") }),
    solidRun(8),
    rep(2, { f: pat("^^^^^") }),
    voidRun(3),
    solidRun(16),
  ),
};
