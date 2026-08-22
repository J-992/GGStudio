import type { LevelDef } from "../types";
import { pat, rep, seq, slice, solidRun } from "../helpers";

export const level12: LevelDef = {
  name: "PENDULUM",
  slices: seq(
    solidRun(10),
    rep(4, { f: pat("#....") }),
    rep(4, { f: pat("....#") }),
    rep(4, { f: pat("#....") }),
    rep(4, { f: pat("....#") }),
    solidRun(8),
    rep(8, { f: pat("..#..") }),
    solidRun(8),
    rep(6, { f: pat(".#...") }),
    rep(4, { f: pat("..#..") }),
    solidRun(8),
    rep(4, { f: pat("#..##") }),
    rep(4, { f: pat("##..#") }),
    solidRun(12),
  ),
};
