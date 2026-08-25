import type { LevelDef } from "../types";
import { pat, rep, seq, slice, solidRun } from "../helpers";
import { crumble } from "../sections";

const E = ".....";

export const level20: LevelDef = {
  name: "TERMINUS",
  spinners: [{ atSlice: 53, speed: 2.6 }, { atSlice: 77, speed: 2.9 }],
  hints: [
    { atSlice: 4, text: "EVERYTHING YOU KNOW. ALL AT ONCE." },
    { atSlice: 14, text: "NO FLOOR - LIVE ON THE WALL" },
  ],
  slices: seq(
    solidRun(8),
    slice({ f: pat("#..##") }), solidRun(2),
    slice({ f: pat("##..#") }), solidRun(2),
    rep(4, { f: E }),
    rep(2, { f: E, r: pat("#..##") }),
    rep(2, { f: E, r: pat("##..#") }),
    rep(2, { f: E, r: pat("#..##") }),
    rep(2, { f: E, r: pat("##..#") }),
    rep(2, { f: E, r: E }),
    rep(2, { f: E, r: pat("#..##") }),
    rep(2, { f: E, r: pat("##..#") }),
    crumble(4),
    rep(4, { f: pat("#...#") }),
    rep(2, { f: E }),
    rep(6, { f: pat("#...#") }),
    solidRun(8),
    rep(6, { f: pat("#....") }),
    rep(6, { f: pat("....#") }),
    rep(6, { f: pat("#....") }),
    rep(6, { f: pat("....#") }),
    solidRun(8),
    rep(3, { f: pat("..#..") }),
    rep(3, { f: pat(".#...") }),
    rep(3, { f: pat("...#.") }),
    rep(4, { f: E }),
    rep(2, { f: E, l: E }),
    rep(4, { f: E }),
    rep(10, { l: E }),
    slice({ f: E }), solidRun(2),
    slice({ f: E }), solidRun(2),
    slice({ f: E }), solidRun(2),
    rep(2, { f: E }),
    solidRun(14),
  ),
};
