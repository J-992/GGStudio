import { GameObjects, Scene } from 'phaser';
import type { Zone } from '../data/zones';
import { H, PLAY, W, mix } from './theme';
import { Cam, Quad, boxFaces, fillCell, fillQuad, floorGrid, project, quadVisible, scaleAt } from './perspective';

/**
 * The world behind the targets.
 *
 * Each zone gets a place, not a palette swap: a shooting range, a city canyon
 * at dusk, a flooded storm plaza, a lava tunnel, a reactor throat, high orbit,
 * and whatever is on fire at the end. The player should be able to tell, at a
 * glance and with the sound off, that they are somewhere they have not been --
 * and, more importantly, that they are *going* somewhere.
 *
 * Everything here is drawn through `core/perspective`. That is the whole
 * change: the backdrops used to be flat elevations pasted behind the arena,
 * and now they are boxes and floors standing on a ground plane with a real
 * vanishing point in it. A tower has a lit face and a dark flank, its window
 * rows bunch up as the wall turns away, and the street it stands on runs off
 * into the distance and keeps coming. The forward drift is slow -- this is a
 * backdrop, not a runner -- but it never stops, so the run always reads as
 * travelling rather than as standing in a series of rooms.
 *
 * Two of the values the art is already animating are also the law of the zone,
 * and are read straight off this object by the play scene rather than being
 * simulated twice:
 *
 *   `wind`  the crosswind the city is leaning into, in px/sec.
 *   `spin`  how fast the reactor is turning, in radians/sec.
 *
 * So the buildings sliding left are the same fact as the targets sliding left.
 */

const AREA_H = PLAY.bottom - PLAY.top;

function ay (t: number): number
{
    return PLAY.top + AREA_H * t;
}

/**
 * Portrait is the box the worlds were authored in. A wide screen gets a wider
 * slice of the same world rather than a stretched one, so every world-space
 * width below is measured in these units.
 */
const SPREAD = W / 540;

interface Speck { x: number; y: number; r: number; s: number; }
interface Streak { x: number; y: number; len: number; s: number; }

/** One building in the city, in world units. */
interface Block
{
    x0: number;
    x1: number;
    z: number;
    /** How far back from its own near face the block runs. */
    deep: number;
    h: number;
    /** 0..1, decides window density, neon and beacons. Fixed at build time. */
    seed: number;
    neon: number;
}

/** A light travelling down the street or across the sky. */
interface Mover { x: number; z: number; y: number; speed: number; hue: number; }

/** How far back the city runs before it wraps around to the front again. */
const CITY_SPAN = 2600;

export class Backdrop
{
    /** Crosswind, px/sec. Non-zero only where the zone's rule says so. */
    wind = 0;
    /** Field rotation, radians/sec. */
    spin = 0;

    /**
     * Weather dials, set by the scene from the level's hazard spec. The art and
     * the rule are the same number: a stronger gust is both a harder level and
     * a visibly windier city, and there is no way to tune one without the other.
     */
    gust = 1;
    /** >1 blacks the storm out sooner and holds it there longer. */
    storm = 1;

    private zone: Zone;
    private dyn: GameObjects.Graphics;
    private shroudGfx: GameObjects.Graphics;
    private owned: GameObjects.GameObject[] = [];

    private t = 0;
    private scroll = 0;

    /** The eye every perspective world is drawn through. */
    private cam: Cam = { x: 0, height: 90, focal: 330, horizon: ay(0.3), z: 0 };

    private specks: Speck[] = [];
    private streaks: Streak[] = [];
    private blocks: Block[] = [];
    private movers: Mover[] = [];
    /** Scratch list for depth-sorting the city, reused every frame. */
    private order: { b: Block; z: number }[] = [];

    constructor (scene: Scene, zone: Zone)
    {
        this.zone = zone;

        const statics = scene.add.graphics().setDepth(0);
        this.owned.push(statics);

        this.dyn = scene.add.graphics().setDepth(1);
        this.owned.push(this.dyn);

        //  The blackout curtain hangs between the world and the targets, so a
        //  blacked-out arena still shows every target lit up in it.
        this.shroudGfx = scene.add.graphics().setDepth(8);
        this.owned.push(this.shroudGfx);

        this.build(statics);
    }

    destroy (): void
    {
        for (const o of this.owned) o.destroy();
        this.owned = [];
    }

    update (dtMs: number): void
    {
        this.t += dtMs;
        this.scroll += dtMs;

        const g = this.dyn;
        g.clear();

        switch (this.zone.backdrop)
        {
            case 'range':      this.drawRange(g); break;
            case 'skyline':    this.drawSkyline(g); break;
            case 'storm':      this.drawStorm(g, dtMs); break;
            case 'cavern':     this.drawCavern(g); break;
            case 'reactor':    this.drawReactor(g); break;
            case 'orbitfield': this.drawOrbitfield(g); break;
            case 'crimson':    this.drawCrimson(g, dtMs); break;
        }
    }

    //  ------------------------------------------------------------- shared

    /**
     * The line the world ends on, and the haze that sits on it. Drawn at the
     * camera's own vanishing point, so it is the line everything else in the
     * scene is already converging towards rather than a stripe near the top.
     */
    private horizon (g: GameObjects.Graphics, color: number, alpha = 0.35, glow = true): void
    {
        const y = this.cam.horizon;

        if (glow)
        {
            for (let i = 7; i >= 1; i--)
            {
                g.fillStyle(color, alpha * 0.012 * i);
                g.fillRect(0, y - i * 9, W, i * 18);
            }
        }

        g.lineStyle(1.5, color, alpha * 0.7);
        g.lineBetween(0, y, W, y);
    }

    /** Everything below the horizon, as ground rather than as background. */
    private ground (g: GameObjects.Graphics, color: number, alpha = 1): void
    {
        g.fillStyle(color, alpha);
        g.fillRect(0, this.cam.horizon, W, H - this.cam.horizon + 2);
    }

    /** A vertical wash from the top of the frame down to the horizon. */
    private sky (g: GameObjects.Graphics, top: number, bottom: number, bands = 16): void
    {
        const y1 = this.cam.horizon;

        for (let i = 0; i < bands; i++)
        {
            g.fillStyle(mix(top, bottom, i / (bands - 1)), 1);
            g.fillRect(0, (y1 / bands) * i, W, y1 / bands + 1.5);
        }
    }

    private build (g: GameObjects.Graphics): void
    {
        const z = this.zone.palette;

        switch (this.zone.backdrop)
        {
            case 'range': this.buildRange(g); break;
            case 'skyline': this.buildSkyline(g); break;
            case 'storm': this.buildStorm(g); break;
            case 'cavern': this.buildCavern(g); break;
            case 'reactor': this.buildReactor(g); break;
            case 'orbitfield': this.buildOrbitfield(g); break;
            case 'crimson': this.buildCrimson(g); break;
        }

        //  A last breath of the zone's own colour along the very top of the
        //  frame. Feathered rather than a flat wash: a hard-edged rectangle
        //  ending at the arena line drew a seam across every single sky.
        for (let i = 0; i < 10; i++)
        {
            g.fillStyle(z.accent, 0.012 * (10 - i));
            g.fillRect(0, (PLAY.top / 10) * i, W, PLAY.top / 10 + 1.5);
        }
    }

