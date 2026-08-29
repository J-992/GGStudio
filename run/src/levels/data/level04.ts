import type { LevelDef } from "../types";
import { crumble } from "../sections";
import { seq, solidRun, slice, pat, rep } from "../helpers";

export const level04: LevelDef = {
  name: "BEAM TEAM",
  spinners: [{ atSlice: 41, speed: 2.2 }],
  slices: seq(
    solidRun(10),
    rep(6, { f: pat("..#..") }),
    solidRun(6),
    slice({ f: pat("#.#..") }),
    solidRun(3),
    slice({ f: pat("..#.#") }),
    solidRun(3),
    solidRun(2),
    crumble(5),
    solidRun(1),
    solidRun(8),
    rep(2, { f: pat(".....") }),
    solidRun(6),
    rep(2, { f: pat(".....") }),
    solidRun(10),
  ),
};
