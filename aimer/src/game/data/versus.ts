/**
 * Competitive mode -- everything that is a rule, a table or a save, and
 * nothing that is a sprite.
 *
 * A match is one minute, one target at a time, one shot per target, and the
 * same sequence of targets on both sides of the screen. The opponent is a
 * simulated player with a name the generator made up, a reaction time and an
 * aim spread picked from one of five tiers. The ladder the player climbs
 * afterwards is kept in its own save so the main run save never learns about
 * any of this.
 */

export const MATCH_SECONDS = 45;

/** The player's colour, and the opponent's. Fixed: blue is you, red is them. */
export const YOU_COLOR = 0x3f8cff;
export const YOU_COLOR_DIM = 0x1c3a75;
export const CPU_COLOR = 0xff4a5c;
export const CPU_COLOR_DIM = 0x6e1f2c;

/**
 * Points for a hit. The centre is the whole lesson of the queue screen's hint,
 * so it pays visibly more than the rim; the streak multiplies the lot, so a
 * long run of clean hits is where a match is actually won.
 */
export const SCORE = {
    base: 100,
    /** Distance from centre (fraction of radius) inside which a hit is a bullseye. */
    bullRing: 0.32,
    bullBonus: 150,
    /** Inner ring: a solid hit. */
    innerRing: 0.66,
    innerBonus: 60
};

/**
 * The combo ladder. `at` is the streak a tier starts on; the multiplier holds
 * until the next tier or the next miss. The names are what slams onto the
 * screen when a tier is reached.
 */
export interface ComboTier
{
    at: number;
    mult: number;
    name: string;
    color: number;
}

export const COMBO_TIERS: ComboTier[] = [
    { at: 0,  mult: 1,   name: '',             color: 0xffffff },
    { at: 5,  mult: 1.5, name: 'HEATING UP',   color: 0xffc857 },
    { at: 10, mult: 2,   name: 'ON FIRE',      color: 0xff8c42 },
    { at: 15, mult: 2.5, name: 'UNSTOPPABLE',  color: 0xff4a5c },
    { at: 20, mult: 3,   name: 'DOMINATING',   color: 0xff3fd8 },
    { at: 30, mult: 4,   name: 'GODLIKE',      color: 0x9b6cff }
];

export function comboTier (streak: number): ComboTier
{
    let t = COMBO_TIERS[0];
    for (const c of COMBO_TIERS) if (streak >= c.at) t = c;
    return t;
}

export function scoreHit (distFrac: number, streak: number): { points: number; tier: 'bull' | 'inner' | 'edge'; mult: number }
{
    let points = SCORE.base;
    let tier: 'bull' | 'inner' | 'edge' = 'edge';

    if (distFrac <= SCORE.bullRing) { points += SCORE.bullBonus; tier = 'bull'; }
    else if (distFrac <= SCORE.innerRing) { points += SCORE.innerBonus; tier = 'inner'; }

    const mult = comboTier(streak).mult;

    return { points: Math.round(points * mult), tier, mult };
}

//  ------------------------------------------------------------ the sequence

export interface SeqTarget
{
    /** Position as a fraction of the pane, so both panes agree on it. */
    u: number;
    v: number;
    /** Radius as a fraction of the pane's shorter side. */
    r: number;
    /** Milliseconds it stays up before it is counted as missed. */
    life: number;
    /** How many targets the pane should be keeping up once this one is out. */
    slots: number;
}

