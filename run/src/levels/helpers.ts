import type { FacePattern, SliceDef } from "./types";
import { LEGAL_CHARS } from "./types";
import { COLS } from "../game/Constants";

export const FULL: FacePattern = "#".repeat(COLS);
export const EMPTY: FacePattern = ".".repeat(COLS);

export function pat(s: string): FacePattern {
  if (s.length !== COLS) throw new Error(`pattern "${s}" must be ${COLS} chars`);
  for (const ch of s) {
    if (!LEGAL_CHARS.includes(ch)) throw new Error(`pattern "${s}" has unknown tile "${ch}"`);
  }
  return s;
}

export function rep(n: number, overrides: Partial<SliceDef> = {}): SliceDef[] {
  const out: SliceDef[] = [];
  for (let i = 0; i < n; i++) out.push({ ...overrides });
  return out;
}

export function solidRun(n: number): SliceDef[] {
  return rep(n);
}

export function seq(...parts: (SliceDef | SliceDef[] | undefined)[]): SliceDef[] {
  const out: SliceDef[] = [];
  for (const p of parts) {
    if (!p) continue;
    if (Array.isArray(p)) out.push(...p);
    else out.push(p);
  }
  return out;
}

export function slice(overrides: Partial<SliceDef>): SliceDef {
  return { ...overrides };
}

export function crumbleRun(n: number): SliceDef[] {
  return rep(n, { f: "~~~~~" });
}

export function withFloor(patterns: string[], base: Partial<SliceDef> = {}): SliceDef[] {
  return patterns.map((f) => ({ ...base, f: pat(f) }));
}
