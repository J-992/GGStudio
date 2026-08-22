import type { LevelDef } from "../types";
import { pat, rep, seq, solidRun } from "../helpers";

const E = ".....";

export const level12: LevelDef = {
  name: "PENDULUM",
  hints: [
    { atSlice: 1, text: "SWING FROM EDGE TO EDGE" },
    { atSlice: 48, text: "THE PENDULUM NEVER STOPS" },
  ],
  slices: seq(
    solidRun(10),
    rep(4, { f: pat("#....") }),
    rep(4, { f: pat("....#") }),
    rep(4, { f: pat("#....") }),
    rep(4, { f: pat("....#") }),
    solidRun(8),
    rep(12, { f: E }),
    rep(4, { f: E, l: pat("#....") }),
    rep(4, { f: E, l: pat("....#") }),
    rep(4, { f: E, l: pat("#....") }),
    rep(4, { f: E, l: pat("....#") }),
    rep(10, { l: E }),
    rep(6, { f: pat("..#..") }),
    solidRun(14),
  ),
};
