import type { LevelDef } from "../types";
import { pat, rep, seq, solidRun } from "../helpers";
import { voidRun } from "../sections";

const E = ".....";

export const level10: LevelDef = {
  name: "HIGH WIRE",
  hints: [
    { atSlice: 24, text: "PADS WORK ON A WALL TOO" },
    { atSlice: 60, text: "STAY CLOSE — THE ROPE DRAGS WHOEVER FALLS BEHIND" },
  ],
  slices: seq(
    solidRun(10),
    rep(4, { f: pat("...##"), c: E, l: E }),
    rep(16, { f: E, c: E, l: E }),
    rep(2, { f: E, c: E, l: E, r: pat("^^^^^") }),
    voidRun(3),
    rep(8, { f: E, c: E, l: E }),
    rep(2, { f: E, c: E, l: E, r: pat("^^^^^") }),
    voidRun(3),
    rep(10, { f: E, c: E, l: E }),
    rep(8, { f: pat("...##"), c: E, l: E }),
    rep(8, { f: pat("...##"), r: E, c: E, l: E }),
    rep(2, { f: pat("^^^^^") }),
    voidRun(3),
    solidRun(18),
  ),
};