/** Small seeded PRNG (mulberry32) so both sides can replay one sequence. */
export function rng (seed: number): () => number
{
    let a = seed >>> 0;

    return () =>
    {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export function buildSequence (seed: number, count = 240): SeqTarget[]
{
    const rand = rng(seed);
    const out: SeqTarget[] = [];
    const recent: { u: number; v: number }[] = [];

    for (let i = 0; i < count; i++)
    {
        //  Never spawn on top of one that is probably still up: with three on
        //  screen at once that means clear of the last three, not just the
        //  last one.
        let u = 0.5;
        let v = 0.5;

        for (let tries = 0; tries < 12; tries++)
        {
            u = 0.1 + rand() * 0.8;
            v = 0.12 + rand() * 0.76;
            if (recent.every(p => Math.hypot(u - p.u, v - p.v) > 0.24)) break;
        }

        recent.push({ u, v });
        if (recent.length > 3) recent.shift();

        //  Smaller and shorter-lived as the minute goes on.
        const shrink = Math.min(1, i / 110);
        const r = (0.082 - shrink * 0.022) + rand() * 0.02;
        const life = Math.round(1900 - shrink * 500 + rand() * 150);

        //  Two up at a time, with a third joining in waves: the first few are
        //  a pair so the screen opens readable, and from then on roughly a
        //  third of the match runs three-wide.
        const wave = Math.floor(i / 7) % 3;
        const slots = i < 4 ? 2 : wave === 2 ? 3 : 2;

        out.push({ u, v, r, life, slots });
    }

    return out;
}

//  ------------------------------------------------------------ the opponent

export interface CpuTier
{
    level: 1 | 2 | 3 | 4 | 5;
    name: string;
    /** Mean reaction from a target appearing to a shot, and the jitter on it. */
    react: number;
    jitter: number;
    /** Chance a shot lands on the target at all. */
    accuracy: number;
    /** How far from centre a landing shot scatters, as a fraction of radius. */
    spread: number;
    /** Pause before a second try after a miss. */
    retry: number;
}

export const CPU_TIERS: CpuTier[] = [
    { level: 1, name: 'ROOKIE',  react: 820, jitter: 280, accuracy: 0.60, spread: 0.78, retry: 520 },
    { level: 2, name: 'CASUAL',  react: 660, jitter: 220, accuracy: 0.72, spread: 0.62, retry: 440 },
    { level: 3, name: 'SKILLED', react: 560, jitter: 160, accuracy: 0.83, spread: 0.46, retry: 360 },
    { level: 4, name: 'VETERAN', react: 420, jitter: 120, accuracy: 0.89, spread: 0.34, retry: 300 },
    { level: 5, name: 'ELITE',   react: 340, jitter: 90,  accuracy: 0.93, spread: 0.24, retry: 240 }
];

/**
 * Which tier to face. Skewed towards the easy end so the player wins about two
 * in three, and every win slides a little weight up the table -- a player on
 * a streak starts meeting people who can actually shoot.
 */
export function pickTier (wins: number): CpuTier
{
    const base = [ 32, 28, 20, 13, 7 ];
    const shift = Math.min(0.55, wins * 0.045);
    const w = base.map((b, i) => b * (1 + (i - 2) * shift * 0.5));
    const total = w.reduce((a, b) => a + b, 0);
    let roll = Math.random() * total;

    for (let i = 0; i < w.length; i++)
    {
        roll -= w[i];
        if (roll <= 0) return CPU_TIERS[i];
    }

    return CPU_TIERS[0];
}

//  ------------------------------------------------------------ the names

const WORDS_A = [
    'Shadow', 'Blaze', 'Frost', 'Neon', 'Ghost', 'Pixel', 'Turbo', 'Cyber', 'Hyper', 'Storm',
    'Night', 'Iron', 'Dark', 'Silent', 'Crazy', 'Lucky', 'Toxic', 'Quick', 'Rapid', 'Sneaky',
    'Mega', 'Ultra', 'Epic', 'Sly', 'Zero', 'Void', 'Nova', 'Astro', 'Crimson', 'Cosmic'
];

const WORDS_B = [
    'Wolf', 'Fox', 'Sniper', 'Ninja', 'Knight', 'Reaper', 'Viper', 'Hawk', 'Panda', 'Bean',
    'Gamer', 'Goat', 'Cat', 'Shark', 'Dragon', 'Potato', 'Phantom', 'Pirate', 'Raven', 'Tiger',
    'Blade', 'Bunny', 'Duck', 'Slayer', 'Toast', 'Rocket', 'Pickle', 'Falcon', 'Jester', 'King'
];

const SHORT = [
    'jay', 'kai', 'leo', 'max', 'zoe', 'ash', 'rex', 'sam', 'ace', 'eli', 'mia', 'ivy', 'ty', 'ben', 'noah'
];

const PREFIX = [ 'xX_', 'TTV_', 'YT_', 'iM', 'Mr', 'Its', 'The', 'Lil', 'Big', 'Not' ];

const rnd = <T>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];
const chance = (p: number) => Math.random() < p;

/**
 * A name a real person would have typed into a box -- two words and a number
 * most of the time, with enough lowercase, underscores and clan tags mixed in
 * that a queue of them does not look like a word list.
 */
export function generateName (): string
{
    const style = Math.random();
    let name: string;

    if (style < 0.42)
    {
        name = rnd(WORDS_A) + rnd(WORDS_B);
    }
    else if (style < 0.62)
    {
        name = rnd(WORDS_A) + '_' + rnd(WORDS_B);
    }
    else if (style < 0.78)
    {
        name = rnd(WORDS_B).toLowerCase() + rnd(SHORT);
    }
    else if (style < 0.9)
    {
        name = rnd(SHORT) + '.' + rnd(WORDS_B).toLowerCase();
    }
    else
    {
        name = rnd(WORDS_A).toLowerCase() + rnd(WORDS_B).toLowerCase();
    }

    if (chance(0.55))
    {
        const n = Math.random();
        const num = n < 0.3 ? Math.floor(Math.random() * 100)
            : n < 0.65 ? 1990 + Math.floor(Math.random() * 25)
            : n < 0.85 ? Math.floor(Math.random() * 10)
            : Math.floor(Math.random() * 10000);

        name += chance(0.3) ? '_' + num : String(num);
    }

    if (chance(0.18))
    {
        const p = rnd(PREFIX);
        name = p + name + (p === 'xX_' ? '_Xx' : '');
    }

    if (chance(0.08)) name = name.toLowerCase();

    return name.length > 16 ? name.slice(0, 16) : name;
}

//  ------------------------------------------------------------ the hints

export const HINTS = [
    'Hitting the CENTER of a target scores more points.',
    'A bullseye pays +150. The rim pays nothing extra.',
    'Every hit in a row grows your combo. 10 straight = 2x points.',
    'A miss resets your combo multiplier. Accuracy beats speed.',
    'Targets shrink as the clock runs down. Stay sharp.',
    'Both players see the exact same targets. Pure aim.',
    'One shot per target. Aim for the middle ring.',
    'Your opponent is red. You are blue. Most points wins.'
];

export function randomHint (): string
{
    return HINTS[Math.floor(Math.random() * HINTS.length)];
}

//  ------------------------------------------------------------ the ladder

export interface LadderEntry
{
    name: string;
    score: number;
    /** True for the player's own row. */
    you?: boolean;
    /** Set on the row of the opponent the player has just played. */
    recent?: boolean;
}

export interface VersusSave
{
    wins: number;
    losses: number;
    streak: number;
    bestStreak: number;
    best: number;
    rating: number;
    /** The bots that make up the ladder. Seeded once, then reshuffled by play. */
    ladder: LadderEntry[];
    /** Last opponent, so the result screen can mark their row. */
    lastOpponent: string;
}

const SAVE_KEY = 'aimer.versus.v1';

function seedLadder (): LadderEntry[]
{
    const out: LadderEntry[] = [];
    const seen = new Set<string>();

    while (out.length < 12)
    {
        const name = generateName();
        if (seen.has(name)) continue;
        seen.add(name);

        //  A ladder that a first match can land in the middle of -- the top
        //  is out of reach, the bottom is beatable on day one.
        out.push({ name, score: 9000 + Math.round(Math.random() * 29000) });
    }

    return out.sort((a, b) => b.score - a.score);
}

function load (): VersusSave
{
    try
    {
        const raw = localStorage.getItem(SAVE_KEY);

        if (raw)
        {
            const p = JSON.parse(raw);

            if (p && Array.isArray(p.ladder) && p.ladder.length > 0)
            {
                return {
                    wins: Math.max(0, Number(p.wins) || 0),
                    losses: Math.max(0, Number(p.losses) || 0),
                    streak: Math.max(0, Number(p.streak) || 0),
                    bestStreak: Math.max(0, Number(p.bestStreak) || 0),
                    best: Math.max(0, Number(p.best) || 0),
                    rating: Number(p.rating) || 1000,
                    ladder: p.ladder.filter((e: LadderEntry) => e && typeof e.name === 'string')
                        .map((e: LadderEntry) => ({ name: e.name, score: Number(e.score) || 0 })),
                    lastOpponent: typeof p.lastOpponent === 'string' ? p.lastOpponent : ''
                };
            }
        }
    }
    catch { /* fall through */ }

    return { wins: 0, losses: 0, streak: 0, bestStreak: 0, best: 0, rating: 1000, ladder: seedLadder(), lastOpponent: '' };
}

export const versus: VersusSave = load();

export function saveVersus (): void
{
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(versus)); }
    catch { /* storage unavailable */ }
}

