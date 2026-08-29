/**
 * Merge Ninja's procedural soundtrack. Every act has its own composition, but
 * all of them are synthesized with WebAudio so the music adds zero download
 * bytes and can change on a bar line without loading or decoding an asset.
 */

/** One lead note: start beat inside the loop, length in beats, MIDI pitch. */
type LeadNote = readonly [number, number, number];

export type MusicTrack = 'dojo' | 'mountain' | 'storm' | 'rift' | 'shrine' | 'results';

interface TrackDefinition {
  readonly label: string;
  readonly bpm: number;
  /** Two explicitly voiced harmonic events per bar. */
  readonly chords: readonly Harmony[];
  readonly lead: readonly LeadNote[];
  readonly bass: readonly number[];
  readonly wave: OscillatorType;
  readonly breakdown: readonly number[];
  readonly drum: 'taiko' | 'march' | 'rush' | 'void' | 'festival' | 'quiet';
}

export interface Harmony {
  readonly bass: number;
  readonly voices: readonly number[];
}

const midiFreq = (midi: number): number => 440 * Math.pow(2, (midi - 69) / 12);

/** The original lead stays intact: the first act still sounds like Merge Ninja. */
const DOJO_LEAD: readonly LeadNote[] = [
  [0, .5, 69], [.5, .25, 69], [.75, .25, 72], [1, .75, 76], [1.75, .25, 72], [2, .75, 69], [2.75, .25, 72], [3, 1, 76],
  [8, .5, 69], [8.5, .25, 69], [8.75, .25, 72], [9, .75, 76], [9.75, .25, 72], [10, .75, 69], [10.75, .25, 72], [11, 1, 76],
  [16, .5, 69], [16.5, .25, 69], [16.75, .25, 72], [17, .75, 76], [17.75, .25, 72], [18, .5, 81], [18.5, .5, 77], [19, 1, 76],
  [24, .5, 76], [24.5, .5, 77], [25, .5, 76], [25.5, .5, 72], [26, 2, 76],
  [28, .5, 71], [28.5, .5, 72], [29, .5, 71], [29.5, .5, 69], [30, 1.5, 71], [31.5, .5, 72],
  [32, .5, 84], [32.5, .25, 83], [32.75, .25, 84], [33, .75, 81], [33.75, .25, 77], [34, 1.5, 81],
  [36, .5, 83], [36.5, .5, 81], [37, .5, 77], [37.5, .5, 76], [38, 1.5, 76],
  [40, .5, 76], [40.5, .25, 72], [40.75, .25, 69], [41, .75, 72], [41.75, .25, 76], [42, 1.5, 81],
  [44, .5, 76], [44.5, .5, 77], [45, .5, 76], [45.5, .5, 72], [46, 1.5, 72],
  [48, .75, 77], [48.75, .25, 76], [49, .75, 72], [49.75, .25, 69], [50, 1.5, 72],
  [52, .5, 71], [52.5, .5, 72], [53, .5, 71], [53.5, .5, 69], [54, 1.5, 71],
  [56, .25, 76], [56.25, .25, 77], [56.5, .25, 76], [56.75, .25, 71], [57, 1, 76], [58, .75, 83], [58.75, .25, 81],
  [60, 3, 76],
];

/**
 * A theme is authored before it is harmonized. These are related two-bar
 * phrases, not a motif transposed to whatever bass note happens to be active.
 * A is the original hook, A' lifts its answer, B fragments and sequences it,
 * and the cadence leaves E hanging so the loop's return to A feels inevitable.
 */
