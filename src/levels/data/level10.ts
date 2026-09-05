import type { LevelDef } from "../types";
import { pat, rep, seq, solidRun } from "../helpers";
import { voidRun } from "../sections";

const E = ".....";

export const level10: LevelDef = {
  name: "HIGH WIRE",
  hints: [
    { atSlice: 24, text: "PADS WORK ON A WALL TOO" },
    { atSlice: 44, text: "STAY CLOSE — FOLLOW THE WALL TO THE PORTAL" },
  ],
  slices: seq(
    solidRun(10),
    rep(4, { f: pat("...##"), c: E, l: E }),
    rep(16, { f: E, c: E, l: E }),
    rep(2, { f: E, c: E, l: E, r: pat("^^^^^") }),
    voidRun(3),
    rep(18, { f: E, c: E, l: E }),
    rep(6, { f: E, c: E, l: E, r: pat(".###.") }),
    rep(8, { f: E, c: E, l: E }),
    rep(5, { f: E, c: E, l: E, r: pat(".~~~.") }),
    rep(16, { f: E, c: E, l: E }),
  ),
};
