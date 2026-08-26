import type { LevelDef } from "../types";
import { pat, rep, seq, solidRun } from "../helpers";

const E = ".....";

export const level14: LevelDef = {
  name: "SPIRE",
  hints: [{ atSlice: 8, text: "LAND ON THE WALL — GAPS AHEAD" }],
  slices: seq(
    solidRun(8),
    rep(4, { f: pat(E) }),
    rep(2, { f: pat(E), r: pat(E) }),
    rep(2, { f: pat(E) }),
    rep(2, { f: pat(E), r: pat(E) }),
    rep(2, { f: pat(E) }),
    solidRun(10),
    rep(4, { f: pat(E) }),
    rep(2, { f: pat(E), l: pat(E) }),
    rep(2, { f: pat(E) }),
    rep(2, { f: pat(E), l: pat(E) }),
    rep(2, { f: pat(E) }),
    solidRun(14),
  ),
};