const THEME_A: readonly LeadNote[] = [
  [0, .5, 69], [.5, .25, 69], [.75, .25, 72], [1, .75, 76], [1.75, .25, 72], [2, .75, 69], [2.75, .25, 72], [3, 1, 76],
  [4, .5, 76], [4.5, .5, 77], [5, .5, 76], [5.5, .5, 72], [6, 1, 71], [7, .5, 72], [7.5, .5, 69],
];
const THEME_A_PRIME: readonly LeadNote[] = [
  [0, .5, 69], [.5, .25, 72], [.75, .25, 76], [1, .75, 81], [1.75, .25, 77], [2, .5, 76], [2.5, .5, 72], [3, 1, 76],
  [4, .5, 79], [4.5, .5, 81], [5, .75, 84], [5.75, .25, 81], [6, .5, 77], [6.5, .5, 76], [7, 1, 72],
];
const THEME_B: readonly LeadNote[] = [
  [0, .5, 77], [.5, .5, 76], [1, .5, 72], [1.5, .5, 69], [2, 1, 72], [3, .5, 76], [3.5, .5, 77],
  [4, .5, 79], [4.5, .25, 77], [4.75, .25, 76], [5, .5, 72], [5.5, .5, 71], [6, 1, 69], [7, 1, 71],
];
const THEME_CADENCE: readonly LeadNote[] = [
  [0, .25, 76], [.25, .25, 77], [.5, .25, 76], [.75, .25, 72], [1, 1, 71], [2, .75, 76], [2.75, .25, 81],
  [4, .5, 77], [4.5, .5, 76], [5, .5, 72], [5.5, .5, 71], [6, 2, 76],
];

const phrase = (at: number, source: readonly LeadNote[], transpose = 0, stretch = 1): readonly LeadNote[] =>
  source.map(([beat, length, midi]) => [at + beat * stretch, length * stretch, midi + transpose] as const);

const MOUNTAIN_LEAD: readonly LeadNote[] = [
  ...phrase(0, THEME_A), ...phrase(8, THEME_A_PRIME), ...phrase(16, THEME_B), ...phrase(24, THEME_A),
  // High, spacious fragments over the middle pedal point.
  [32, 1.5, 81], [34, .5, 77], [35, 1, 76], [36, 1, 72], [38, 1, 76], [39, 1, 79],
  [40, .5, 81], [41, .5, 79], [42, 1, 76], [44, .5, 77], [45, .5, 76], [46, 2, 72],
  ...phrase(48, THEME_A_PRIME), ...phrase(56, THEME_CADENCE),
];

const STORM_LEAD: readonly LeadNote[] = [
  // The same identity in D minor, compressed and syncopated for pursuit.
  ...phrase(0, THEME_A, 5, .5), ...phrase(4, THEME_A_PRIME, 5, .5),
  ...phrase(8, THEME_B, 5, .5), ...phrase(12, THEME_A, 5, .5),
  ...phrase(16, THEME_A_PRIME, 5, .5), ...phrase(20, THEME_B, 5, .5),
  [24, .25, 74], [24.5, .25, 77], [25, .25, 81], [25.5, .25, 86], [26, .5, 84], [27, 1, 81],
  [28, .5, 82], [28.5, .5, 81], [29, .5, 77], [29.5, .5, 74], [30, 1, 76], [31, 1, 73],
  ...phrase(32, THEME_A, 5, .5), ...phrase(36, THEME_A_PRIME, 5, .5),
  ...phrase(40, THEME_B, 5, .5), ...phrase(44, THEME_A, 5, .5),
  [48, .5, 82], [48.5, .5, 81], [49, .5, 77], [49.5, .5, 74], [50, 1, 77], [51, 1, 81],
  [52, .25, 86], [52.5, .25, 84], [53, .5, 81], [54, 1, 77], [55, 1, 76],
  ...phrase(56, THEME_CADENCE, 5, .5), [60, 1, 77], [61, 1, 76], [62, 2, 73],
];

