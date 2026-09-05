import { course } from "../authoring";
import { rep, seq, solidRun } from "../helpers";

export const level15 = course(
  "SHUTTER LINE",
  {
    label: "READ THE SIGNAL",
    hint: "RED GRILLES HURT WHEN RAISED — USE AN OPEN LANE",
    slices: seq(solidRun(12), rep(1, { f: "##!##" }), solidRun(9)),
  },
  {
    label: "ALTERNATING DOORS",
    hint: "THE STRIPED BASE MARKS WHERE A BARRIER WILL RISE",
    slices: seq(solidRun(8), rep(1, { f: "!###?" }), solidRun(8), rep(1, { f: "?###!" }), solidRun(6)),
  },
  {
    label: "WEAVE THROUGH",
    hint: "LOOK AHEAD FOR THE NEXT OPEN LANE",
    slices: seq(solidRun(8), rep(1, { f: "!#?#!" }), solidRun(7), rep(1, { f: "?#!#?" }), solidRun(6)),
  },
  {
    label: "RHYTHM CHECK",
    slices: seq(solidRun(6), rep(1, { f: "!#!#!" }), solidRun(6), rep(1, { f: "#!#!#" }), solidRun(14)),
  },
);