    //  -------------------------------------------------------------- range

    private buildRange (g: GameObjects.Graphics): void
    {
        const p = this.zone.palette;

        this.cam = { x: 0, height: 126, focal: 300, horizon: ay(0.28), z: 0 };

        //  Nothing static but the dark the room is lit against. The range is a
        //  room, and a room has to be drawn every frame or it does not move.
        g.fillStyle(mix(p.bg, 0x000000, 0.45), 1);
        g.fillRect(0, 0, W, H);
    }

    private drawRange (g: GameObjects.Graphics): void
    {
        const p = this.zone.palette;
        const cam = this.cam;

        //  The range comes towards the shooter at a walking pace. It is the
        //  first thing the player ever sees move, and it is the promise the
        //  rest of the run keeps.
        cam.z = this.t * 0.022;

        const FAR = 1500;
        const WALL = 330 * SPREAD;
        const ROOF = 330;

        //  The room: floor, ceiling and two walls, each one quad running the
        //  whole length of the range. Four surfaces converging on one point is
        //  all it takes for a flat screen to become somewhere you are standing.
        const floor: Quad = [
            project(cam, -WALL, 0, FAR), project(cam, WALL, 0, FAR),
            project(cam, WALL, 0, 60), project(cam, -WALL, 0, 60)
        ];

        fillQuad(g, floor, mix(p.bg, 0x000000, 0.2), 1);

        const ceil: Quad = [
            project(cam, -WALL, ROOF, 60), project(cam, WALL, ROOF, 60),
            project(cam, WALL, ROOF, FAR), project(cam, -WALL, ROOF, FAR)
        ];

        fillQuad(g, ceil, mix(p.bg, 0x000000, 0.55), 1);

        for (const side of [ -1, 1 ])
        {
            const x = side * WALL;

            fillQuad(g, [
                project(cam, x, ROOF, FAR), project(cam, x, ROOF, 60),
                project(cam, x, 0, 60), project(cam, x, 0, FAR)
            ], mix(p.bg, p.grid, side < 0 ? 0.16 : 0.1), 1);
        }

        //  The back wall, closing the room off around the vanishing point.
        fillQuad(g, [
            project(cam, -WALL, ROOF, FAR), project(cam, WALL, ROOF, FAR),
            project(cam, WALL, 0, FAR), project(cam, -WALL, 0, FAR)
        ], mix(p.bg, p.grid, 0.32), 1);

        floorGrid(g, cam, {
            half: WALL, step: 64, far: FAR,
            color: p.grid, alpha: 0.5, rails: 6, height: H
        });

        //  Strip lights in the ceiling, marching away -- the clearest depth
        //  cue in the room, because they are evenly spaced and obviously so.
        const lightStep = 260;
        const lightOff = ((cam.z % lightStep) + lightStep) % lightStep;

        for (let z = FAR; z > 60; z -= lightStep)
        {
            const zz = z - lightOff;

            //  A light directly overhead is a slab of colour across the top of
            //  the frame and nothing else; it stays out until it is far enough
            //  away to read as a light.
            if (zz < 190) continue;

            const q: Quad = [
                project(cam, -74 * SPREAD, ROOF - 4, zz + 60),
                project(cam, 74 * SPREAD, ROOF - 4, zz + 60),
                project(cam, 74 * SPREAD, ROOF - 4, zz),
                project(cam, -74 * SPREAD, ROOF - 4, zz)
            ];

            if (quadVisible(q, W, H)) fillQuad(g, q, mix(p.accent2, 0xffffff, 0.3), 0.28 * (1 - zz / FAR) + 0.12);
        }

        //  Lane dividers: low walls either side of the firing lane.
        for (const side of [ -1, 1 ])
        {
            const x = side * 168 * SPREAD;

            const q: Quad = [
                project(cam, x, 42, FAR), project(cam, x, 42, 90),
                project(cam, x, 0, 90), project(cam, x, 0, FAR)
            ];

            fillQuad(g, q, mix(p.bg, p.grid, 0.5), 0.9);

            g.lineStyle(2, p.accent, 0.4);
            g.lineBetween(q[0].x, q[0].y, q[1].x, q[1].y);
        }

        //  Paper targets standing in the lanes at honest depths -- the same
        //  card, eight times, and only the distance makes them different sizes.
        const step = 190;
        const off = ((cam.z % step) + step) % step;

        for (let i = 8; i >= 0; i--)
        {
            const zz = 55 + i * step - off;

            if (zz < 45) continue;

            for (const side of [ -1, 0, 1 ])
            {
                const wx = side * 112 * SPREAD;
                const k = scaleAt(cam, zz);
                const fade = Math.max(0.15, Math.min(1, 1 - zz / FAR));

                //  The stand it is pinned to, then the card itself.
                const foot = project(cam, wx, 0, zz);
                const head = project(cam, wx, 52, zz);

                g.lineStyle(Math.max(1, k * 0.022), p.grid, 0.55 * fade);
                g.lineBetween(foot.x, foot.y, head.x, head.y);

                //  Hung below eye level, so the near ones drop down the frame
                //  and the far ones ride up to the vanishing point. Pinned at
                //  eye height they all sat on one line and the row read flat.
                const c = project(cam, wx, 84, zz);

                for (let r = 4; r >= 1; r--)
                {
                    g.fillStyle(r % 2 ? 0xdfe8ff : p.accent, (r === 1 ? 0.6 : 0.34) * fade);
                    g.fillCircle(c.x, c.y, r * 10 * k * 0.42);
                }
            }
        }

        this.horizon(g, p.accent, 0.22);

        //  A single calibration sweep running away down the range.
        const sweep = 70 + ((this.t * 0.28) % (FAR - 100));
        const a = project(cam, -WALL, 0, sweep);
        const b = project(cam, WALL, 0, sweep);

        g.lineStyle(1.5 + scaleAt(cam, sweep) * 0.015, p.accent, 0.24);
        g.lineBetween(a.x, a.y, b.x, b.y);
    }

    //  ------------------------------------------------------------ skyline

