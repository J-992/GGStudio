import type { LevelDef } from "../types";
import { pat, rep, seq, slice, solidRun } from "../helpers";

export const level03: LevelDef = {
  name: "TENSION",
  hints: [
    { atSlice: 1, text: "DISTANCE CREATES TENSION" },
    { atSlice: 41, text: "THE TETHER PULLS YOU BACK TOGETHER" },
  ],
  slices: seq(
    solidRun(9),
    rep(12, { f: pat("##.##") }),
    rep(10, { f: pat("#...#") }),
    rep(8, { f: pat("###.#") }),
    solidRun(8),
    solidRun(3), slice({ f: pat(".....") }), solidRun(2),
    slice({ f: pat(".....") }), solidRun(2), slice({ f: pat(".....") }), solidRun(2),
    slice({ f: pat(".....") }), solidRun(2), slice({ f: pat(".....") }),
    solidRun(21),
  ),
};
void rep;
