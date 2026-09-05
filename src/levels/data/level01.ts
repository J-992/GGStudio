import type { LevelDef } from "../types";
import { pat, rep, seq, solidRun } from "../helpers";

const E = ".....";

// ACT I — movement. Nothing here should be able to end a run.
export const level01: LevelDef = {
  name: "WARMUP CONDUIT",
  hints: [
    { atSlice: 1, text: "MOVE BOTH ROBOTS — THE TETHER KEEPS THEM TOGETHER" },
    { atSlice: 30, text: "YOU RUN FORWARD ON YOUR OWN — STEER AND JUMP" },
  ],
  slices: seq(
    solidRun(12),
    rep(2, { f: pat("##.##") }),
    solidRun(6),
    rep(1, { f: E }),
    solidRun(7),
    rep(2, { f: E }),
    solidRun(8),
    rep(3, { f: pat("##.##") }),
    solidRun(6),
    rep(5, { f: pat("..#..") }),
    solidRun(10),
  ),
};
