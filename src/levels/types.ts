export type FacePattern = string;

export interface SliceDef {
  f?: FacePattern;
  l?: FacePattern;
  r?: FacePattern;
  c?: FacePattern;
}

export interface HintDef {
  atSlice: number;
  text: string;
}

export interface SpinnerDef {
  atSlice: number;
  speed?: number;
}

export interface LevelDef {
  name: string;
  slices: SliceDef[];
  hints?: HintDef[];
  spinners?: SpinnerDef[];
}
