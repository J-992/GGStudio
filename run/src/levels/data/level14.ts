import { course } from "../authoring";
import { rep, seq, solidRun } from "../helpers";
import { voidRun } from "../sections";

export const level14 = course(
  "FERRY",
  {
    label: "CATCH THE FERRY",
    hint: "LAUNCH, LAND, THEN RIDE THE MOVING DECK",
    slices: seq(solidRun(12), rep(2, { f: "^^^^^" }), voidRun(3), solidRun(9), rep(5, { f: ".===." }), solidRun(6)),
  },
  {
    label: "PASSING TRAINS",
    hint: "THE TWO DECKS MOVE IN OPPOSITE DIRECTIONS",
    slices: seq(solidRun(8), rep(5, { f: "==#++" }), solidRun(6)),
  },
  {
    label: "SPLIT CROSSING",
    hint: "PICK A DECK — KEEP YOUR PARTNER CLOSE",
    slices: seq(solidRun(8), rep(5, { f: ".###." }), rep(4, { f: ".=+++" }), solidRun(8)),
  },
  {
    label: "TRANSFER",
    hint: "REGROUP ON THE ISLAND BEFORE THE NEXT DECK",
    slices: seq(solidRun(8), rep(5, { f: ".##.." }), rep(4, { f: ".===." }), solidRun(8), rep(5, { f: ".##.." }), rep(4, { f: ".+++." }), solidRun(14)),
  },
);
