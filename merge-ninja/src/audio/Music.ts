/**
 * The Merge Ninja theme: an original chiptune loop synthesized live, so the
 * soundtrack still costs zero download bytes.
 *
 * The lead runs an A-minor hirajoshi scale (A B C E F -- dropping D and G is
 * what gives it the ninja color, and pentatonic hooks are hard to make sound
 * wrong). Underneath sits an Am-F-C-G engine at 132 BPM. Two eight-bar
 * sections: the taiko-gallop hook stated twice, a lifted answer that peaks at
 * C6, then a descent into a held dominant that pulls the ear back to the top
 * of the loop. Bars 8-11 strip down to bass and lead only -- half-time kick,
 * no hats, no arpeggio -- so the loop breathes instead of walling the listener
 * with sixteenths for minutes on end. Drums, bass, arpeggio and echo are all
 * synthesized here too.
 */

/** One lead note: start beat inside the loop, length in beats, MIDI pitch. */
type LeadNote = readonly [number, number, number];

const BPM = 132;
const BEAT = 60 / BPM;
const STEP = BEAT / 4; // one sixteenth note
const LOOP_STEPS = 16 * 16; // sixteen bars of sixteenths

const midiFreq = (midi: number): number => 440 * Math.pow(2, (midi - 69) / 12);

/** Chord root in bass register per bar, plus third quality (minor 3 / major 3). */
const CHORD_ROOTS = [45, 41, 48, 43, 45, 41, 48, 43, 41, 43, 45, 45, 41, 43, 40, 40];
const CHORD_THIRDS = [3, 4, 4, 4, 3, 4, 4, 4, 4, 4, 3, 3, 4, 4, 4, 4];

const LEAD: readonly LeadNote[] = [
  // Bars 0-3: the hook, stated identically twice so it sticks.
  [0, .5, 69], [.5, .25, 69], [.75, .25, 72], [1, .75, 76], [1.75, .25, 72], [2, .75, 69], [2.75, .25, 72], [3, 1, 76],
  [8, .5, 69], [8.5, .25, 69], [8.75, .25, 72], [9, .75, 76], [9.75, .25, 72], [10, .75, 69], [10.75, .25, 72], [11, 1, 76],
  // Bars 4-5: same gallop, lifted to the high A the first section only hinted at.
  [16, .5, 69], [16.5, .25, 69], [16.75, .25, 72], [17, .75, 76], [17.75, .25, 72], [18, .5, 81], [18.5, .5, 77], [19, 1, 76],
  // Bars 6-7: call-and-answer wiggle, then the turnaround that relaunches the hook.
  [24, .5, 76], [24.5, .5, 77], [25, .5, 76], [25.5, .5, 72], [26, 2, 76],
  [28, .5, 71], [28.5, .5, 72], [29, .5, 71], [29.5, .5, 69], [30, 1.5, 71], [31.5, .5, 72],
  // Bar 8: the octave leap to C6 is the climax of the whole loop.
  [32, .5, 84], [32.5, .25, 83], [32.75, .25, 84], [33, .75, 81], [33.75, .25, 77], [34, 1.5, 81],
  // Bar 9-11: ride the energy down through G and home to Am.
  [36, .5, 83], [36.5, .5, 81], [37, .5, 77], [37.5, .5, 76], [38, 1.5, 76],
  [40, .5, 76], [40.5, .25, 72], [40.75, .25, 69], [41, .75, 72], [41.75, .25, 76], [42, 1.5, 81],
  [44, .5, 76], [44.5, .5, 77], [45, .5, 76], [45.5, .5, 72], [46, 1.5, 72],
  // Bars 12-13: the hook's rhythm comes back half-buried, setting up the ending.
  [48, .75, 77], [48.75, .25, 76], [49, .75, 72], [49.75, .25, 69], [50, 1.5, 72],
  [52, .5, 71], [52.5, .5, 72], [53, .5, 71], [53.5, .5, 69], [54, 1.5, 71],
  // Bars 14-15: dominant tension -- flutter, leap, and one long held E with vibrato.
  [56, .25, 76], [56.25, .25, 77], [56.5, .25, 76], [56.75, .25, 71], [57, 1, 76], [58, .75, 83], [58.75, .25, 81],
  [60, 3, 76],
];

/** Bass eighth-note contour, in intervals above the bar's root. */
const BASS_CONTOUR = [0, 0, 0, 12, 0, 0, 7, 12];

/** Read-only composition facts the unit runner can sanity-check without WebAudio. */
export const MUSIC_FACTS = {
  bpm: BPM,
  bars: CHORD_ROOTS.length,
  loopSteps: LOOP_STEPS,
  stepSec: STEP,
  leadNotes: LEAD.length,
  bassContour: BASS_CONTOUR.length,
} as const;

