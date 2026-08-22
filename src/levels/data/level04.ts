import type { LevelDef } from "../types";
import { seq, solidRun, slice, pat, rep } from "../helpers";

export const level04: LevelDef = {
  name: "BEAM TEAM",
  slices: seq(
    solidRun(10),
    rep(6, { f: pat("..#..") }),
    solidRun(6),
    slice({ f: pat("#.#..") }),
    solidRun(3),
    slice({ f: pat("..#.#") }),
    solidRun(3),
    rep(8, { f: pat("..#..") }),
    solidRun(6),
    rep(2, { f: pat(".....") }),
    solidRun(6),
    rep(2, { f: pat(".....") }),
    solidRun(10),
  ),
};