    /**
     * The city, and the zone this whole rewrite exists for.
     *
     * It is a street canyon: two rows of towers marching away from the eye
     * either side of an avenue, with the vanishing point sitting a little above
     * the middle of the arena. Every tower is a box -- a lit front face, a dark
     * flank turning away towards the vanishing point, a roof if it is short
     * enough to look down on -- and the windows are cells of those faces, so
     * they compress along the flank exactly as far as the geometry says they
     * should. Nothing about the foreshortening is drawn by hand.
     *
     * The camera crawls forward for ever and slides sideways with the wind,
     * which is also the zone's rule. When the crosswind picks up and starts
     * dragging the targets, the near towers swing across the far ones by the
     * same amount, in the same direction, because they are the same number.
     */
    private buildSkyline (g: GameObjects.Graphics): void
    {
        const p = this.zone.palette;

        this.cam = { x: 0, height: 92, focal: 330, horizon: ay(0.34), z: 0 };

        //  Dusk, burning off towards the horizon the city recedes into.
        this.sky(g, mix(p.bg, 0x000000, 0.35), mix(p.bg, p.accent, 0.34), 18);

        for (let i = 0; i < 70; i++)
        {
            const y = Math.random() * this.cam.horizon;
            const fade = 1 - y / this.cam.horizon;

            g.fillStyle(0xffffff, (0.08 + Math.random() * 0.4) * fade);
            g.fillCircle(Math.random() * W, y, Math.random() * 1.3 + 0.3);
        }

        //  A moon, low and huge, sitting behind the far end of the avenue.
        const mx = W * 0.74;
        const my = this.cam.horizon - 108;

        for (let i = 14; i >= 1; i--)
        {
            g.fillStyle(p.accent2, 0.016);
            g.fillCircle(mx, my, 34 + i * 7);
        }

        g.fillStyle(mix(p.accent2, 0xffffff, 0.5), 0.85);
        g.fillCircle(mx, my, 32);
        g.fillStyle(mix(p.bg, p.accent2, 0.55), 0.4);
        g.fillCircle(mx - 9, my - 7, 30);

        //  --- the city itself ---
        const half = 168 * SPREAD;

        for (let z = 50; z < CITY_SPAN; z += 74 + Math.random() * 86)
        {
            for (const side of [ -1, 1 ])
            {
                const w = (56 + Math.random() * 128) * SPREAD;
                const gap = Math.random() * 150 * SPREAD;
                const x0 = side < 0 ? -(half + gap + w) : half + gap;

                this.blocks.push({
                    x0,
                    x1: x0 + w,
                    z,
                    deep: 70 + Math.random() * 120,
                    //  A short block is one you look down on; the run of tall
                    //  ones is what makes the canyon a canyon.
                    h: Math.random() < 0.18 ? 40 + Math.random() * 44 : 150 + Math.random() * 520,
                    seed: Math.random(),
                    neon: Math.random()
                });
            }
        }

        //  Traffic down the avenue, and a couple of things crossing above it.
        for (let i = 0; i < 8; i++)
        {
            this.movers.push({
                x: (Math.random() < 0.5 ? -1 : 1) * (46 + Math.random() * 90) * SPREAD,
                z: Math.random() * CITY_SPAN,
                y: 4,
                speed: 90 + Math.random() * 130,
                hue: Math.random() < 0.5 ? 0xffe9b0 : 0xff5470
            });
        }

        for (let i = 0; i < 3; i++)
        {
            this.movers.push({
                x: (Math.random() * 2 - 1) * 500 * SPREAD,
                z: 400 + Math.random() * 1400,
                y: 420 + Math.random() * 320,
                speed: -(30 + Math.random() * 40),
                hue: 0x9fe8ff
            });
        }
    }

    private drawSkyline (g: GameObjects.Graphics): void
    {
        const p = this.zone.palette;
        const cam = this.cam;

        //  The wind is a slow swing, and it is the zone's whole rule: whatever
        //  the city is leaning into, the targets are being dragged into too.
        this.wind = Math.sin(this.t * 0.00022) * 62 * this.gust;

        cam.z = this.t * 0.026;
        cam.x = -this.wind * 0.6;

        const asphalt = mix(p.bg, 0x000000, 0.62);

        this.ground(g, asphalt);
        this.horizon(g, p.accent, 0.34);

        //  The avenue, running out from under the player's feet.
        floorGrid(g, cam, {
            half: 165 * SPREAD, step: 120, far: 1700,
            color: mix(p.grid, 0xffffff, 0.2), alpha: 0.24, rails: 4, height: H
        });

        //  Centre line: dashes at fixed world depths, so they stretch towards
        //  the eye and bunch towards the vanishing point on their own.
        const dashOff = ((cam.z % 150) + 150) % 150;

        for (let z = 300 - dashOff; z < 1500; z += 150)
        {
            const q: Quad = [
                project(cam, -5 * SPREAD, 0, z + 62),
                project(cam, 5 * SPREAD, 0, z + 62),
                project(cam, 5 * SPREAD, 0, z),
                project(cam, -5 * SPREAD, 0, z)
            ];

            if (quadVisible(q, W, H)) fillQuad(g, q, 0xffd23f, 0.16 * (1 - z / 1700));
        }

        //  --- towers, far to near ---
        this.order.length = 0;

        for (const b of this.blocks)
        {
            const z = ((b.z - cam.z) % CITY_SPAN + CITY_SPAN) % CITY_SPAN;

            if (z < 34 || z > 1750) continue;

            this.order.push({ b, z });
        }

        this.order.sort((a, c) => c.z - a.z);

        for (const item of this.order) this.tower(g, item.b, item.z);

        //  Traffic. A vehicle is two pixels of light, but two pixels of light
        //  travelling down a street that has depth is a city being lived in.
        for (const m of this.movers)
        {
            m.z -= (m.speed - 26) * 0.016;

            if (m.z < 30) m.z += CITY_SPAN;
            if (m.z > CITY_SPAN) m.z -= CITY_SPAN;

            const z = m.z;

            if (z > 1500) continue;

            const c = project(cam, m.x, m.y, z);
            const k = scaleAt(cam, z);
            const fade = 1 - z / 1500;

            g.fillStyle(m.hue, 0.14 * fade);
            g.fillCircle(c.x, c.y, Math.max(1.5, 22 * k * 0.28));
            g.fillStyle(m.hue, 0.85 * fade);
            g.fillCircle(c.x, c.y, Math.max(0.8, 7 * k * 0.28));
        }

        //  Wind streaks, blowing the way the wind blows.
        const dir = Math.sign(this.wind) || 1;

        for (let i = 0; i < 12; i++)
        {
            const phase = (this.t * 0.0006 * Math.abs(this.wind) * 0.06 + i * 0.137) % 1;
            const x = dir > 0 ? phase * (W + 200) - 100 : W + 100 - phase * (W + 200);
            //  Above the horizon only. Streaks drawn down the black face of a
            //  near tower read as scratches on the lens, not as weather.
            const y = 26 + ((i * 97) % Math.max(40, cam.horizon - 50));
            const len = 26 + Math.abs(this.wind) * 0.55;

            g.lineStyle(2, p.dust, 0.07 + Math.abs(this.wind) / 62 * 0.13);
            g.lineBetween(x, y, x - dir * len, y);
        }
    }