/** Miyakobushi-flavoured mutation: A-Bb-D-E-F, built in fourth-framed cells. */
const RIFT_LEAD: readonly LeadNote[] = [
  [0, .75, 69], [1, .25, 70], [1.5, .5, 74], [2, 1, 76], [3.5, .5, 77],
  [4, .5, 76], [5, .5, 74], [6, 1, 70], [7, 1, 69],
  [8, .5, 69], [8.5, .5, 74], [9, .75, 77], [10, .5, 76], [11, 1, 70],
  [12, .5, 74], [13, .5, 76], [14, 1, 77], [15, 1, 81],
  [16, .25, 81], [16.5, .25, 77], [17, .5, 76], [18, 1, 74], [19, 1, 70],
  [20, .5, 69], [21, .5, 70], [22, 1, 74], [23, 1, 76],
  // Fragmented call and answer leaves air for the uncanny harmony.
  [24, .5, 69], [25, .5, 70], [26, 1, 74], [28, .5, 77], [29, .5, 76], [30, 2, 70],
  [32, 1, 81], [34, 1, 77], [36, 1, 76], [38, 1, 74],
  [40, .5, 70], [41, .5, 74], [42, 1, 76], [44, .5, 77], [45, .5, 81], [46, 2, 76],
  [48, .75, 69], [49, .25, 70], [49.5, .5, 74], [50, 1, 76], [51.5, .5, 77],
  [52, .5, 81], [53, .5, 77], [54, 1, 76], [55, 1, 74],
  [56, .5, 77], [57, .5, 76], [58, 1, 74], [60, .5, 70], [61, .5, 69], [62, 2, 76],
];

/** Ritsu-mode transformation: the hook opens into A-B-D-E-F# for the finale. */
const SHRINE_LEAD: readonly LeadNote[] = [
  [0, .5, 69], [.5, .25, 71], [.75, .25, 74], [1, .75, 76], [1.75, .25, 74], [2, .75, 69], [2.75, .25, 74], [3, 1, 76],
  [4, .5, 78], [4.5, .5, 76], [5, .5, 74], [5.5, .5, 71], [6, 1, 74], [7, 1, 76],
  [8, .5, 81], [8.5, .25, 78], [8.75, .25, 76], [9, .75, 74], [10, .5, 76], [11, 1, 81],
  [12, .5, 83], [12.5, .5, 81], [13, .5, 78], [13.5, .5, 76], [14, 2, 74],
  [16, .5, 69], [16.5, .5, 74], [17, .5, 76], [17.5, .5, 81], [18, 1, 83], [19, 1, 81],
  [20, .25, 78], [20.5, .25, 81], [21, .5, 83], [22, 1, 86], [23, 1, 83],
  [24, .5, 81], [24.5, .5, 78], [25, .5, 76], [25.5, .5, 74], [26, 1, 71], [27, 1, 74],
  [28, .5, 76], [29, .5, 78], [30, 2, 81],
  // Festival answer, then a broad final statement of the hook.
  [32, .25, 81], [32.5, .25, 83], [33, .5, 86], [34, 1, 88], [35, 1, 86],
  [36, .5, 83], [36.5, .5, 81], [37, .5, 78], [37.5, .5, 76], [38, 2, 74],
  [40, .5, 76], [40.5, .5, 81], [41, .5, 83], [41.5, .5, 86], [42, 2, 88],
  [44, .5, 86], [44.5, .5, 83], [45, .5, 81], [45.5, .5, 78], [46, 2, 76],
  [48, .5, 69], [48.5, .25, 71], [48.75, .25, 74], [49, .75, 76], [50, .75, 81], [51, 1, 83],
  [52, .5, 81], [52.5, .5, 78], [53, .5, 76], [53.5, .5, 74], [54, 1, 71], [55, 1, 74],
  [56, .25, 76], [56.5, .25, 78], [57, .5, 81], [58, 1, 83], [59, 1, 81],
  [60, .5, 78], [60.5, .5, 76], [61, .5, 74], [61.5, .5, 71], [62, 2, 76],
];

