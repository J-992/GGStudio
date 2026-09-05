import type { LevelDef, SliceDef } from "./types";

interface Phrase {
  label: string;
  hint?: string;
  slices: SliceDef[];
}

/** Each phrase includes its own approach runway, so hints precede the action. */
export function course(name: string, ...phrases: Phrase[]): LevelDef {
  const def: LevelDef = { name, slices: [], hints: [], beats: [] };
  for (const phrase of phrases) {
    const atSlice = def.slices.length;
    def.beats!.push({ atSlice, label: phrase.label });
    if (phrase.hint) def.hints!.push({ atSlice: atSlice + 1, text: phrase.hint });
    def.slices.push(...phrase.slices);
  }
  return def;
}
