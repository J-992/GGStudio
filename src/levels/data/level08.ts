import type { LevelDef } from "../types";
import { pat, rep, seq, solidRun } from "../helpers";

const E = ".....";

export const level08: LevelDef = {
  name: "CAROUSEL",
  hints: [
    { atSlice: 3, text: "FOUR FACES, ONE PATH — KEEP CLIMBING" },
    { atSlice: 53, text: "WALLS GONE — DROP TO THE FLOOR" },
  ],
  slices: seq(
    solidRun(8),
    rep(6, { f: pat(E) }),
    rep(4, { f: pat(E), l: pat(E) }),
    rep(6, { f: pat(E), l: pat(E), r: pat(E) }),
    solidRun(5),
    rep(2, { c: pat(E) }),
    solidRun(4),
    rep(8, { c: pat(E) }),
    solidRun(4),
    rep(2, { l: pat(E), r: pat(E) }),
    solidRun(4),
    rep(8, { l: pat(E), r: pat(E) }),
    solidRun(12),
  ),
};
