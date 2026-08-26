import type { LevelDef } from "../types";
import { pat, rep, seq, slice, solidRun } from "../helpers";

export const level01: LevelDef = {
  name: "WARMUP CONDUIT",
  hints: [{ atSlice: 1, text: "P1  A/D MOVE · W JUMP        P2  ←/→ MOVE · ↑ JUMP" }],
  slices: seq(
    solidRun(10),
    slice({ f: pat("##.##") }),
    solidRun(7),
    slice({ f: pat(".....") }),
    solidRun(7),
    rep(2, { f: pat(".....") }),
    solidRun(10),
    slice({ f: pat("#..##") }),
    solidRun(1),
    slice({ f: pat("##..#") }),
    solidRun(1),
    slice({ f: pat("#..##") }),
    solidRun(9),
    rep(8, { f: pat("..#..") }),
    solidRun(9),
  ),
};
void rep;