    /** One building: lit face, dark flank, roof if you can see it, windows in all of it. */
    private tower (g: GameObjects.Graphics, b: Block, z: number): void
    {
        const p = this.zone.palette;
        const cam = this.cam;

        const faces = boxFaces(cam, { x0: b.x0, x1: b.x1, z0: z, z1: z + b.deep, h: b.h });

        if (!quadVisible(faces.front, W, H)) return;

        //  Aerial perspective: the far end of the avenue dissolves into the sky
        //  it is standing against instead of stopping dead.
        const fog = Math.min(0.86, z / 1500);
        const haze = mix(p.bg, p.accent, 0.3);

        const front = mix(mix(p.bg, 0x000000, 0.72), haze, fog);
        const flank = mix(mix(p.bg, 0x000000, 0.86), haze, fog * 0.9);

        if (faces.side && quadVisible(faces.side, W, H))
        {
            fillQuad(g, faces.side, flank, 1);
            this.windows(g, faces.side, b, 0.68, fog, p.accent2);
        }

        fillQuad(g, faces.front, front, 1);
        this.windows(g, faces.front, b, 1, fog, p.accent2);

        if (faces.roof && quadVisible(faces.roof, W, H))
        {
            fillQuad(g, faces.roof, mix(front, 0xffffff, 0.08), 1);
        }

        //  Edge light down the corner nearest the eye -- the one line that
        //  stops a night city reading as a row of black holes.
        const edgeA = faces.front[0];
        const edgeB = faces.front[3];

        g.lineStyle(1.2, mix(p.accent, 0xffffff, 0.3), 0.16 * (1 - fog));
        g.lineBetween(edgeA.x, edgeA.y, edgeB.x, edgeB.y);

        //  Neon: a band across the face of about one building in four, in the
        //  colour the whole world is lit by.
        if (b.neon > 0.72)
        {
            const hue = b.neon > 0.9 ? p.accent2 : p.accent;
            const v = 0.1 + b.seed * 0.3;

            fillCell(g, faces.front, 0.08, 0.92, v, v + 0.045, hue, 0.75 * (1 - fog));
            fillCell(g, faces.front, 0.08, 0.92, v - 0.02, v + 0.065, hue, 0.2 * (1 - fog));
        }

        //  Aircraft beacon on anything tall, blinking on its own clock.
        if (b.h > 380)
        {
            const top = project(cam, (b.x0 + b.x1) / 2, b.h + 8, z);
            const blink = (this.t * 0.0013 + b.seed * 6.28) % 1;

            if (blink < 0.3)
            {
                const k = scaleAt(cam, z);

                g.fillStyle(0xff3b45, 0.9 * (1 - fog));
                g.fillCircle(top.x, top.y, Math.max(1.2, 9 * k * 0.28));
                g.fillStyle(0xff3b45, 0.2 * (1 - fog));
                g.fillCircle(top.x, top.y, Math.max(3, 26 * k * 0.28));
            }
        }
    }

    /**
     * Lit windows, as cells of the face they are in. The rows and columns are
     * in the wall's own coordinates, which is the entire trick: on the flank of
     * a tower turning away from the eye, the same even spacing comes out
     * squeezed towards the far edge because the four corners it interpolates
     * between were projected properly.
     */
    private windows (g: GameObjects.Graphics, q: Quad, b: Block, bright: number, fog: number, hue: number): void
    {
        //  A wall too small on screen to hold a window is drawn as one wash of
        //  light instead of forty draw calls nobody can see.
        const w = Math.abs(q[1].x - q[0].x) + Math.abs(q[2].x - q[3].x);
        const h = Math.abs(q[3].y - q[0].y) + Math.abs(q[2].y - q[1].y);

        if (w < 8 || h < 10) return;

        if (w < 26 || h < 34)
        {
            fillQuad(g, q, hue, 0.05 * bright * (1 - fog));
            return;
        }

        const cols = Math.max(2, Math.min(7, Math.round(w / 26)));
        const rows = Math.max(3, Math.min(18, Math.round(h / 22)));

        const cw = 0.62 / cols;
        const rh = 0.55 / rows;

        for (let r = 0; r < rows; r++)
        {
            for (let c = 0; c < cols; c++)
            {
                //  Deterministic scatter -- lit windows must not crawl as the
                //  camera moves, or the whole city shimmers.
                const n = ((r * 73856093) ^ (c * 19349663) ^ Math.round(b.seed * 83492791)) >>> 0;

                if ((n % 100) > 46) continue;

                const warm = (n >> 7) % 3;
                const color = warm === 0 ? hue : (warm === 1 ? 0xffd9a0 : mix(hue, 0xffffff, 0.5));
                const flick = (n >> 11) % 17 === 0 ? 0.4 + Math.abs(Math.sin(this.t * 0.004 + c)) * 0.6 : 1;

                const u0 = (c + 0.2) / cols;
                const v0 = (r + 0.22) / rows;

                fillCell(g, q, u0, u0 + cw, v0, v0 + rh, color, 0.5 * bright * flick * (1 - fog));
            }
        }
    }

    //  -------------------------------------------------------------- storm

    private buildStorm (g: GameObjects.Graphics): void
    {
        const p = this.zone.palette;

        this.cam = { x: 0, height: 84, focal: 320, horizon: ay(0.3), z: 0 };

        this.sky(g, mix(p.bg, 0x000000, 0.5), mix(p.bg, p.grid, 0.55), 14);

        //  Cloud deck, stacked low over the vanishing point.
        for (let i = 0; i < 8; i++)
        {
            const y = 16 + i * (this.cam.horizon / 9);
            g.fillStyle(mix(p.bg, p.grid, 0.35 + i * 0.06), 0.85);
            g.fillEllipse(W * (i % 2 ? 0.32 : 0.7), y, W * (0.7 + (i % 3) * 0.22), 74);
        }

        //  A drowned city, a long way off, giving the rain something to fall on.
        const half = 250 * SPREAD;

        for (let z = 900; z < 2000; z += 120 + Math.random() * 90)
        {
            for (const side of [ -1, 1 ])
            {
                const w = (60 + Math.random() * 130) * SPREAD;
                const gap = Math.random() * 220 * SPREAD;
                const x0 = side < 0 ? -(half + gap + w) : half + gap;

                this.blocks.push({
                    x0, x1: x0 + w, z, deep: 90,
                    h: 180 + Math.random() * 480,
                    seed: Math.random(), neon: Math.random()
                });
            }
        }

        for (let i = 0; i < 110; i++)
        {
            this.streaks.push({
                x: Math.random() * (W + 200) - 100,
                y: Math.random() * H,
                len: 16 + Math.random() * 26,
                s: 620 + Math.random() * 460
            });
        }
    }

