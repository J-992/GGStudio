import type { SliceDef } from "./types";
import { pat, rep, EMPTY } from "./helpers";

export const runway = (n: number): SliceDef[] => rep(n);

export const gap = (n = 1): SliceDef[] => rep(n, { f: EMPTY });

/**
 * A true break in the tunnel: every face gone. Rolling onto a wall is not an
 * escape here, so a void has to be crossed by a jump or a launch pad.
 */
export const voidRun = (n = 1): SliceDef[] =>
  rep(n, { f: EMPTY, l: EMPTY, r: EMPTY, c: EMPTY });

export const floorP = (p: string, n = 1): SliceDef[] => rep(n, { f: pat(p) });

export function faceGap(face: "l" | "r" | "c" | "f", n = 1): SliceDef[] {
  if (face === "l") return rep(n, { l: EMPTY });
  if (face === "r") return rep(n, { r: EMPTY });
  if (face === "f") return rep(n, { f: EMPTY });
  return rep(n, { c: EMPTY });
}

export function faceP(face: "l" | "r" | "c", p: string, n = 1): SliceDef[] {
  const base: Partial<SliceDef> =
    face === "l" ? { l: pat(p) } : face === "r" ? { r: pat(p) } : { c: pat(p) };
  return rep(n, base);
}

export const bridge = (col: string, n = 1): SliceDef[] => rep(n, { f: pat(col) });

export const crumble = (n = 1): SliceDef[] => rep(n, { f: "~~~~~" });

export function faceCrumble(face: "l" | "r" | "c", n = 1): SliceDef[] {
  if (face === "l") return rep(n, { l: "~~~~~" });
  if (face === "r") return rep(n, { r: "~~~~~" });
  return rep(n, { c: "~~~~~" });
}