export class Music {
  private timer: number | null = null;
  private nextStepTime = 0;
  private step = 0;
  private master: GainNode | null = null;
  private leadBus: GainNode | null = null;
  /** Every long-lived node start() created; all disconnected on stop(). */
  private persistent: AudioNode[] = [];
  private noise: AudioBuffer | null = null;
  /** Lead starts keyed by sixteenth-step, built once. */
  private readonly leadByStep = new Map<number, LeadNote>();

  constructor(private readonly ctx: AudioContext, private readonly out: GainNode) {
    for (const note of LEAD) {
      const step = Math.round(note[0] * 4);
      const existing = this.leadByStep.get(step);
      if (existing === undefined) this.leadByStep.set(step, note);
    }
  }

  start(): void {
    if (this.timer !== null) return;
    const c = this.ctx;
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -16; comp.knee.value = 8; comp.ratio.value = 3.5;
    comp.attack.value = .004; comp.release.value = .12;
    const master = c.createGain(); master.gain.value = .45;
    comp.connect(master).connect(this.out);
    // Dotted-eighth echo on the lead: the classic chip tune space maker.
    const leadBus = c.createGain(); leadBus.gain.value = 1;
    // A gentle lowpass takes the fizz off the raw square without dulling it;
    // unfiltered squares at this register turn buzzy over a long session.
    const leadTone = c.createBiquadFilter(); leadTone.type = 'lowpass'; leadTone.frequency.value = 3200; leadTone.Q.value = .4;
    const delay = c.createDelay(1); delay.delayTime.value = BEAT * .75;
    const feedback = c.createGain(); feedback.gain.value = .32;
    const wet = c.createGain(); wet.gain.value = .2;
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
    // Lookahead outlasts background-tab timer throttling (~1s), so hidden tabs keep playing cleanly.
    this.timer = window.setInterval(tick, 200);
  }

  stop(): void {
    if (this.timer !== null) { window.clearInterval(this.timer); this.timer = null; }
    // The delay feedback loop references itself, so every node must be
    // disconnected or the graph would leak long after the track "stopped".
    for (const node of this.persistent) {
      try { node.disconnect(); } catch { /* already torn down */ }
    }
    this.persistent = [];
    this.master = null; this.leadBus = null;
  }

  /** Schedule every sixteenth step that falls inside the lookahead window. */
  private pump(): void {
    if (this.master === null) return;
    const now = this.ctx.currentTime;
    // After tab suspension, system sleep, or a stalled interval the wall clock
    // can end up far ahead of the scheduler. Fast-forward the pattern position
    // instead of dumping a burst of catch-up notes on top of each other.
    if (this.nextStepTime < now - 0.3) {
      const skipped = Math.ceil((now + 0.05 - this.nextStepTime) / STEP);
      this.step = (this.step + skipped) % LOOP_STEPS;
      this.nextStepTime += skipped * STEP;
    }
    const horizon = now + 1.35;
    while (this.nextStepTime < horizon) {
      this.scheduleStep(this.step, this.nextStepTime);
      this.step = (this.step + 1) % LOOP_STEPS;
      this.nextStepTime += STEP;
    }
  }

  private scheduleStep(step: number, t: number): void {
    const bar = Math.floor(step / 16);
    const pos = step % 16; // position inside the bar, in sixteenths
    const root = CHORD_ROOTS[bar] ?? 45;
    const third = CHORD_THIRDS[bar] ?? 3;

    const lead = this.leadByStep.get(step);
    if (lead !== undefined) this.playLead(t, lead[1] * BEAT, midiFreq(lead[2]));

    if (pos % 2 === 0) {
      const eighth = pos / 2;
      this.playBass(t, midiFreq(root + (BASS_CONTOUR[eighth] ?? 0)));
    }

    // Arrangement shape: bars 0-7 state the hook with the full band, bars
    // 8-11 strip down to bass + lead (half-time kick, no hats, no arp) so the
    // descent can breathe, and bars 12-15 build back into the loop point.
    const breakdown = bar >= 8 && bar <= 11;

    // Sixteenth-note shimmer cycling root, third, fifth, octave up an octave.
    if (!breakdown) {
      const cycle = [12, 12 + third, 19, 24];
      this.playArp(t, midiFreq(root + (cycle[pos % 4] ?? 12)));
    }

    // Drums: kick gallops on 1, the-and-of-2 and 3; snare cracks the backbeat.
    const fillBar = bar % 4 === 3;
    const kickHere = breakdown ? pos === 0 || pos === 8 : pos === 0 || pos === 6 || pos === 8 || (fillBar && pos === 14);
    if (kickHere) this.playKick(t);
    if (pos === 4 || pos === 12) this.playSnare(t);
    // The bar-15 roll rides offbeat sixteentshs; firing it on the downbeats
    // too flammed two hats into every even step of that half-bar.
    if (!breakdown && pos % 2 === 0) this.playHat(t, pos % 4 === 2);
    if (bar === 15 && pos >= 8 && pos % 2 === 1) this.playHat(t, true);
  }

