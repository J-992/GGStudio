import type { LevelDef } from "../types";
import { pat, rep, seq, solidRun } from "../helpers";

const E = ".....";

export const level08: LevelDef = {
  name: "CAROUSEL",
  hints: [{ atSlice: 4, text: "FOUR FLOORS — KEEP ROLLING" }],
  slices: seq(
    solidRun(8),
    rep(6, { f: pat(E) }),
    rep(4, { f: pat(E), l: pat(E) }),
    rep(6, { f: pat(E), l: pat(E), r: pat(E) }),
    solidRun(6),
    rep(2, { c: pat(E) }),
    solidRun(4),
    rep(10, { c: pat(E) }),
    solidRun(4),
    rep(10, { l: pat(E), r: pat(E) }),
    solidRun(12),
  ),
};
