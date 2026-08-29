import type { LevelDef } from "../types";
import { pat, rep, seq, solidRun } from "../helpers";
import { crumble } from "../sections";

const E = ".....";

export const level19: LevelDef = {
  name: "LONGFALL",
  hints: [
    { atSlice: 1, text: "SWING UNDER. CLIMB BACK. KEEP GOING." },
    { atSlice: 18, text: "THE BRIDGE MOVES TO THE WALL" },
  ],
  slices: seq(
    solidRun(10),
    rep(8, { f: E }),
    rep(8, { f: E, r: pat("..#..") }),
    rep(10, { r: E }),
    rep(2, { f: pat("..#..") }),
    rep(2, { f: pat(".#...") }),
    rep(2, { f: pat("...#.") }),
    rep(2, { f: E }),
    crumble(3),
    rep(4, { f: pat("..#..") }),
    crumble(3),
    solidRun(14),
  ),
};
