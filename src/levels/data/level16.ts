import type { LevelDef } from "../types";
import { pat, rep, seq, solidRun, slice } from "../helpers";

const E = ".....";

export const level16: LevelDef = {
  name: "SPLIT SECOND",
  hints: [{ atSlice: 1, text: "OPPOSITE SIDES — DO NOT MIRROR EACH OTHER" }],
  slices: seq(
    solidRun(10),
    rep(6, { f: pat("#...#") }),
    slice({ f: E }),
    rep(5, { f: pat("#...#") }),
    slice({ f: E }),
    rep(5, { f: pat("#...#") }),
    solidRun(8),
    rep(4, { f: pat("#....") }),
    rep(4, { f: pat("....#") }),
    rep(4, { f: pat("#....") }),
    rep(4, { f: pat("....#") }),
    solidRun(8),
    rep(6, { f: pat("..#..") }),
    solidRun(12),
  ),
};