    /** 0 while the storm is clear, 1 at the blackest moment of a blackout. */
    private blackout (): { dark: number; flash: number }
    {
        //  One cycle: a stretch of clear-ish sky, then the light goes, then a
        //  lightning strike puts it back. Never long enough to feel unfair --
        //  but the deeper into the storm the level sits, the shorter the clear
        //  stretch and the longer the dark one.
        const clear = 5000 / this.storm;
        const hold = 1600 * this.storm;
        const period = clear + 700 + hold + 900;
        const p = this.t % period;

        if (p < clear) return { dark: 0, flash: 0 };
        if (p < clear + 700) return { dark: (p - clear) / 700, flash: 0 };
        if (p < clear + 700 + hold) return { dark: 1, flash: 0 };

        const out = (p - clear - 700 - hold) / 900;

        return { dark: 1 - out, flash: out < 0.22 ? 1 - out / 0.22 : 0 };
    }

    private drawStorm (g: GameObjects.Graphics, dtMs: number): void
    {
        const p = this.zone.palette;
        const cam = this.cam;
        const { dark, flash } = this.blackout();

        cam.z = this.t * 0.014;

        const clear = 1 - dark;

        //  Standing water, not asphalt: the plaza is flooded, so it holds the
        //  sky and everything the lightning does to it.
        this.ground(g, mix(p.bg, 0x000000, 0.45));

        floorGrid(g, cam, {
            half: 320 * SPREAD, step: 90, far: 1600,
            color: p.grid, alpha: 0.26 * clear, rails: 6, height: H
        });

        this.horizon(g, p.accent, 0.32 * clear);

        //  Distant towers, drowned in the murk.
        this.order.length = 0;

        for (const b of this.blocks)
        {
            const z = ((b.z - cam.z) % 2400 + 2400) % 2400;
            if (z < 500 || z > 2100) continue;
            this.order.push({ b, z });
        }

        this.order.sort((a, c) => c.z - a.z);

        for (const item of this.order)
        {
            const faces = boxFaces(cam, {
                x0: item.b.x0, x1: item.b.x1, z0: item.z, z1: item.z + item.b.deep, h: item.b.h
            });

            if (!quadVisible(faces.front, W, H)) continue;

            const fog = Math.min(0.9, (item.z - 400) / 1700);
            const body = mix(0x000000, mix(p.bg, p.grid, 0.7), fog);

            if (faces.side && quadVisible(faces.side, W, H)) fillQuad(g, faces.side, mix(body, 0x000000, 0.4), 0.9 * clear + 0.1);
            fillQuad(g, faces.front, body, 0.9 * clear + 0.1);

            //  A handful of windows still burning out there, and the flash
            //  finds every one of them at once.
            if (item.b.seed > 0.55)
            {
                fillCell(g, faces.front, 0.3, 0.7, 0.12 + item.b.seed * 0.4, 0.15 + item.b.seed * 0.4,
                    p.accent2, (0.06 + flash * 0.45) * (1 - fog));
            }
        }

        //  Pylons marching down both sides of the flooded avenue.
        const off = ((cam.z % 210) + 210) % 210;

        for (let z = 210 - off; z < 1500; z += 210)
        {
            for (const side of [ -1, 1 ])
            {
                const x = side * 235 * SPREAD;
                const base = project(cam, x, 0, z);
                const top = project(cam, x, 260, z);
                const arm0 = project(cam, x - 46 * SPREAD, 226, z);
                const arm1 = project(cam, x + 46 * SPREAD, 226, z);
                const fade = (1 - z / 1500) * clear;

                g.lineStyle(Math.max(1, scaleAt(cam, z) * 0.055), 0x000000, 0.55 + fade * 0.35);
                g.lineBetween(base.x, base.y, top.x, top.y);
                g.lineBetween(arm0.x, arm0.y, arm1.x, arm1.y);

                //  Reflection in the water, upside down and half swallowed.
                const refl = project(cam, x, -150, z);
                g.lineStyle(Math.max(1, scaleAt(cam, z) * 0.04), p.accent2, 0.06 * fade);
                g.lineBetween(base.x, base.y, refl.x, refl.y);
            }
        }

        //  Rain. A drop near the eye is long and fast; one at the far end of
        //  the plaza is a short scratch, because it is further away.
        for (const s of this.streaks)
        {
            s.y += s.s * (dtMs / 1000);
            s.x -= s.s * 0.18 * (dtMs / 1000);

            if (s.y > H) { s.y = -30; s.x = Math.random() * (W + 200) - 60; }
            if (s.x < -80) s.x = W + 60;

            //  Depth is faked off the screen position, which for rain is both
            //  correct enough and free: drops low in the frame are near.
            const depth = Math.max(0.25, Math.min(1, (s.y - cam.horizon) / (H - cam.horizon)));

            g.lineStyle(0.6 + depth * 1.4, p.accent2, (0.06 + 0.22 * clear) * (0.4 + depth * 0.6));
            g.lineBetween(s.x, s.y, s.x + s.len * depth * 0.18, s.y - s.len * depth);
        }

        const sg = this.shroudGfx;
        sg.clear();

        if (dark > 0.001)
        {
            sg.fillStyle(0x000410, 0.86 * dark);
            sg.fillRect(0, 0, W, H);
        }

        if (flash > 0.001)
        {
            //  The strike that ends the blackout, drawn as a fork down the sky.
            g.lineStyle(3 + flash * 4, 0xffffff, flash);
            let x = W * (0.2 + ((this.t / 8200) | 0) % 5 * 0.15);
            let y = 0;
            for (let i = 0; i < 6; i++)
            {
                const nx = x + (((i * 37) % 7) - 3) * 16;
                const ny = y + cam.horizon / 5;
                g.lineBetween(x, y, nx, ny);
                x = nx; y = ny;
            }

            g.fillStyle(0xffffff, flash * 0.25);
            g.fillRect(0, 0, W, H);
        }
    }

    //  ------------------------------------------------------------- cavern

    private buildCavern (g: GameObjects.Graphics): void
    {
        this.cam = { x: 0, height: 70, focal: 300, horizon: ay(0.36), z: 0 };

        //  Nothing down here holds still, so nothing down here is static.
        g.fillStyle(mix(this.zone.palette.bg, 0x000000, 0.4), 1);
        g.fillRect(0, 0, W, H);

        //  Crystal clusters, the only friendly light down here, at real depths.
        for (let i = 0; i < 10; i++)
        {
            this.specks.push({
                x: (Math.random() * 2 - 1) * 260 * SPREAD,
                y: Math.random() * 120,
                r: 10 + Math.random() * 16,
                s: 120 + Math.random() * 1200
            });
        }
    }