const RESULTS_LEAD: readonly LeadNote[] = [
  ...phrase(0, THEME_A, 0, 1.5),
  [12, 1, 77], [13.5, .5, 76], [14, 1, 72], [16, 1, 69], [18, 1, 72], [20, 2, 76],
  [24, 1, 77], [26, 1, 76], [28, 1, 71], [30, 2, 69],
];

const harmony = (bass: number, ...voices: number[]): Harmony => ({ bass, voices });
const bar = (first: Harmony, second: Harmony = first): readonly Harmony[] => [first, second];
const progression = (...bars: readonly (readonly Harmony[])[]): readonly Harmony[] => bars.flat();

// Voiced for smooth upper-part motion; the bass supplies harmonic direction.
const AM9 = harmony(45, 57, 59, 60, 64, 69);
const AM_G = harmony(43, 55, 57, 60, 64);
const FMAJ7 = harmony(41, 53, 57, 60, 64);
const CADD9 = harmony(36, 55, 60, 62, 64);
const G6 = harmony(43, 55, 59, 62, 64);
const GSUS = harmony(43, 55, 60, 62, 67);
const E7 = harmony(40, 52, 56, 59, 62);
const E7B9 = harmony(40, 52, 53, 56, 62);
const A7 = harmony(45, 57, 61, 64, 67);
const A7B9 = harmony(45, 57, 58, 61, 67);
const DM9 = harmony(38, 50, 53, 57, 60, 64);
const EM7 = harmony(40, 52, 55, 59, 62);
const BM7B5 = harmony(35, 47, 50, 53, 57);
const BBMAJ7 = harmony(46, 58, 62, 65, 69);
const DMIN9 = harmony(38, 50, 53, 57, 60, 64);
const C_E = harmony(40, 52, 55, 60, 64);
const A_PEDAL_BB = harmony(45, 58, 62, 65, 69);
const A_PEDAL_F = harmony(45, 53, 57, 60, 64);
const A5 = harmony(45, 57, 64, 69, 76);
const G_A = harmony(45, 55, 59, 62, 66);
const D_A = harmony(45, 57, 62, 66, 69);
const FSHARP_M = harmony(42, 54, 57, 61, 66);

const DOJO_CHORDS = progression(
  bar(AM9), bar(FMAJ7), bar(CADD9), bar(GSUS, G6),
  bar(AM9), bar(FMAJ7), bar(CADD9), bar(G6, E7),
  bar(FMAJ7), bar(G6), bar(AM9), bar(AM_G),
  bar(FMAJ7), bar(G6), bar(E7B9), bar(E7),
);

const MOUNTAIN_CHORDS = progression(
  bar(AM9), bar(CADD9, C_E), bar(FMAJ7), bar(GSUS, E7),
  bar(AM9, AM_G), bar(DM9), bar(FMAJ7, G6), bar(E7B9, E7),
  bar(FMAJ7), bar(G6), bar(EM7), bar(AM9),
  bar(DM9), bar(C_E), bar(BM7B5, E7B9), bar(E7),
);

const STORM_CHORDS = progression(
  bar(DMIN9), bar(BBMAJ7), bar(FMAJ7), bar(CADD9),
  bar(DMIN9), bar(DM9), bar(BBMAJ7), bar(A7B9, A7),
  bar(BBMAJ7), bar(CADD9), bar(DMIN9), bar(A7),
  bar(DM9), bar(BBMAJ7), bar(A7B9), bar(A7),
);

const RIFT_CHORDS = progression(
  bar(AM9), bar(A_PEDAL_BB), bar(A_PEDAL_F), bar(E7B9),
  bar(AM9), bar(A_PEDAL_BB), bar(DM9), bar(E7B9),
  bar(A_PEDAL_F), bar(A_PEDAL_BB), bar(AM9), bar(E7B9),
  bar(DM9), bar(A_PEDAL_BB), bar(BM7B5, E7B9), bar(E7B9),
);

