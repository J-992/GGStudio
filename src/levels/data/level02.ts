import { course } from "../authoring";
import { rep, seq, solidRun } from "../helpers";
import { gap } from "../sections";

export const level02 = course(
  "STEP UP",
  {
    label: "FRAGILE GROUND",
    hint: "CRACKED AMBER PANELS FALL UNDER YOUR WEIGHT",
    slices: seq(solidRun(12), rep(4, { f: "#~~~#" }), solidRun(6)),
  },
  {
    label: "KEEP YOUR MOMENTUM",
    hint: "KEEP MOVING ACROSS THE CRACKS",
    slices: seq(solidRun(8), rep(5, { f: "~~~~~" }), solidRun(6)),
  },
  {
    label: "LAND AND LEAVE",
    hint: "JUMP THE GAP — THEN RUN OFF THE CRACKS",
    slices: seq(solidRun(8), gap(1), rep(4, { f: "~~~~~" }), solidRun(6)),
  },
  {
    label: "LIGHT FOOTWORK",
    hint: "STAY TOGETHER THROUGH THE MIDDLE",
    slices: seq(solidRun(8), rep(5, { f: ".~~~." }), solidRun(4), gap(2), solidRun(12)),
  },
);
