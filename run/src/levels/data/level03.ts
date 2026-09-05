import { course } from "../authoring";
import { rep, seq, solidRun } from "../helpers";
import { gap } from "../sections";

export const level03 = course(
  "LANES",
  {
    label: "READ THE ROAD",
    hint: "PICK YOUR NEXT LANE BEFORE THE FLOOR NARROWS",
    slices: seq(solidRun(10), rep(5, { f: "###.." }), solidRun(4), rep(5, { f: "..###" }), solidRun(4)),
  },
  {
    label: "FOLLOW THE BEND",
    slices: seq(solidRun(6), rep(5, { f: "###.." }), rep(5, { f: ".###." }), rep(5, { f: "..###" }), solidRun(4)),
  },
  {
    label: "SPLIT AND REJOIN",
    hint: "TAKE A SIDE — MEET BACK IN THE MIDDLE",
    slices: seq(solidRun(8), rep(5, { f: "##.##" }), solidRun(5), rep(5, { f: ".###." })),
  },
  {
    label: "THE LAST CROSSING",
    hint: "STEER, THEN JUMP TOGETHER",
    slices: seq(solidRun(8), rep(4, { f: "..###" }), gap(2), solidRun(12)),
  },
);
