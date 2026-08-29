import type { LevelDef } from "../types";
import { crumble } from "../sections";
import { seq, solidRun, slice, pat, rep } from "../helpers";

export const level02: LevelDef = {
  name: "STEP UP",
  slices: seq(
    solidRun(10),
    slice({ f: pat(".....") }),
    solidRun(8),
    rep(2, { f: pat(".....") }),
    solidRun(8),
    rep(2, { f: pat(".....") }),
    solidRun(3),
    crumble(4),
    solidRun(1),
    slice({ f: pat("#..#.") }),
    solidRun(5),
    slice({ f: pat(".#..#") }),
    solidRun(5),
    rep(2, { f: pat(".....") }),
    solidRun(10),
  ),
};
