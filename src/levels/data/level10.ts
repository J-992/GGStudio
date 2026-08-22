import type { LevelDef } from "../types";
import { pat, rep, seq, slice, solidRun } from "../helpers";

const E = ".....";

export const level10: LevelDef = {
  name: "LEASH",
  hints: [{ atSlice: 1, text: "FAR APART MEANS HARD PULL" }],
  slices: seq(
    solidRun(10),
    rep(8, { f: pat("#..#.") }),
    rep(12, { f: pat("#...#") }),
    slice({ f: E }),
    solidRun(1),
    slice({ f: E }),
    rep(8, { f: pat("#...#") }),
    rep(6, { f: pat("###.#") }),
    seq(
      solidRun(2), slice({ f: E }), solidRun(2), slice({ f: E }),
      solidRun(2), slice({ f: E }),
    ),
    solidRun(14),
  ),
};
