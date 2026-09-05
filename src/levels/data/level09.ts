import { course } from "../authoring";
import { rep, seq, solidRun } from "../helpers";
import { voidRun } from "../sections";

export const level09 = course(
  "SLINGSHOT",
  {
    label: "LIFT OFF",
    hint: "GREEN CHEVRONS LAUNCH YOU — JUST RUN ONTO THEM",
    slices: seq(solidRun(12), rep(2, { f: "^^^^^" }), solidRun(10)),
  },
  {
    label: "ACROSS THE VOID",
    hint: "TAKE THE PAD ACROSS THE BREAK",
    slices: seq(solidRun(8), rep(2, { f: "^^^^^" }), voidRun(3), solidRun(10)),
  },
  {
    label: "AIR STEERING",
    hint: "STEER IN THE AIR — LAND NEAR THE MIDDLE",
    slices: seq(solidRun(8), rep(2, { f: "#^^^#" }), voidRun(3), rep(9, { f: ".###." }), solidRun(6)),
  },
  {
    label: "DOUBLE FLIGHT",
    hint: "LAND, LINE UP, LAUNCH AGAIN",
    slices: seq(solidRun(8), rep(2, { f: "^^^^^" }), voidRun(3), solidRun(9), rep(2, { f: "^^^^^" }), voidRun(3), solidRun(14)),
  },
);
