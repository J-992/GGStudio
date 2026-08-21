//  Tiny procedural sound engine. The project ships with no audio assets, so
//  every effect is synthesised with WebAudio oscillators / noise bursts.

const MASTER_GAIN = 0.32;

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = false;
let failed = false;

//  Set by the platform layer while an ad is on screen or the page is hidden.
//  Kept separate from `muted` so restoring it never clobbers the player's own
//  mute preference.
let externalMute = false;

function applyGain (): void
{
    if (master) master.gain.value = muted || externalMute ? 0 : MASTER_GAIN;
}

function ac (): AudioContext | null
{
    if (failed) return null;

    if (!ctx)
    {
        const AC = window.AudioContext || (window as any).webkitAudioContext;

        if (!AC) { failed = true; return null; }

        try
        {
            ctx = new AC();
            master = ctx.createGain();
            master.connect(ctx.destination);
            applyGain();
        }
        catch
        {
            failed = true;
            return null;
        }
    }

    //  While an ad is playing or the tab is hidden the context stays suspended
    //  on purpose -- resuming it here would put game audio over an ad, which
    //  Poki rejects builds for.
    if (ctx.state === 'suspended' && !externalMute) void ctx.resume();

    return ctx;
}

/** Call from the first user gesture so mobile browsers allow playback. */
export function unlockAudio (): void
{
    ac();
}

export function isMuted (): boolean
{
    return muted;
}

export function toggleMute (): boolean
{
    muted = !muted;
    applyGain();
    return muted;
}

/**
 * Platform-level silence: an ad is on screen, or the page is hidden. Gain is
 * dropped and the context suspended, because a gain of zero still leaves
 * WebAudio scheduling work running behind an ad.
 */
export function setExternalMute (value: boolean): void
{
    if (externalMute === value) return;

    externalMute = value;
    applyGain();

    if (!ctx) return;

    try
    {
        if (externalMute) void ctx.suspend();
        else if (ctx.state === 'suspended') void ctx.resume();
    }
    catch
    {
        //  A context that refuses to change state is still silent via the gain.
    }
}

type Wave = 'sine' | 'square' | 'sawtooth' | 'triangle';

function tone (freq: number, dur: number, wave: Wave, vol: number, to?: number, delay = 0): void
{
    const c = ac();
    if (!c || !master || muted || externalMute) return;

    const t0 = c.currentTime + delay;
    const osc = c.createOscillator();
    const g = c.createGain();

    osc.type = wave;
    osc.frequency.setValueAtTime(freq, t0);
    if (to !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t0 + dur);

    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + Math.min(0.012, dur * 0.3));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    osc.connect(g);
    g.connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
}

function noise (dur: number, vol: number, hp: number, delay = 0): void
{
    const c = ac();
    if (!c || !master || muted || externalMute) return;

    const t0 = c.currentTime + delay;
    const frames = Math.max(1, Math.floor(c.sampleRate * dur));
    const buf = c.createBuffer(1, frames, c.sampleRate);
    const data = buf.getChannelData(0);

    for (let i = 0; i < frames; i++)
    {
        data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
    }

    const src = c.createBufferSource();
    src.buffer = buf;

    const filter = c.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = hp;

    const g = c.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    src.connect(filter);
    filter.connect(g);
    g.connect(master);
    src.start(t0);
}

