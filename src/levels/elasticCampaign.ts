import { course } from "./authoring";
import type { LevelDef, SliceDef } from "./types";

const repeat = (n: number, f = "#####", r = ".....", c = ".....", l = "....."): SliceDef[] =>
  Array.from({ length: n }, () => ({ f, r, c, l }));
const runway = () => repeat(8);
const gripHint = "GOLD TWIN RAILS: hold GRIP (S / ↓ / LB). Release to let go; the tether stays connected.";

/** Short learning courses: readable setups, a rehearsal, a variation, then payoff.
 * Rail lanes remain traversable without gripping; the outer coin route rewards
 * the swing. We do not lock the portal behind a button-press checklist. */
export const catchMe = course("Catch Me",
  { label: "MAGNET BOOTS", hint: gripHint, slices: [...runway(), ...repeat(10, "#MMM#")] },
  { label: "PARTNER CATCH", hint: "One holds a gold rail. The other takes the broken lane — your partner can catch a miss.", slices: [...runway(), ...repeat(5, "#M.##"), ...repeat(2, "#M..."), ...repeat(6, "#M.##")] },
  { label: "TRADE PLACES", hint: "Trade jobs at the wide landing. If hanging, release then hold JUMP again to climb.", slices: [...runway(), ...repeat(5, "##.M#"), ...repeat(2, "...M#"), ...repeat(6, "##.M#")] },
  { label: "CATCH AND RELEASE", hint: "The boots glow when locked. Let go of GRIP to steer again.", slices: [...runway(), ...repeat(6, "#M.M#"), ...repeat(2, "#M..."), ...repeat(8)] },
);
catchMe.localRetry = true;

export const pendulum = course("Pendulum Run",
  { label: "SWING SPACE", hint: "A gripped partner is your moving anchor. Steer out, then back in to swing under the gap.", slices: [...runway(), ...repeat(6, "#M.##"), ...repeat(3, "#M..."), ...repeat(8)] },
  { label: "KEEP THE ARC", hint: "Release JUMP during a swing to keep the natural arc. Press it again to recover upward.", slices: [...runway(), ...repeat(5, "##.M#"), ...repeat(3, "...M#"), ...repeat(8)] },
  { label: "MOVING ANCHOR", hint: "Rails carry you forward even while gripping. Watch the next landing, not just the rope.", slices: [...runway(), ...repeat(6, "#M.##"), ...repeat(4, "#M..."), ...repeat(8)] },
  { label: "REGROUP", hint: "Land together, release the boots, and run for the portal.", slices: [...runway(), ...repeat(8, "#M.M#"), ...repeat(8)] },
);
pendulum.localRetry = true;

export const slingshot = course("Slingshot Alley",
  { label: "LOAD THE SPRING", hint: "One grips. The other moves away to stretch, then jumps inward. Gold pulses show stored tension.", slices: [...runway(), ...repeat(12, "#M.##"), ...repeat(8)] },
  { label: "RELEASE TIMING", hint: "Anchor: release GRIP as your partner sweeps past. Momentum comes from the spring, not a launch pad.", slices: [...runway(), ...repeat(8, "##.M#"), ...repeat(3, "...M#"), ...repeat(8)] },
  { label: "OTHER SIDE", hint: "Now swap the anchor. Aim for the wide landing; a longer stretch is not always a better launch.", slices: [...runway(), ...repeat(8, "#M.##"), ...repeat(3, "#M..."), ...repeat(8)] },
  { label: "LINK TWO", hint: "Catch, stretch, release. Leave a little slack before the next setup.", slices: [...runway(), ...repeat(8, "#M.M#"), ...repeat(2, "#M..."), ...repeat(8), ...repeat(8, "##.M#"), ...repeat(2, "...M#"), ...repeat(8)] },
);
slingshot.localRetry = true;

export const leapfrog = course("Leapfrog",
  { label: "FIRST ANCHOR", hint: "Gold changes sides ahead. Whoever lands first can become the next anchor.", slices: [...runway(), ...repeat(6, "#M.##"), ...repeat(3, "#M..."), ...repeat(8, "#MMM#")] },
  { label: "HANDOFF", hint: "Release one anchor before committing the other. Both gripping means neither can steer.", slices: [...runway(), ...repeat(6, "##.M#"), ...repeat(3, "...M#"), ...repeat(8, "#MMM#")] },
  { label: "SHORTER REST", hint: "Same moves, closer together. Use the full width of each landing to reset the tether.", slices: [...runway(), ...repeat(5, "#M.##"), ...repeat(3, "#M..."), ...repeat(5), ...repeat(5, "##.M#"), ...repeat(3, "...M#"), ...repeat(5)] },
  { label: "PAIR FINISH", slices: [...runway(), ...repeat(10, "#M.M#"), ...repeat(8)] },
);

// Optional below-face coin trails make the swing route worth choosing without
// making a first-clear pair master precision releases to continue the campaign.
for (const level of [catchMe, pendulum, slingshot, leapfrog]) {
  level.elasticRewards = level.slices.flatMap((slice, atSlice) =>
    slice.f === "#M..." || slice.f === "...M#"
      ? [{ face: "f" as const, col: slice.f === "#M..." ? 3 : 1, atSlice, height: -2.2 }]
      : []);
}

/** All four faces overlap before each corner, then only the destination survives.
 * Staying on the original face cannot bypass a drum's curriculum. */
export function drumCourse(name: string, speed: number, magnets: boolean, fullCircuit: boolean): LevelDef {
  const solid = magnets ? "#MMM#" : "#####";
  const def = course(name,
    { label: "BOARD THE DRUM", hint: "The tunnel really rotates. Its surfaces carry you; distant machinery stays still. Steer normally.", slices: [...repeat(10, "#####", "#####", "#####", "#####"), ...repeat(12, solid, "#####", "#####", "#####")] },
    { label: "FOLLOW THE OPENING", hint: "The floor ends ahead. Lean into the RIGHT corner to move onto the next face.", slices: [...repeat(10, solid, solid, ".....", "....."), ...repeat(12, ".....", solid)] },
    { label: magnets ? "ROTATING ANCHOR" : "CEILING TRANSFER", hint: magnets ? "Gold rails rotate too. Hold one to catch your partner, then release before the next corner." : "Another opening, another face. Use the overlap to roll onto the ceiling before the wall ends.", slices: [...repeat(12, ".....", solid, solid), ...repeat(12, ".....", ".....", solid)] },
    { label: fullCircuit ? "FULL CIRCUIT" : "SAFE ARRIVAL", hint: fullCircuit ? "Ceiling to left wall, then home. Regroup before each corner." : "Run together along the ceiling to the portal.", slices: fullCircuit
      ? [...repeat(12, ".....", ".....", solid, solid), ...repeat(12, ".....", ".....", ".....", solid), ...repeat(12, solid, ".....", ".....", solid), ...repeat(12, solid)]
      : repeat(18, ".....", ".....", solid) },
  );
  def.drum = { speed };
  def.localRetry = true;
  return def;
}

export function addRails(def: LevelDef, name: string): LevelDef {
  return {
    ...def, name,
    // Add anchors on existing solid panels only: never fill a authored gap or
    // replace a moving platform/hazard. One rail on each side of the course.
    slices: def.slices.map(s => Object.fromEntries(Object.entries(s).map(([face, pattern]) => [face,
      [...pattern].map((ch, col) => ch === "#" && (col === 1 || col === 3) ? "M" : ch).join(""),
    ]))),
    hints: [...(def.hints ?? []), { atSlice: 3, text: "Gold rails are optional anchors. Use the familiar machinery to load the tether, then release into the landing." }],
  };
}