    private drawCavern (g: GameObjects.Graphics): void
    {
        const p = this.zone.palette;
        const cam = this.cam;

        cam.z = this.t * 0.024;

        const FAR = 1350;
        const STEP = 110;

        //  Molten floor, and the mouth burning at the end of it. Both go down
        //  first so every slice of rock drawn afterwards eats into the light.
        this.ground(g, mix(p.bg, p.accent, 0.05));

        for (let i = 14; i >= 1; i--)
        {
            g.fillStyle(p.accent, 0.008 * (15 - i));
            g.fillCircle(W / 2, cam.horizon - 10, 8 + i * 8);
        }

        floorGrid(g, cam, {
            half: 300 * SPREAD, step: 76, far: FAR,
            color: p.accent, alpha: 0.16, rails: 5, height: H
        });

        /**
         * The cross-section of the tunnel at a given depth: a flat floor with
         * an irregular arch over it. Two sine terms of different frequency are
         * enough to stop it being a pipe -- the throat pinches and opens as it
         * runs, which is what makes it read as rock rather than as plumbing.
         */
        const section = (z: number): { x: number; y: number }[] =>
        {
            const bore = (272 + Math.sin(z * 0.0051) * 62 + Math.sin(z * 0.0123) * 26) * SPREAD;
            const arch = 232 + Math.sin(z * 0.0071 + 1.4) * 58;
            const out: { x: number; y: number }[] = [];
            const n = 9;

            for (let i = 0; i <= n; i++)
            {
                const th = Math.PI - (i / n) * Math.PI;
                const bump = 1 + Math.sin(z * 0.009 + i * 2.1) * 0.11;

                out.push(project(cam, Math.cos(th) * bore * bump, Math.max(0, Math.sin(th)) * arch * bump, z));
            }

            return out;
        };

        const off = ((cam.z % STEP) + STEP) % STEP;

        for (let z = FAR; z > 40; z -= STEP)
        {
            const zz = z - off;

            if (zz < 40) continue;

            const zn = Math.max(30, zz - STEP);
            const fade = 1 - zz / FAR;
            const k = scaleAt(cam, zz);

            const a0 = section(zz);
            const a1 = section(zn);

            //  Rock, slice by slice. The far end keeps a little of the mouth's
            //  colour in it; the near end is very nearly black.
            const rock = mix(0x070402, mix(p.bg, p.accent, 0.24), Math.min(0.7, zz / FAR));

            for (let i = 0; i < a0.length - 1; i++)
            {
                const q: Quad = [ a0[i], a0[i + 1], a1[i + 1], a1[i] ];

                if (!quadVisible(q, W, H)) continue;

                //  One flank catches what light there is, the other does not.
                const lit = i < a0.length / 2 ? 0.0 : 0.06;

                fillQuad(g, q, mix(rock, p.accent, lit), 1);
            }

            g.lineStyle(Math.max(0.8, k * 0.012), p.accent, 0.03 + fade * 0.14);
            g.strokePoints(a0 as unknown as Phaser.Math.Vector2[], false);

            //  Teeth: one hanging, one standing, per slice.
            for (const down of [ true, false ])
            {
                const span = 250 * SPREAD;
                //  The hanging one and the standing one are never in the same
                //  place, or the pair of them meets in the middle and reads as
                //  an hourglass rather than as a cave.
                const wx = ((((zz + (down ? 0 : 211)) * 37) % 400) / 400 * 2 - 1) * span;
                const rootY = down ? 210 : 0;
                const tipY = down ? 210 - (54 + ((zz * 13) % 84)) : 48 + ((zz * 17) % 90);
                const w = 22 * SPREAD;

                const l = project(cam, wx - w, rootY, zz);
                const r = project(cam, wx + w, rootY, zz);
                const tip = project(cam, wx, tipY, zz);

                g.fillStyle(0x070402, 0.7 + fade * 0.3);
                g.fillTriangle(l.x, l.y, r.x, r.y, tip.x, tip.y);
            }
        }

        //  Crystals: small, sharp and pulsing, placed in the world.
        for (const c of this.specks)
        {
            const z = ((c.s - cam.z) % 1250 + 1250) % 1250;

            if (z < 70 || z > 1150) continue;

            const at = project(cam, c.x, c.y, z);
            const k = scaleAt(cam, z);
            const r = Math.max(1.2, Math.min(22, c.r * k * 0.26));
            const pulse = 0.3 + Math.abs(Math.sin(this.t * 0.0016 + c.x)) * 0.45;

            g.fillStyle(p.accent2, pulse * (1 - z / 1250));
            g.fillTriangle(at.x - r * 0.55, at.y + r, at.x + r * 0.55, at.y + r, at.x, at.y - r * 1.5);
            g.fillStyle(p.accent2, pulse * 0.12);
            g.fillCircle(at.x, at.y, r * 2.2);
        }

        //  Embers, drifting up out of the floor.
        for (let i = 0; i < 24; i++)
        {
            const life = (this.t * 0.00016 + i * 0.0453) % 1;
            const x = ((i * 613) % W) + Math.sin(this.t * 0.001 + i) * 16;
            const y = H - life * (H - cam.horizon + 40);

            g.fillStyle(p.dust, (1 - life) * 0.55);
            g.fillCircle(x, y, 1.6 + (1 - life) * 2.2);
        }
    }

    //  ------------------------------------------------------------ reactor

    private buildReactor (g: GameObjects.Graphics): void
    {
        const p = this.zone.palette;

        this.cam = { x: 0, height: 96, focal: 340, horizon: ay(0.46), z: 0 };

        //  The throat is a machine, so it gets a machined shell rather than a
        //  sky. The core itself is painted every frame, over the ground, so
        //  the corridor in front of it can be a silhouette.
        g.fillStyle(mix(p.bg, 0x000000, 0.4), 1);
        g.fillRect(0, 0, W, this.cam.horizon + 2);
    }

