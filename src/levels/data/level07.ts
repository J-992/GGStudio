import type { LevelDef } from "../types";
import { pat, rep, seq, solidRun } from "../helpers";

const E = ".....";

export const level07: LevelDef = {
  name: "SKYLINE",
  hints: [{ atSlice: 4, text: "UP THE WALLS — THE CEILING CAN HOLD YOU" }],
  slices: seq(
    solidRun(10),
    rep(8, { f: pat(E) }),
    rep(8, { f: pat(E), l: pat(E) }),
    rep(6, { f: pat(E), l: pat(E), r: pat(E) }),
    solidRun(6),
    rep(2, { c: pat(E) }),
    solidRun(8),
    rep(12, { c: pat(E) }),
    solidRun(8),
    rep(12, { l: pat(E), r: pat(E) }),
    solidRun(14),
  ),
};
