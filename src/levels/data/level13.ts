import type { LevelDef } from "../types";
import { pat, rep, seq, solidRun } from "../helpers";

// ACT IV — moving ground, and doors that close.
export const level13: LevelDef = {
  name: "TRACKING",
  hints: [
    { atSlice: 10, text: "VIOLET PLATFORMS TRACK ACROSS — RIDE THEM" },
    { atSlice: 46, text: "THIS ONE IS NARROWER" },
  ],
  slices: seq(
    solidRun(12),
    rep(4, { f: pat(".===.") }),
    solidRun(10),
    rep(5, { f: pat(".===.") }),
    solidRun(8),
    rep(4, { f: pat(".===.") }),
    solidRun(8),
    rep(4, { f: pat(".===.") }),
    solidRun(10),
    rep(5, { f: pat(".===.") }),
    solidRun(16),
  ),
};