const SHRINE_CHORDS = progression(
  bar(A5), bar(G_A), bar(D_A), bar(FSHARP_M, E7),
  bar(A5), bar(D_A), bar(G_A), bar(E7),
  bar(FMAJ7), bar(G_A), bar(D_A), bar(A5),
  bar(D_A), bar(G_A), bar(FSHARP_M, E7), bar(E7),
);

const RESULTS_CHORDS = progression(
  bar(AM9), bar(FMAJ7), bar(CADD9), bar(GSUS, E7),
  bar(AM9), bar(DM9), bar(FMAJ7), bar(E7),
);

export const MUSIC_TRACKS: Readonly<Record<MusicTrack, TrackDefinition>> = {
  dojo: {
    label: 'Dojo at Dusk', bpm: 132,
    chords: DOJO_CHORDS, lead: DOJO_LEAD, bass: [0, 0, 7, 12, 0, 7, 10, 12],
    wave: 'square', breakdown: [8, 9, 10, 11], drum: 'taiko',
  },
  mountain: {
    label: 'Temple Above the Clouds', bpm: 116, chords: MOUNTAIN_CHORDS,
    lead: MOUNTAIN_LEAD, bass: [0, 7, 12, 7, 0, 7, 10, 12],
    wave: 'triangle', breakdown: [8, 9], drum: 'march',
  },
  storm: {
    label: 'Storm Sea Pursuit', bpm: 148, chords: STORM_CHORDS,
    lead: STORM_LEAD, bass: [0, 0, 12, 0, 7, 0, 10, 12],
    wave: 'sawtooth', breakdown: [6, 14], drum: 'rush',
  },
  rift: {
    label: 'Through the Rift', bpm: 126, chords: RIFT_CHORDS,
    lead: RIFT_LEAD, bass: [0, 0, 7, 12, 0, 1, 7, 8],
    wave: 'square', breakdown: [6, 7, 8, 9], drum: 'void',
  },
  shrine: {
    label: 'Dragon Shrine', bpm: 142, chords: SHRINE_CHORDS,
    lead: SHRINE_LEAD, bass: [0, 0, 7, 12, 0, 7, 10, 12],
    wave: 'square', breakdown: [8], drum: 'festival',
  },
  results: {
    label: 'Moonlit Results', bpm: 92, chords: RESULTS_CHORDS,
    lead: RESULTS_LEAD, bass: [0, 12, 7, 12, 0, 12, 7, 10],
    wave: 'triangle', breakdown: [0, 1, 2, 3, 4, 5, 6, 7], drum: 'quiet',
  },
} as const;

/** Stable act-to-track routing shared by the game and unit tests. */
export function musicTrackForStage(stage: number): MusicTrack {
  const value = Math.max(1, Math.floor(stage));
  if (value >= 37) return 'shrine';
  if (value >= 28) return 'rift';
  if (value >= 19) return 'storm';
  if (value >= 10) return 'mountain';
  return 'dojo';
}

/** Read-only composition facts the unit runner can check without WebAudio. */
export const MUSIC_FACTS = {
  bpm: MUSIC_TRACKS.dojo.bpm,
  bars: MUSIC_TRACKS.dojo.chords.length / 2,
  loopSteps: (MUSIC_TRACKS.dojo.chords.length / 2) * 16,
  stepSec: 60 / MUSIC_TRACKS.dojo.bpm / 4,
  leadNotes: MUSIC_TRACKS.dojo.lead.length,
  bassContour: MUSIC_TRACKS.dojo.bass.length,
  tracks: Object.keys(MUSIC_TRACKS).length,
} as const;

export class Music {
  private timer: number | null = null;
  private nextStepTime = 0;
  private step = 0;
  private master: GainNode | null = null;
  private leadBus: GainNode | null = null;
  private persistent: AudioNode[] = [];
  private noise: AudioBuffer | null = null;
  private currentName: MusicTrack;
  private pendingName: MusicTrack | null = null;
  private leadByStep = new Map<number, LeadNote>();