    private drawReactor (g: GameObjects.Graphics): void
    {
        const p = this.zone.palette;
        const cam = this.cam;

        //  The core's rotation is the zone's rule -- the field turns with it.
        this.spin = 0.22;

        cam.z = this.t * 0.03;

        this.ground(g, mix(p.bg, 0x000000, 0.3));

        //  The core, burning at the end of the throat. Drawn before the
        //  hardware so every ring and strut ahead of it reads as a silhouette
        //  cut out of the light rather than as a shape sitting next to it.
        const beat = 0.5 + Math.abs(Math.sin(this.t * 0.0018)) * 0.5;

        for (let i = 12; i >= 1; i--)
        {
            g.fillStyle(p.accent, 0.007 * (13 - i) + beat * 0.003 * (13 - i));
            g.fillCircle(W / 2, cam.horizon, 16 + i * 13);
        }

        floorGrid(g, cam, {
            half: 240 * SPREAD, step: 84, far: 1300,
            color: p.grid, alpha: 0.3, rails: 5, height: H
        });

        //  The corridor: containment rings marching down the throat, each
        //  turned a little further than the last, with the wall plating drawn
        //  as quads between neighbouring rings so the whole thing is a tube.
        const step = 150;
        const off = ((cam.z % step) + step) % step;
        const far = 1300;
        const R = 260 * SPREAD;
        const AXIS = 116;
        const SIDES = 12;

        const ringPts = (z: number): { x: number; y: number }[] =>
        {
            const spin = this.t * 0.001 * this.spin + z * 0.0042;
            const out: { x: number; y: number }[] = [];

            for (let i = 0; i < SIDES; i++)
            {
                const th = spin + (i * Math.PI * 2) / SIDES;
                out.push(project(cam, Math.cos(th) * R, AXIS + Math.sin(th) * R * 0.7, z));
            }

            return out;
        };

        for (let z = far; z > 40; z -= step)
        {
            const zz = z - off;

            if (zz < 40) continue;

            const zn = Math.max(30, zz - step);
            const k = scaleAt(cam, zz);
            const fade = 1 - zz / far;

            const a0 = ringPts(zz);
            const a1 = ringPts(zn);

            //  Plating between this ring and the next one along.
            for (let i = 0; i < SIDES; i++)
            {
                const j = (i + 1) % SIDES;
                const q: Quad = [ a0[i], a0[j], a1[j], a1[i] ];

                if (!quadVisible(q, W, H)) continue;

                //  Bottom of the tube catches the core light; the top does not.
                const lit = i > SIDES * 0.25 && i < SIDES * 0.75 ? 0.08 : 0.015;

                fillQuad(g, q, mix(mix(p.bg, 0x000000, 0.6), p.accent, lit * fade), 0.92);
            }

            g.lineStyle(Math.max(1, k * 0.05), p.grid, 0.3 + fade * 0.5);
            g.strokePoints(a0 as unknown as Phaser.Math.Vector2[], true);

            //  Coolant lamps set into every ring, turning with it.
            for (let i = 0; i < SIDES; i += 3)
            {
                g.fillStyle(p.accent2, 0.3 + fade * 0.6);
                g.fillCircle(a0[i].x, a0[i].y, Math.max(1, 12 * k * 0.28));
            }
        }

        //  Coolant running up the pipes in the tube wall, towards the eye.
        for (const side of [ -1, 1 ])
        {
            for (let i = 0; i < 6; i++)
            {
                const zz = far - (((this.t * 0.24 + i * 210 + (side > 0 ? 100 : 0)) % (far - 60)) + 60);

                if (zz < 50) continue;

                const at = project(cam, side * R * 0.96, AXIS, zz);
                const k = scaleAt(cam, zz);

                g.fillStyle(p.accent2, 0.75 * (1 - zz / far) + 0.15);
                g.fillCircle(at.x, at.y, Math.max(1.2, 15 * k * 0.28));
            }
        }

        //  The core face itself, and the spokes that make its spin legible
        //  before a single target has moved.
        const a = this.t * 0.001 * this.spin;

        for (let i = 0; i < 6; i++)
        {
            const th = a + (i * Math.PI) / 3;

            g.lineStyle(2.5, p.accent, 0.2);
            g.lineBetween(
                W / 2 + Math.cos(th) * 30, cam.horizon + Math.sin(th) * 21,
                W / 2 + Math.cos(th) * 86, cam.horizon + Math.sin(th) * 60
            );
        }

        g.fillStyle(mix(p.bg, p.accent, 0.42), 0.4 + beat * 0.25);
        g.fillCircle(W / 2, cam.horizon, 24 + beat * 5);
        g.lineStyle(3, p.accent2, 0.28 + beat * 0.35);
        g.strokeCircle(W / 2, cam.horizon, 28 + beat * 7);
    }

    //  --------------------------------------------------------- orbitfield

    private buildOrbitfield (g: GameObjects.Graphics): void
    {
        const p = this.zone.palette;

        this.cam = { x: 0, height: 0, focal: 320, horizon: ay(0.44), z: 0 };

        for (let i = 0; i < 150; i++)
        {
            this.specks.push({
                x: Math.random() * W,
                y: Math.random() * H,
                r: Math.random() * 1.5 + 0.4,
                s: 0.3 + Math.random() * 1.6
            });
        }

        //  Nebula, a few soft overlapping washes.
        for (let i = 0; i < 6; i++)
        {
            g.fillStyle(i % 2 ? p.accent : p.accent2, 0.05);
            g.fillEllipse(Math.random() * W, ay(Math.random()), 260 + Math.random() * 300, 180 + Math.random() * 200);
        }

        //  The planet's limb, cutting off the bottom of the world.
        g.fillStyle(mix(p.bg, p.accent, 0.18), 1);
        g.fillCircle(W / 2, H + W * 0.9, W);
        g.lineStyle(4, p.accent2, 0.5);
        g.strokeCircle(W / 2, H + W * 0.9, W);

        //  Truss segments of the station the arena is strung along.
        for (let z = 120; z < 2000; z += 155) this.blocks.push({
            x0: 0, x1: 0, z, deep: 0, h: 0, seed: Math.random(), neon: 0
        });
    }

    private drawOrbitfield (g: GameObjects.Graphics): void
    {
        const p = this.zone.palette;
        const cam = this.cam;

        cam.z = this.t * 0.032;

        for (const s of this.specks)
        {
            g.fillStyle(0xffffff, 0.25 + Math.abs(Math.sin(this.t * 0.001 * s.s)) * 0.55);
            g.fillCircle(s.x, s.y, s.r);
        }

        //  A station truss running away into the dark: square frames at fixed
        //  depths with braces between them. In a world with no ground it is
        //  the only thing that can say how far away anything is, so it says it
        //  loudly.
        this.order.length = 0;

        for (const b of this.blocks)
        {
            const z = ((b.z - cam.z) % 2000 + 2000) % 2000;
            if (z < 70) continue;
            this.order.push({ b, z });
        }

        this.order.sort((a, c) => c.z - a.z);

        let prev: { x: number; y: number }[] | null = null;

        for (let i = this.order.length - 1; i >= 0; i--)
        {
            const z = this.order[i].z;
            const k = scaleAt(cam, z);
            const fade = Math.max(0, 1 - z / 1800);
            const r = 250 * SPREAD;

            //  Hexagonal frames rather than squares: a six-sided ring reads
            //  as a structure you are inside, and a square reads as a picture
            //  frame hanging in front of you.
            const c: { x: number; y: number }[] = [];

            //  Vertices at 0/60/120..., never at 0 across: a strut sitting on
            //  the world's centre line projects to a stripe straight down the
            //  middle of the screen at every depth at once.
            for (let s = 0; s < 6; s++)
            {
                const th = (s * Math.PI * 2) / 6;
                c.push(project(cam, Math.cos(th) * r, Math.sin(th) * r * 0.72, z));
            }

            g.lineStyle(Math.max(1, k * 0.05), mix(p.grid, p.accent, 0.35), 0.14 + fade * 0.34);
            g.strokePoints(c as unknown as Phaser.Math.Vector2[], true);

            if (prev)
            {
                g.lineStyle(Math.max(0.6, k * 0.03), p.grid, 0.08 + fade * 0.22);
                for (let s = 0; s < 6; s++) g.lineBetween(c[s].x, c[s].y, prev[s].x, prev[s].y);

                //  Running lights on the truss, one per segment, so the
                //  distance between two frames is countable.
                const lamp = (i + ((this.t * 0.002) | 0)) % 6;
                g.fillStyle(p.accent2, 0.2 + fade * 0.55);
                g.fillCircle(c[lamp].x, c[lamp].y, Math.max(1, 9 * k * 0.26));
            }

            prev = c;
        }

        //  Orbital tracks, tilted and turning -- the shape of the shields the
        //  targets are about to start wearing.
        const cy = ay(0.46);

        for (let i = 0; i < 3; i++)
        {
            const rot = this.t * 0.00018 * (i + 1);

            g.lineStyle(2, i % 2 ? p.accent : p.accent2, 0.13);
            g.save();
            g.translateCanvas(W / 2, cy);
            g.rotateCanvas(rot);
            g.strokeEllipse(0, 0, 340 + i * 130, 150 + i * 48);
            g.restore();

            //  A satellite riding that track, placed on the ellipse and then
            //  turned with it so it never drifts off the line it belongs to.
            const a = rot * 7 + i;
            const ex = Math.cos(a) * (170 + i * 65);
            const ey = Math.sin(a) * (75 + i * 24);

            g.fillStyle(0xffffff, 0.8);
            g.fillCircle(
                W / 2 + ex * Math.cos(rot) - ey * Math.sin(rot),
                cy + ex * Math.sin(rot) + ey * Math.cos(rot),
                2.5
            );
        }
    }

