import { course } from "../authoring";
import { rep, seq, solidRun } from "../helpers";

export const level11 = course(
  "BELTWAY",
  {
    label: "FEEL THE CURRENT",
    hint: "BLUE ARROWS CARRY YOU SIDEWAYS — STEER AGAINST THEM",
    slices: seq(solidRun(12), rep(5, { f: ">>>>>" }), solidRun(6)),
  },
  {
    label: "REVERSE THE FLOW",
    hint: "THE ARROWS SHOW WHICH WAY YOU WILL DRIFT",
    slices: seq(solidRun(8), rep(5, { f: "<<<<<" }), solidRun(6)),
  },
  {
    label: "RIDE THE CURRENT",
    hint: "RIDE RIGHT, THEN STAY ON THE LANDING",
    slices: seq(solidRun(8), rep(5, { f: ">>>##" }), rep(4, { f: "...##" }), solidRun(8)),
  },
  {
    label: "COUNTERFLOW",
    hint: "OPPOSING BELTS PUSH YOU APART — STEER TOGETHER",
    slices: seq(solidRun(8), rep(5, { f: "<<#>>" }), solidRun(6), rep(5, { f: "##<<<" }), rep(4, { f: "##..." }), solidRun(12)),
  },
);
