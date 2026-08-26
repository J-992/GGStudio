import type { LevelDef } from "../types";
import { seq, solidRun, slice, pat, rep } from "../helpers";

export const level03: LevelDef = {
  name: "LANES",
  slices: seq(
    solidRun(10),
    slice({ f: pat("#..##") }),
    solidRun(2),
    slice({ f: pat("##..#") }),
    solidRun(2),
    slice({ f: pat("#..##") }),
    solidRun(2),
    slice({ f: pat("##..#") }),
    solidRun(6),
    rep(2, { f: pat(".....") }),
    solidRun(8),
    rep(6, { f: pat("..#..") }),
    solidRun(10),
  ),
};
