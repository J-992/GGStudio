import type { LevelDef } from "../types";
import { faceGap } from "../sections";
import { pat, rep, seq, solidRun, slice } from "../helpers";

const E = ".....";

export const level17: LevelDef = {
  name: "OVERDRIVE",
  slices: seq(
    solidRun(8),
    slice({ f: pat("#..##") }), solidRun(2),
    slice({ f: pat("##..#") }), solidRun(2),
    slice({ f: pat("#..##") }), solidRun(2),
    rep(2, { f: E }),
    solidRun(4),
    rep(3, { f: E }),
    rep(2, { f: E, r: E }),
    rep(4, { f: E }),
    solidRun(4),
    faceGap("r", 10),
    solidRun(6),
    rep(8, { f: pat("..#..") }),
    slice({ f: E }), solidRun(2),
    slice({ f: E }), solidRun(2),
    rep(2, { f: E }),
    solidRun(14),
  ),
};
