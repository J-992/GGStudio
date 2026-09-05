import type { LevelDef } from "./types";
import { catchMe, pendulum, slingshot, leapfrog, drumCourse, addRails } from "./elasticCampaign";
import { level01 } from "./data/level01";
import { level02 } from "./data/level02";
import { level05 } from "./data/level05";
import { level06 } from "./data/level06";
import { level09 } from "./data/level09";
import { level11 } from "./data/level11";
import { level14 } from "./data/level14";
import { level15 } from "./data/level15";
import { level17 } from "./data/level17";
import { level18 } from "./data/level18";
import { level19 } from "./data/level19";

const environments: NonNullable<LevelDef["environment"]>[] = [
  "dock", "orbital", "induction", "transit", "reactor",
];

// The relay already combines launch timing, ferry motion and recovery. Keep the
// second landing full-width so it does not add a precision spike as well. The
// first ferry can leave the pair off-centre before the second launch.
const longfallRelay: LevelDef = {
  ...level19,
  slices: level19.slices.map(slice => slice.f === "..=.." ? { ...slice, f: "=====" } : slice),
};

export const LEVELS: LevelDef[] = [
  level01, level02, catchMe, pendulum, level05,
  level06, slingshot, leapfrog,
  drumCourse("Slow Revolution", 0.10, false, false),
  drumCourse("Follow the Opening", -0.14, false, true),
  drumCourse("Orbit Partners", 0.16, true, true),
  drumCourse("Carousel Rescue", -0.18, true, true),
  addRails(level11, "Split Current"), addRails(level09, "Springboard Relay"),
  addRails(level14, "Ferry Handoff"), addRails(level15, "Shutter Partners"),
  addRails(level17, "Elastic Overdrive"), addRails(level18, "Helix Handoff"),
  addRails(longfallRelay, "Longfall Catch"), drumCourse("Carousel Finale", 0.24, true, true),
].map((level, index) => ({ ...level, environment: environments[Math.floor(index / 4)] }));
