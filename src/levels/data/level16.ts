import type { LevelDef } from "../types";
import { pat, rep, seq, solidRun } from "../helpers";

export const level16: LevelDef = {
  name: "SPLIT SECOND",
  spinners: [{ atSlice: 72, speed: 2.4 }],
  hints: [
    { atSlice: 14, text: "TWO LANES. ONE OF THEM IS ALWAYS SHUT" },
    { atSlice: 56, text: "SWAP LANES ON THE BEAT" },
  ],
  slices: seq(
    solidRun(12),
    rep(4, { f: pat(".###.") }),
    rep(1, { f: pat(".!.?.") }),
    rep(4, { f: pat(".###.") }),
    rep(1, { f: pat(".?.!.") }),
    rep(4, { f: pat(".###.") }),
    rep(1, { f: pat(".!.?.") }),
    solidRun(10),
    rep(5, { f: pat("##.##") }),
    rep(1, { f: pat("!#.#?") }),
    rep(5, { f: pat("##.##") }),
    rep(1, { f: pat("?#.#!") }),
    solidRun(12),
    rep(1, { f: pat("!#?#!") }),
    solidRun(8),
    rep(1, { f: pat("?#!#?") }),
    solidRun(20),
  ),
};