  private playLead(t: number, dur: number, freq: number): void {
    const c = this.ctx; const bus = this.leadBus; if (bus === null) return;
    const long = dur >= BEAT;
    const voice = (detune: number, peak: number): void => {
      const osc = c.createOscillator(); osc.type = 'square'; osc.frequency.value = freq; osc.detune.value = detune;
      if (long) {
        // Ninja bend into held notes plus slow vibrato keeps them alive.
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
    voice(0, .105); voice(9, .05);
  }

  private playBass(t: number, freq: number): void {
    const c = this.ctx; if (this.master === null) return;
    const gate = STEP * 2 * .82;
    const osc = c.createOscillator(); osc.type = 'triangle'; osc.frequency.value = freq;
    const sub = c.createOscillator(); sub.type = 'sine'; sub.frequency.value = freq / 2;
    const env = c.createGain();
    env.gain.setValueAtTime(.0001, t);
    env.gain.linearRampToValueAtTime(.15, t + .005);
    env.gain.setTargetAtTime(.0001, t + gate * .6, .05);
    osc.connect(env); sub.connect(env); env.connect(this.master);
    osc.start(t); sub.start(t); osc.stop(t + gate + .05); sub.stop(t + gate + .05);
    osc.onended = () => { osc.disconnect(); sub.disconnect(); env.disconnect(); };
  }

  private playArp(t: number, freq: number): void {
    const c = this.ctx; if (this.master === null) return;
    const osc = c.createOscillator(); osc.type = 'square'; osc.frequency.value = freq;
    const soften = c.createBiquadFilter(); soften.type = 'lowpass'; soften.frequency.value = 2400;
    const env = c.createGain();
    env.gain.setValueAtTime(.0001, t);
    env.gain.linearRampToValueAtTime(.03, t + .002);
    env.gain.exponentialRampToValueAtTime(.0004, t + .1);
    osc.connect(soften).connect(env).connect(this.master);
    osc.start(t); osc.stop(t + .12);
    osc.onended = () => { osc.disconnect(); soften.disconnect(); env.disconnect(); };
  }

  private noiseSource(t: number): AudioBufferSourceNode | null {
    if (this.noise === null || this.master === null) return null;
    const src = this.ctx.createBufferSource(); src.buffer = this.noise; src.loop = true;
    src.start(t); src.stop(t + .2);
    return src;
  }

  private playKick(t: number): void {
    const c = this.ctx; if (this.master === null) return;
    const osc = c.createOscillator();
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.exponentialRampToValueAtTime(46, t + .08);
    const env = c.createGain();
    env.gain.setValueAtTime(.6, t);
    env.gain.exponentialRampToValueAtTime(.001, t + .13);
    osc.connect(env).connect(this.master);
    osc.start(t); osc.stop(t + .15);
    osc.onended = () => { osc.disconnect(); env.disconnect(); };
  }

  private playSnare(t: number): void {
    const c = this.ctx; if (this.master === null) return;
    const src = this.noiseSource(t);
    if (src !== null) {
      const band = c.createBiquadFilter(); band.type = 'bandpass'; band.frequency.value = 1800; band.Q.value = .9;
      const env = c.createGain();
      env.gain.setValueAtTime(.3, t);
      env.gain.exponentialRampToValueAtTime(.001, t + .11);
      src.connect(band).connect(env).connect(this.master);
      src.onended = () => { src.disconnect(); band.disconnect(); env.disconnect(); };
    }
    const body = c.createOscillator();
    body.frequency.setValueAtTime(195, t);
    body.frequency.exponentialRampToValueAtTime(150, t + .05);
    const bodyEnv = c.createGain();
    bodyEnv.gain.setValueAtTime(.22, t);
    bodyEnv.gain.exponentialRampToValueAtTime(.001, t + .06);
    body.connect(bodyEnv).connect(this.master);
    body.start(t); body.stop(t + .08);
    body.onended = () => { body.disconnect(); bodyEnv.disconnect(); };
  }

  private playHat(t: number, accent: boolean): void {
    const c = this.ctx; const src = this.noiseSource(t);
    if (src === null || this.master === null) return;
    const airy = c.createBiquadFilter(); airy.type = 'highpass'; airy.frequency.value = 7800;
    const env = c.createGain();
    env.gain.setValueAtTime(accent ? .1 : .07, t);
    env.gain.exponentialRampToValueAtTime(.001, t + (accent ? .05 : .03));
    src.connect(airy).connect(env).connect(this.master);
    src.onended = () => { src.disconnect(); airy.disconnect(); env.disconnect(); };
  }
}
