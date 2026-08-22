import type { LevelDef } from "../types";
import { pat, rep, seq, slice, solidRun } from "../helpers";

const E = ".....";

export const level15: LevelDef = {
  name: "GAUNTLET",
  slices: seq(
    solidRun(8),
    slice({ f: E }), solidRun(2),
    slice({ f: E }), solidRun(2),
    slice({ f: E }), solidRun(2),
    slice({ f: E }), solidRun(2),
    slice({ f: E }), solidRun(2),
    slice({ f: E }), solidRun(2),
    slice({ f: pat("#..##") }), solidRun(1),
    slice({ f: pat("##..#") }), solidRun(1),
    slice({ f: pat("#..##") }), solidRun(1),
    rep(2, { f: E }),
    solidRun(6),
    rep(3, { f: E }),
    solidRun(14),
  ),
};
