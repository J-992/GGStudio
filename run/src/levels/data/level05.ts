import type { LevelDef } from "../types";
import { pat, rep, seq, slice, solidRun } from "../helpers";

export const level05: LevelDef = {
  name: "WALL ROLL",
  hints: [
    { atSlice: 3, text: "STEER INTO A WALL AND HOLD — THE WALL BECOMES THE FLOOR" },
    { atSlice: 40, text: "EVERY SURFACE IS A ROUTE" },
  ],
  slices: seq(
    solidRun(12),
    rep(12, { f: pat(".....") }),
    rep(2, { f: pat("....."), l: pat(".....") }),
    rep(10, { f: pat(".....") }),
    solidRun(17),
    rep(24, { l: pat(".....") }),
    solidRun(3),
  ),
};
void slice;
