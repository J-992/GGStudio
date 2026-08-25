import type { LevelDef } from "../types";
import { pat, rep, seq, solidRun } from "../helpers";

const E = ".....";

export const level16: LevelDef = {
  name: "SPLIT SECOND",
  spinners: [{ atSlice: 46, speed: 2.6 }],
  hints: [{ atSlice: 28, text: "ROTATE EARLY - THE WALL IS THE FLOOR NOW" }],
  slices: seq(
    solidRun(10),
    rep(6, { f: pat("#...#") }),
    rep(1, { f: E }),
    rep(5, { f: pat("#...#") }),
    rep(1, { f: E }),
    rep(5, { f: pat("#...#") }),
    rep(12, { f: E }),
    rep(6, { f: E, r: pat("#....") }),
    rep(6, { f: E, r: pat("....#") }),
    rep(6, { f: E, r: pat("#....") }),
    rep(6, { f: E, r: pat("....#") }),
    rep(10, { r: E }),
    solidRun(6),
    solidRun(0),
    rep(6, { f: pat("..#..") }),
    solidRun(12),
  ),
};
