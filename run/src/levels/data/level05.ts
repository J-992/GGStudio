import type { LevelDef } from "../types";
import { pat, rep, seq, solidRun } from "../helpers";

const E = ".....";

// ACT II — the tunnel turns. Every wall is a floor if you commit to it.
export const level05: LevelDef = {
  name: "WALL ROLL",
  hints: [
    { atSlice: 4, text: "STEER INTO THE RIGHT WALL AND HOLD — IT BECOMES THE FLOOR" },
    { atSlice: 32, text: "STEER BACK TOWARD THE FLOOR AS IT RETURNS" },
  ],
  slices: seq(
    solidRun(12),
    rep(4, { f: pat("..###") }),
    rep(4, { f: pat("....#") }),
    rep(18, { f: E, c: E, l: E }),
    rep(8, { f: pat("...##"), c: E, l: E }),
    rep(6, { f: pat("....#"), r: E, c: E, l: E }),
    rep(6, { f: pat("...##") }),
    solidRun(16),
  ),
};