    //  ------------------------------------------------------------ crimson

    private buildCrimson (g: GameObjects.Graphics): void
    {
        const p = this.zone.palette;

        this.cam = { x: 0, height: 88, focal: 320, horizon: ay(0.34), z: 0 };

        this.sky(g, mix(p.bg, 0x000000, 0.3), mix(p.bg, p.accent, 0.5), 16);

        //  A dying sun, most of the way below the horizon, sitting exactly on
        //  the point the causeway runs to.
        for (let i = 9; i >= 1; i--)
        {
            g.fillStyle(mix(p.bg, p.accent2, 0.07 * (10 - i)), 1);
            g.fillCircle(W / 2, this.cam.horizon + 20, 34 + i * 24);
        }

        //  Spires, standing in ranks down both sides of the last road.
        const half = 190 * SPREAD;

        for (let z = 60; z < 2200; z += 90 + Math.random() * 110)
        {
            for (const side of [ -1, 1 ])
            {
                const w = (34 + Math.random() * 74) * SPREAD;
                const gap = Math.random() * 130 * SPREAD;
                const x0 = side < 0 ? -(half + gap + w) : half + gap;

                this.blocks.push({
                    x0, x1: x0 + w, z, deep: 60,
                    h: 200 + Math.random() * 560,
                    seed: Math.random(), neon: Math.random()
                });
            }
        }

        for (let i = 0; i < 80; i++)
        {
            this.specks.push({
                x: Math.random() * W,
                y: Math.random() * H,
                r: 0.8 + Math.random() * 1.8,
                s: 0.3 + Math.random() * 0.9
            });
        }
    }

    private drawCrimson (g: GameObjects.Graphics, dtMs: number): void
    {
        const p = this.zone.palette;
        const cam = this.cam;
        const beat = Math.abs(Math.sin(this.t * 0.0012));

        cam.z = this.t * 0.028;

        g.fillStyle(p.accent2, 0.05 + beat * 0.06);
        g.fillCircle(W / 2, cam.horizon + 20, 110 + beat * 34);

        this.ground(g, mix(p.bg, 0x000000, 0.5));

        floorGrid(g, cam, {
            half: 185 * SPREAD, step: 96, far: 1600,
            color: p.accent, alpha: 0.22, rails: 4, height: H
        });

        this.horizon(g, p.accent, 0.4);

        //  Spires, black against the burn, sorted so the near ones cut the far.
        this.order.length = 0;

        for (const b of this.blocks)
        {
            const z = ((b.z - cam.z) % 2200 + 2200) % 2200;
            if (z < 40 || z > 1700) continue;
            this.order.push({ b, z });
        }

        this.order.sort((a, c) => c.z - a.z);

        for (const item of this.order)
        {
            const b = item.b;
            const z = item.z;
            const fog = Math.min(0.8, z / 1700);
            const body = mix(0x090003, mix(p.bg, p.accent, 0.35), fog);

            //  A spire is a box that comes to a point, so it is drawn as the
            //  two faces of a box with the top edges pulled together.
            const w = b.x1 - b.x0;
            const mid = (b.x0 + b.x1) / 2;

            const baseL = project(cam, b.x0, 0, z);
            const baseR = project(cam, b.x1, 0, z);
            const tip = project(cam, mid + Math.sin(b.seed * 9) * w * 0.3, b.h, z);
            const backL = project(cam, b.x0, 0, z + b.deep);
            const backR = project(cam, b.x1, 0, z + b.deep);
            const backTip = project(cam, mid, b.h * 0.82, z + b.deep);

            if (baseL.x > W + 80 && backL.x > W + 80) continue;
            if (baseR.x < -80 && backR.x < -80) continue;

            //  The flank first, then the face over the top of it.
            g.fillStyle(mix(body, 0x000000, 0.45), 0.95);
            if (mid > cam.x) g.fillTriangle(baseL.x, baseL.y, backL.x, backL.y, backTip.x, backTip.y);
            else g.fillTriangle(baseR.x, baseR.y, backR.x, backR.y, backTip.x, backTip.y);

            g.fillStyle(body, 1);
            g.fillTriangle(baseL.x, baseL.y, baseR.x, baseR.y, tip.x, tip.y);

            //  A coal still burning somewhere up the shaft.
            if (b.neon > 0.6)
            {
                const k = scaleAt(cam, z);
                const glow = project(cam, mid, b.h * (0.3 + b.seed * 0.4), z);

                g.fillStyle(p.accent, 0.5 * (1 - fog) * (0.5 + beat * 0.5));
                g.fillCircle(glow.x, glow.y, Math.max(1, 14 * k * 0.28));
            }
        }

        //  Ash on the updraft.
        for (const s of this.specks)
        {
            s.y -= s.s * 14 * (dtMs / 1000);
            s.x += Math.sin(this.t * 0.0008 + s.r * 9) * 0.4;

            if (s.y < -10) { s.y = H + 10; s.x = Math.random() * W; }

            g.fillStyle(p.dust, 0.2 + s.s * 0.3);
            g.fillCircle(s.x, s.y, s.r);
        }
    }
}