  constructor(private readonly ctx: AudioContext, private readonly out: GainNode, initial: MusicTrack = 'dojo') {
    this.currentName = initial;
    this.rebuildLeadMap();
  }

  get currentTrack(): MusicTrack { return this.currentName; }

  /** Queue a musical change for the next bar line; before start it is immediate. */
  setTrack(name: MusicTrack): void {
    if (name === this.currentName || name === this.pendingName) return;
    if (this.timer === null) {
      this.currentName = name;
      this.step = 0;
      this.rebuildLeadMap();
      return;
    }
    this.pendingName = name;
  }

  start(): void {
    if (this.timer !== null) return;
    const c = this.ctx;
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -16; comp.knee.value = 8; comp.ratio.value = 3.5;
    comp.attack.value = .004; comp.release.value = .12;
    const master = c.createGain(); master.gain.value = .45;
    comp.connect(master).connect(this.out);
    const leadBus = c.createGain(); leadBus.gain.value = 1;
    const leadTone = c.createBiquadFilter(); leadTone.type = 'lowpass'; leadTone.frequency.value = 3200; leadTone.Q.value = .4;
    const delay = c.createDelay(1); delay.delayTime.value = (60 / MUSIC_TRACKS[this.currentName].bpm) * .75;
    const feedback = c.createGain(); feedback.gain.value = .28;
    const wet = c.createGain(); wet.gain.value = .18;
    leadBus.connect(leadTone).connect(comp); leadBus.connect(delay);
    delay.connect(feedback).connect(delay); delay.connect(wet).connect(comp);

    this.master = master; this.leadBus = leadBus;
    this.persistent = [comp, master, leadBus, leadTone, delay, feedback, wet];
    this.noise = c.createBuffer(1, c.sampleRate, c.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;

    this.nextStepTime = c.currentTime + .08; this.step = 0;
    const tick = (): void => this.pump();
    tick();
    this.timer = window.setInterval(tick, 200);
  }

  stop(): void {
    if (this.timer !== null) { window.clearInterval(this.timer); this.timer = null; }
    for (const node of this.persistent) {
      try { node.disconnect(); } catch { /* already torn down */ }
    }
    this.persistent = [];
    this.master = null; this.leadBus = null;
  }

  private get track(): TrackDefinition { return MUSIC_TRACKS[this.currentName]; }
  private get loopSteps(): number { return (this.track.chords.length / 2) * 16; }
  private get stepSec(): number { return 60 / this.track.bpm / 4; }

  private rebuildLeadMap(): void {
    this.leadByStep = new Map();
    for (const note of MUSIC_TRACKS[this.currentName].lead) {
      const step = Math.round(note[0] * 4);
      if (!this.leadByStep.has(step)) this.leadByStep.set(step, note);
    }
  }

  private activatePendingTrack(): void {
    if (this.pendingName === null) return;
    this.currentName = this.pendingName;
    this.pendingName = null;
    this.step = 0;
    this.rebuildLeadMap();
  }

  private pump(): void {
    if (this.master === null) return;
    const now = this.ctx.currentTime;
    if (this.nextStepTime < now - .3) {
      const skipped = Math.ceil((now + .05 - this.nextStepTime) / this.stepSec);
      this.step = (this.step + skipped) % this.loopSteps;
      this.nextStepTime += skipped * this.stepSec;
    }
    const horizon = now + 1.35;
    while (this.nextStepTime < horizon) {
      if (this.pendingName !== null && this.step % 16 === 0) this.activatePendingTrack();
      const duration = this.stepSec;
      this.scheduleStep(this.step, this.nextStepTime);
      this.step = (this.step + 1) % this.loopSteps;
      this.nextStepTime += duration;
    }
  }

  private scheduleStep(step: number, t: number): void {
    const track = this.track;
    const beat = 60 / track.bpm;
    const bar = Math.floor(step / 16);
    const pos = step % 16;
    const chord = track.chords[Math.floor(step / 8)] ?? track.chords[0];
    if (chord === undefined) return;
    const lead = this.leadByStep.get(step);
    if (lead !== undefined) this.playLead(t, lead[1] * beat, midiFreq(lead[2]), track.wave);

    if (pos % 2 === 0) this.playBass(t, midiFreq(chord.bass + (track.bass[pos / 2] ?? 0)));

    const breakdown = track.breakdown.includes(bar);
    if (!breakdown && track.drum !== 'quiet') {
      const voice = chord.voices[pos % chord.voices.length] ?? chord.voices[0];
      if (voice !== undefined) this.playArp(t, midiFreq(voice), track.wave);
    }

    const fillBar = bar % 4 === 3;
    const kickHere = this.kickAt(track.drum, pos, fillBar, breakdown);
    if (kickHere) this.playKick(t, track.drum === 'festival' ? 175 : 150);
    if (track.drum !== 'quiet' && (pos === 4 || pos === 12)) this.playSnare(t, track.drum === 'void');
    if (!breakdown && track.drum !== 'quiet' && pos % (track.drum === 'rush' ? 1 : 2) === 0) this.playHat(t, pos % 4 === 2);
    if (track.drum === 'quiet' && pos === 0) this.playHat(t, false);
  }

  private kickAt(drum: TrackDefinition['drum'], pos: number, fill: boolean, breakdown: boolean): boolean {
    if (drum === 'quiet') return false;
    if (breakdown) return pos === 0 || pos === 8;
    if (drum === 'march') return pos === 0 || pos === 8 || pos === 12;
    if (drum === 'rush') return pos === 0 || pos === 3 || pos === 6 || pos === 8 || pos === 11 || pos === 14;
    if (drum === 'void') return pos === 0 || pos === 7 || pos === 10;
    if (drum === 'festival') return pos === 0 || pos === 4 || pos === 6 || pos === 8 || pos === 12 || (fill && pos === 14);
    return pos === 0 || pos === 6 || pos === 8 || (fill && pos === 14);
  }

  private playLead(t: number, dur: number, freq: number, wave: OscillatorType): void {
    const c = this.ctx; const bus = this.leadBus; if (bus === null) return;
    const long = dur >= 60 / this.track.bpm;
    const voice = (detune: number, peak: number): void => {
      const osc = c.createOscillator(); osc.type = wave; osc.frequency.value = freq; osc.detune.value = detune;
      if (long) {
        osc.frequency.setValueAtTime(freq * .94, t);
        osc.frequency.exponentialRampToValueAtTime(freq, t + .06);
        const lfo = c.createOscillator(); lfo.frequency.value = 5.6;
        const depth = c.createGain(); depth.gain.value = 14;
        lfo.connect(depth).connect(osc.detune);
        lfo.start(t); lfo.stop(t + dur);
      }
      const env = c.createGain();
      env.gain.setValueAtTime(.0001, t);
      env.gain.linearRampToValueAtTime(peak, t + .008);
      env.gain.setTargetAtTime(peak * .6, t + .01, .09);
      env.gain.setTargetAtTime(.0001, t + Math.max(.02, dur * .85), .02);
      osc.connect(env).connect(bus);
      osc.start(t); osc.stop(t + dur + .08);
      osc.onended = () => { osc.disconnect(); env.disconnect(); };
    };
    voice(0, wave === 'sawtooth' ? .065 : .105); voice(9, .04);
  }

  private playBass(t: number, freq: number): void {
    const c = this.ctx; if (this.master === null) return;
    const gate = this.stepSec * 2 * .82;
    const osc = c.createOscillator(); osc.type = 'triangle'; osc.frequency.value = freq;
    const sub = c.createOscillator(); sub.type = 'sine'; sub.frequency.value = freq / 2;
    const env = c.createGain();
    env.gain.setValueAtTime(.0001, t); env.gain.linearRampToValueAtTime(.15, t + .005);
    env.gain.setTargetAtTime(.0001, t + gate * .6, .05);
    osc.connect(env); sub.connect(env); env.connect(this.master);
    osc.start(t); sub.start(t); osc.stop(t + gate + .05); sub.stop(t + gate + .05);
    osc.onended = () => { osc.disconnect(); sub.disconnect(); env.disconnect(); };
  }

  private playArp(t: number, freq: number, wave: OscillatorType): void {
    const c = this.ctx; if (this.master === null) return;
    const osc = c.createOscillator(); osc.type = wave === 'triangle' ? 'sine' : 'square'; osc.frequency.value = freq;
    const soften = c.createBiquadFilter(); soften.type = 'lowpass'; soften.frequency.value = wave === 'sawtooth' ? 1900 : 2400;
    const env = c.createGain();
    env.gain.setValueAtTime(.0001, t); env.gain.linearRampToValueAtTime(.03, t + .002);
    env.gain.exponentialRampToValueAtTime(.0004, t + .1);
    osc.connect(soften).connect(env).connect(this.master);
    osc.start(t); osc.stop(t + .12);
    osc.onended = () => { osc.disconnect(); soften.disconnect(); env.disconnect(); };
  }

  private noiseSource(t: number, duration = .2): AudioBufferSourceNode | null {
    if (this.noise === null || this.master === null) return null;
    const src = this.ctx.createBufferSource(); src.buffer = this.noise; src.loop = true;
    src.start(t); src.stop(t + duration);
    return src;
  }

  private playKick(t: number, startFreq: number): void {
    const c = this.ctx; if (this.master === null) return;
    const osc = c.createOscillator();
    osc.frequency.setValueAtTime(startFreq, t); osc.frequency.exponentialRampToValueAtTime(46, t + .08);
    const env = c.createGain(); env.gain.setValueAtTime(.6, t); env.gain.exponentialRampToValueAtTime(.001, t + .13);
    osc.connect(env).connect(this.master); osc.start(t); osc.stop(t + .15);
    osc.onended = () => { osc.disconnect(); env.disconnect(); };
  }

  private playSnare(t: number, hollow: boolean): void {
    const c = this.ctx; if (this.master === null) return;
    const src = this.noiseSource(t);
    if (src !== null) {
      const band = c.createBiquadFilter(); band.type = 'bandpass'; band.frequency.value = hollow ? 1100 : 1800; band.Q.value = .9;
      const env = c.createGain(); env.gain.setValueAtTime(.3, t); env.gain.exponentialRampToValueAtTime(.001, t + .11);
      src.connect(band).connect(env).connect(this.master);
      src.onended = () => { src.disconnect(); band.disconnect(); env.disconnect(); };
    }
    const body = c.createOscillator(); body.frequency.setValueAtTime(hollow ? 145 : 195, t); body.frequency.exponentialRampToValueAtTime(120, t + .05);
    const bodyEnv = c.createGain(); bodyEnv.gain.setValueAtTime(.22, t); bodyEnv.gain.exponentialRampToValueAtTime(.001, t + .06);
    body.connect(bodyEnv).connect(this.master); body.start(t); body.stop(t + .08);
    body.onended = () => { body.disconnect(); bodyEnv.disconnect(); };
  }

  private playHat(t: number, accent: boolean): void {
    const c = this.ctx; const src = this.noiseSource(t, .08);
    if (src === null || this.master === null) return;
    const airy = c.createBiquadFilter(); airy.type = 'highpass'; airy.frequency.value = 7800;
    const env = c.createGain(); env.gain.setValueAtTime(accent ? .1 : .07, t); env.gain.exponentialRampToValueAtTime(.001, t + (accent ? .05 : .03));
    src.connect(airy).connect(env).connect(this.master);
    src.onended = () => { src.disconnect(); airy.disconnect(); env.disconnect(); };
  }
}