export interface MatchOutcome
{
    won: boolean;
    draw: boolean;
    you: number;
    cpu: number;
    cpuName: string;
    tier: CpuTier;
    ratingDelta: number;
    newBest: boolean;
}

/**
 * Settle a finished match into the save: record, streak, rating, and the
 * opponent's score onto the ladder so it is a ladder of people the player
 * has actually met.
 */
export function recordMatch (you: number, cpu: number, cpuName: string, tier: CpuTier): MatchOutcome
{
    const draw = you === cpu;
    const won = you > cpu;

    if (won)
    {
        versus.wins += 1;
        versus.streak += 1;
        versus.bestStreak = Math.max(versus.bestStreak, versus.streak);
    }
    else if (!draw)
    {
        versus.losses += 1;
        versus.streak = 0;
    }

    //  Beating an ELITE is worth far more than beating a ROOKIE, and losing
    //  to one costs far less.
    const stake = 10 + tier.level * 6;
    const ratingDelta = draw ? 0 : won ? stake : -Math.round(stake * 0.7);
    versus.rating = Math.max(0, versus.rating + ratingDelta);

    const newBest = you > versus.best;
    versus.best = Math.max(versus.best, you);
    versus.lastOpponent = cpuName;

    //  The opponent joins the ladder, bumping the weakest bot if it is full.
    const ladder = versus.ladder.filter(e => e.name !== cpuName);
    ladder.push({ name: cpuName, score: cpu });
    ladder.sort((a, b) => b.score - a.score);
    versus.ladder = ladder.slice(0, 12);

    saveVersus();

    return { won, draw, you, cpu, cpuName, tier, ratingDelta, newBest };
}

/** The ladder as shown: bots plus the player's own best, ranked together. */
export function ladderRows (): LadderEntry[]
{
    const rows: LadderEntry[] = versus.ladder.map(e => ({
        name: e.name, score: e.score, recent: e.name === versus.lastOpponent
    }));

    rows.push({ name: 'YOU', score: versus.best, you: true });
    rows.sort((a, b) => b.score - a.score || (a.you ? -1 : 1));

    return rows;
}
