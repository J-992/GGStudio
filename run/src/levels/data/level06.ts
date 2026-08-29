import type { LevelDef } from "../types";
import { pat, rep, seq, solidRun, slice } from "../helpers";

const E = ".....";

export const level06: LevelDef = {
  name: "TWO TURN",
  hints: [{ atSlice: 4, text: "ROLL ONTO THE WALL — THEN ROLL BACK" }],
  slices: seq(
    solidRun(10),
    rep(4, { f: pat(E) }),
    rep(2, { f: pat(E), l: pat(E), r: pat(E) }),
    rep(6, { f: pat(E) }),
    solidRun(8),
    rep(2, { l: pat(E) }),
    solidRun(8),
    rep(12, { l: pat(E) }),
    solidRun(16),
  ),
};