export const Sfx = {
    hit (combo: number)
    {
        const f = 380 + Math.min(combo, 40) * 16;
        tone(f, 0.055, 'square', 0.13, f * 1.5);
        noise(0.035, 0.05, 2200);
    },

    crit ()
    {
        tone(320, 0.14, 'sawtooth', 0.16, 1180);
        tone(660, 0.1, 'square', 0.09, 1600);
        noise(0.09, 0.11, 1400);
    },

    chip ()
    {
        tone(220, 0.04, 'square', 0.07, 180);
        noise(0.03, 0.04, 3000);
    },

    miss ()
    {
        tone(180, 0.07, 'triangle', 0.07, 110);
    },

    dry ()
    {
        tone(900, 0.02, 'square', 0.025);
    },

    coin ()
    {
        tone(1180, 0.05, 'square', 0.08, 1500);
        tone(1580, 0.07, 'square', 0.06, 1900, 0.04);
    },

    golden ()
    {
        [880, 1174, 1568, 2093].forEach((f, i) => tone(f, 0.14, 'square', 0.09, f, i * 0.055));
    },

    bomb ()
    {
        noise(0.34, 0.24, 220);
        tone(180, 0.34, 'sawtooth', 0.16, 40);
    },

    expire ()
    {
        tone(300, 0.12, 'triangle', 0.06, 120);
    },

    milestone (tier: number)
    {
        const root = 440 * Math.pow(1.12, tier);
        [0, 4, 7, 12].forEach((s, i) => tone(root * Math.pow(2, s / 12), 0.16, 'square', 0.075, undefined, i * 0.045));
    },

    levelClear ()
    {
        [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.2, 'square', 0.085, undefined, i * 0.065));
    },

    reward ()
    {
        tone(1400, 0.05, 'sine', 0.06, 1800);
    },

    /**
     * A till, climbing. `step` is how deep into the cash round the player is,
     * so the vault gets more excited about itself the longer it goes on.
     */
    cash (step: number)
    {
        const f = 900 * Math.pow(1.055, Math.min(16, step));

        tone(f, 0.06, 'square', 0.085, f * 1.7);
        tone(f * 1.5, 0.05, 'sine', 0.05, f * 2.1, 0.03);
        noise(0.03, 0.035, 3600);
    },

    /** Something being fired at the player. Low, rising, and unmistakable. */
    launch ()
    {
        tone(140, 0.34, 'sawtooth', 0.09, 620);
        noise(0.12, 0.04, 900);
    },

    /**
     * A climb, for the seconds before something lands.
     *
     * `tone` fades each note out over its own length, so a riser cannot be one
     * long note -- it is a ladder of overlapping ones, each higher and louder
     * than the last. `secs` is how long the climb is, so the payoff can be
     * moved without the sound having to be retuned around it.
     */
    riser (secs: number)
    {
        const steps = 11;
        const gap = secs / steps;

        for (let i = 0; i < steps; i++)
        {
            const t = i / (steps - 1);
            const f = 190 * Math.pow(2, t * 2.3);

            tone(f, gap * 2.2, 'sawtooth', 0.018 + t * 0.05, f * 1.3, gap * i);
        }

        //  A hiss under the last half, so the climb sounds like it is gathering
        //  something rather than just getting higher.
        noise(secs * 0.5, 0.045, 1100, secs * 0.5);
    },

    /** Armoured glass coming apart. */
    shatter ()
    {
        noise(0.28, 0.13, 3200);
        [1800, 2400, 3100].forEach((f, i) => tone(f, 0.09, 'square', 0.05, f * 0.6, i * 0.035));
    },

    /** The vault opening, and the vault emptying. */
    jackpot ()
    {
        [523, 784, 1047, 1319, 1568, 2093].forEach((f, i) => tone(f, 0.26, 'square', 0.085, undefined, i * 0.055));
        noise(0.3, 0.05, 2400);
    },

    upgrade ()
    {
        tone(660, 0.24, 'sine', 0.12, 990);
        tone(990, 0.3, 'sine', 0.08, 1320, 0.05);
        noise(0.16, 0.05, 3000);
    },

    ui ()
    {
        tone(700, 0.04, 'square', 0.06, 900);
    },

    fail ()
    {
        tone(420, 0.55, 'sawtooth', 0.14, 70);
        noise(0.4, 0.08, 300);
    },

    victory ()
    {
        [523, 659, 784, 1047, 1319, 1568, 2093].forEach((f, i) => tone(f, 0.32, 'square', 0.09, undefined, i * 0.08));
    },

    /**
     * The blast doors. They move four times per level cycle, so this is a
     * servo and a latch rather than an explosion -- an impact that big, that
     * often, stops reading as weight and starts reading as noise.
     */
    door (opening: boolean)
    {
        if (opening)
        {
            tone(120, 0.3, 'sawtooth', 0.055, 380);
            noise(0.26, 0.03, 900);
            tone(660, 0.18, 'sine', 0.05, 990, 0.14);
        }
        else
        {
            tone(300, 0.24, 'sawtooth', 0.06, 90);
            noise(0.12, 0.05, 260, 0.2);
            tone(90, 0.16, 'square', 0.09, 45, 0.22);
        }
    },

    /**
     * A shot into solid concrete. Dead, dull and short -- nothing about it
     * should suggest the block is going to give if the player keeps hitting
     * it, because it never will.
     */
    clank ()
    {
        tone(96, 0.09, 'square', 0.1, 62);
        noise(0.06, 0.09, 520);
    },

    /** A link in a chain coming loose, and the next one arming itself. */
    unlock ()
    {
        tone(520, 0.05, 'square', 0.08, 880);
        tone(880, 0.09, 'sine', 0.06, 1320, 0.04);
    },

    /** A shot into a link that is not next. It is refused, not absorbed. */
    locked ()
    {
        tone(150, 0.07, 'square', 0.09, 96);
        noise(0.04, 0.05, 1400);
    },

    boom ()
    {
        noise(0.2, 0.14, 500);
        tone(140, 0.22, 'sawtooth', 0.1, 50);
    }
};
