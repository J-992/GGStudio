import type { LevelDef } from "../types";
import { pat, rep, seq, solidRun } from "../helpers";

export const level03: LevelDef = {
  name: "LANES",
  hints: [{ atSlice: 6, text: "PICK A LANE EARLY" }],
  slices: seq(
    solidRun(8),
    rep(4, { f: pat("###..") }),
    rep(4, { f: pat("..###") }),
    rep(4, { f: pat("###..") }),
    rep(4, { f: pat("..###") }),
    solidRun(6),
    rep(6, { f: pat("#.#.#") }),
    solidRun(8),
    rep(4, { f: pat(".###.") }),
    rep(4, { f: pat("##.##") }),
    solidRun(12),
  ),
};
