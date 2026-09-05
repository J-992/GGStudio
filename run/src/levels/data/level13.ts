import { course } from "../authoring";
import { rep, seq, solidRun } from "../helpers";

export const level13 = course(
  "TRACKING",
  {
    label: "MOVING GROUND",
    hint: "VIOLET DECKS MOVE SIDEWAYS — STAY NEAR THEIR MIDDLE",
    slices: seq(solidRun(12), rep(5, { f: "#===#" }), solidRun(6)),
  },
  {
    label: "FREE FLOAT",
    hint: "THE WHOLE BRIDGE NOW MOVES",
    slices: seq(solidRun(8), rep(5, { f: ".###." }), rep(4, { f: ".===." }), solidRun(8)),
  },
  {
    label: "CHANGE OF PHASE",
    hint: "THE NEXT DECK SWINGS THE OTHER WAY",
    slices: seq(solidRun(8), rep(5, { f: ".###." }), rep(4, { f: ".+++." }), solidRun(6)),
  },
  {
    label: "NARROW CROSSING",
    hint: "LINE UP TOGETHER FOR THE TWO-LANE DECK",
    slices: seq(solidRun(8), rep(5, { f: ".##.." }), rep(4, { f: ".==.." }), solidRun(8), rep(4, { f: ".===." }), solidRun(12)),
  },
);
