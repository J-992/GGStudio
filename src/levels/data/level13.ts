import type { LevelDef } from "../types";
import { pat, rep, seq, slice, solidRun } from "../helpers";

export const level13: LevelDef = {
  name: "FULL SEND",
  hints: [{ atSlice: 13, text: "HOLD INTO THE WALL" }],
  slices: seq(
    solidRun(8),
    slice({ f: pat("#..##") }), solidRun(1),
    slice({ f: pat("##..#") }), solidRun(1),
    slice({ f: pat("#..##") }), solidRun(1),
    slice({ f: pat("##..#") }), solidRun(1),
    rep(8, { f: pat(".....") }),
    rep(2, { f: pat("....."), r: pat(".....") }),
    rep(6, { f: pat(".....") }),
    solidRun(8),
    rep(6, { f: pat("#...#") }),
    rep(2, { f: pat(".....") }),
    solidRun(8),
    rep(3, { f: pat("..#..") }),
    rep(3, { f: pat(".#...") }),
    rep(2, { f: pat("..#..") }),
    solidRun(8),
    rep(8, { f: pat(".....") }),
    rep(2, { f: pat("....."), l: pat(".....") }),
    rep(6, { f: pat(".....") }),
    solidRun(9),
    slice({ f: pat(".....") }),
    solidRun(2),
    rep(2, { f: pat(".....") }),
    solidRun(11),
    rep(2, { f: pat("#..##") }),
    rep(2, { f: pat("##..#") }),
    rep(2, { f: pat("#..##") }),
    rep(2, { f: pat("##..#") }),
    solidRun(9),
  ),
};
void slice;
void rep;
