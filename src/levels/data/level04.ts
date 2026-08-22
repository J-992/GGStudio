import type { LevelDef } from "../types";
import { pat, rep, seq, slice, solidRun } from "../helpers";

export const level04: LevelDef = {
  name: "THE DROP",
  hints: [
    { atSlice: 1, text: "A FALLING PARTNER CAN BE REELED BACK IN" },
    { atSlice: 20, text: "HOLD JUMP ON A TAUT TETHER TO CLIMB" },
  ],
  slices: seq(
    solidRun(9),
    rep(2, { f: pat(".....") }),
    solidRun(9),
    rep(8, { f: pat("..#..") }),
    solidRun(10),
    rep(8, { f: pat(".#...") }),
    solidRun(8),
    rep(3, { f: pat("#....") }),
    rep(3, { f: pat("....#") }),
    rep(3, { f: pat("#....") }),
    rep(3, { f: pat("....#") }),
    solidRun(8),
    rep(2, { f: pat(".....") }),
    solidRun(5),
    rep(3, { f: pat(".....") }),
    solidRun(13),
  ),
};
void slice;
