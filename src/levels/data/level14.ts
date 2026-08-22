import type { LevelDef } from "../types";
import { pat, rep, seq, slice, solidRun } from "../helpers";

const E = ".....";

export const level14: LevelDef = {
  name: "SPIRE",
  hints: [{ atSlice: 4, text: "LAND ON THE WALL — GAP AHEAD" }],
  slices: seq(
    solidRun(10),
    rep(4, { f: E }),
    rep(2, { f: E, r: E }),
    rep(6, { f: E }),
    solidRun(10),
    rep(4, { f: E }),
    rep(2, { f: E, l: E }),
    rep(6, { f: E }),
    solidRun(12),
  ),
};
