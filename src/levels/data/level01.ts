import { course } from "../authoring";
import { rep, seq, solidRun } from "../helpers";
import { gap } from "../sections";

export const level01 = course(
  "WARMUP CONDUIT",
  {
    label: "FIND YOUR FEET",
    hint: "STEER BOTH ROBOTS — KEEP THE ROPE LOOSE",
    slices: seq(solidRun(12), rep(3, { f: "##.##" }), solidRun(5)),
  },
  {
    label: "FIRST FLIGHT",
    hint: "JUMP BEFORE THE GAP",
    slices: seq(solidRun(8), gap(1), solidRun(7), gap(1), solidRun(4)),
  },
  {
    label: "HOLD A LITTLE LONGER",
    hint: "HOLD JUMP TO STAY IN THE AIR LONGER",
    slices: seq(solidRun(8), gap(2), solidRun(8)),
  },
  {
    label: "BRING IT HOME",
    hint: "AIM FOR THE WIDE MIDDLE",
    slices: seq(solidRun(6), rep(5, { f: ".###." }), solidRun(10)),
  },
);
