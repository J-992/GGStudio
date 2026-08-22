import type { LevelDef } from "../types";
import { pat, rep, seq, solidRun } from "../helpers";

const E = ".....";

export const level11: LevelDef = {
  name: "THE DROP",
  hints: [
    { atSlice: 1, text: "A FALLING PARTNER CAN BE REELED BACK IN" },
    { atSlice: 50, text: "HOLD JUMP ON A TAUT TETHER TO CLIMB" },
  ],
  slices: seq(
    solidRun(9),
    rep(2, { f: E }),
    solidRun(9),
    rep(8, { f: pat("..#..") }),
    solidRun(8),
    rep(10, { f: E }),
    rep(8, { f: E, r: pat("..#..") }),
    rep(10, { r: E }),
    rep(8, { f: pat(".#...") }),
    solidRun(8),
    rep(4, { f: pat("#....") }),
    rep(4, { f: pat("....#") }),
    rep(4, { f: pat("#....") }),
    rep(4, { f: pat("....#") }),
    solidRun(8),
    rep(10, { f: pat("..#..") }),
    solidRun(13),
  ),
};
