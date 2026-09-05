import type { LevelDef } from "./types";
import { level01 } from "./data/level01";
import { level02 } from "./data/level02";
import { level03 } from "./data/level03";
import { level04 } from "./data/level04";
import { level05 } from "./data/level05";
import { level06 } from "./data/level06";
import { level07 } from "./data/level07";
import { level08 } from "./data/level08";
import { level09 } from "./data/level09";
import { level10 } from "./data/level10";
import { level11 } from "./data/level11";
import { level12 } from "./data/level12";
import { level13 } from "./data/level13";
import { level14 } from "./data/level14";
import { level15 } from "./data/level15";
import { level16 } from "./data/level16";
import { level17 } from "./data/level17";
import { level18 } from "./data/level18";
import { level19 } from "./data/level19";
import { level20 } from "./data/level20";

const environments: NonNullable<LevelDef["environment"]>[] = [
  "dock", "orbital", "induction", "transit", "reactor",
];

export const LEVELS: LevelDef[] = [
  level01, level02, level03, level04, level05,
  level06, level07, level08, level09, level10,
  level11, level12, level13, level14, level15,
  level16, level17, level18, level19, level20,
].map((level, index) => ({ ...level, environment: environments[Math.floor(index / 4)] }));
