import type { LevelDef } from "../types";
import { pat, rep, seq, solidRun } from "../helpers";

const E = ".....";

export const level04: LevelDef = {
  name: "BEAM TEAM",
  spinners: [{ atSlice: 36, speed: 2.0 }],
  hints: [{ atSlice: 30, text: "THE ARM SWEEPS LOW — TAKE AN OUTSIDE LANE" }],
  slices: seq(
    solidRun(10),
    rep(5, { f: pat(".###.") }),
    solidRun(6),
    rep(5, { f: pat("##.##") }),
    solidRun(11),
    rep(3, { f: pat("##.##") }),
    rep(2, { f: E }),
    rep(6, { f: pat(".###.") }),
    solidRun(8),
    rep(2, { f: E }),
    solidRun(10),
  ),
};
