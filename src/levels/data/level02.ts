import type { LevelDef } from "../types";
import { pat, rep, seq, solidRun } from "../helpers";

const E = ".....";
const C = "~~~~~";

export const level02: LevelDef = {
  name: "STEP UP",
  hints: [{ atSlice: 8, text: "ORANGE PANELS DROP AWAY ONCE YOU LAND — KEEP MOVING" }],
  slices: seq(
    solidRun(10),
    rep(3, { f: C }),
    solidRun(6),
    rep(2, { f: E }),
    rep(2, { f: C }),
    solidRun(6),
    rep(2, { f: pat("##.##") }),
    rep(2, { f: E }),
    rep(3, { f: C }),
    solidRun(6),
    rep(4, { f: pat("..~..") }),
    solidRun(8),
    rep(2, { f: E }),
    solidRun(8),
  ),
};
