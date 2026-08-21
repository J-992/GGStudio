/**
 * Headless look at the gun.
 *
 * `core/gunart` plans the whole weapon as pure data, which means the only
 * thing standing between a parts list and a picture of the gun it makes is a
 * renderer. This is that renderer, in SVG, so a change to the gun can be
 * looked at without running the game, and every build from stock to endgame
 * can be looked at side by side -- which is the only way to tell whether a new
 * attachment reads as part of the machine or as a sticker on it.
 *
 *   bun run scripts/gun-preview.ts [outDir]
 */

import type { GunPlan, Op, Part } from '../src/game/core/gunart';

const OUT = process.argv[2] || 'art-src/gun';

/**
 * `core/theme` picks its design box from the host window once, at import, and
 * everything downstream is measured off that -- so the only way to look at the
 * landscape layout is to be a landscape host before the first import lands.
 */
const MODE = process.argv[3] === 'landscape' ? 'landscape' : 'portrait';

if (MODE === 'landscape')
{
    (globalThis as any).window = {
        innerWidth: 1280,
        innerHeight: 720,
        matchMedia: () => ({ matches: false })
    };
    (globalThis as any).document = { getElementById: () => null };
}

const { planGun } = await import('../src/game/core/gunart');
const { gunLook } = await import('../src/game/data/gunkit');
const { AIM_LIMIT, GUN_SCALE, H, HUD, MUZZLE, PLAY, W } = await import('../src/game/core/theme');

const CELL_W = 620;
const CELL_H = 480;
const COLS = 4;

const hex = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;

function ops (list: Op[], pal: GunPlan['pal']): string
{
    const out: string[] = [];

    for (const op of list)
    {
        switch (op.k)
        {
            case 'plate':
                out.push(`<rect x="${op.x}" y="${op.y}" width="${op.w}" height="${op.h}" rx="${op.r}" fill="${hex(op.lit ? pal.hullLit : pal.hull)}" stroke="${hex(pal.edge)}" stroke-opacity="0.85" stroke-width="2.5"/>`);
                break;

            case 'poly':
            {
                const pts = [];
                for (let i = 0; i < op.pts.length; i += 2) pts.push(`${op.pts[i]},${op.pts[i + 1]}`);
                out.push(`<polygon points="${pts.join(' ')}" fill="${hex(op.lit ? pal.hullLit : pal.hull)}" stroke="${hex(pal.edge)}" stroke-opacity="0.85" stroke-width="2.5" stroke-linejoin="round"/>`);
                break;
            }

            case 'slot':
            {
                const a = op.a ?? 0.95;
                out.push(`<rect x="${op.x - 2}" y="${op.y - 2}" width="${op.w + 4}" height="${op.h + 4}" rx="${(Math.min(op.w, op.h) + 4) / 2}" fill="${hex(op.c)}" fill-opacity="${a * 0.3}"/>`);
                out.push(`<rect x="${op.x}" y="${op.y}" width="${op.w}" height="${op.h}" rx="${Math.min(op.w, op.h) / 2}" fill="${hex(op.c)}" fill-opacity="${a}"/>`);
                break;
            }

            case 'bar':
                out.push(`<rect x="${op.x}" y="${op.y}" width="${op.w}" height="${op.h}" rx="${op.r}" fill="${hex(op.c)}" fill-opacity="${op.a}"/>`);
                break;

            case 'stroke':
            {
                const pts = [];
                for (let i = 0; i < op.pts.length; i += 2) pts.push(`${op.pts[i]},${op.pts[i + 1]}`);
                out.push(`<polyline points="${pts.join(' ')}" fill="none" stroke="${hex(op.c)}" stroke-opacity="${op.a}" stroke-width="${op.w}" stroke-linecap="round" stroke-linejoin="round"/>`);
                break;
            }

            case 'dot':
                out.push(`<circle cx="${op.x}" cy="${op.y}" r="${op.r}" fill="${hex(op.c)}" fill-opacity="${op.a}"/>`);
                break;
        }
    }

    return out.join('');
}

/** The same grouping and layering `objects/Turret` does when it assembles. */
function assemble (parts: Part[], plan: GunPlan, top: string[] = []): string
{
    const groups = new Map<string, string[]>();
    const order: string[] = [];

    for (const part of parts)
    {
        if (!groups.has(part.name))
        {
            groups.set(part.name, []);
            order.push(part.name);
        }

        groups.get(part.name)!.push(`<g transform="translate(${part.x},${part.y})">${ops(part.ops, plan.pal)}</g>`);

        if (part.back)
        {
            order.splice(order.indexOf(part.name), 1);
            order.unshift(part.name);
        }
    }

    for (const name of top)
    {
        if (!groups.has(name)) continue;
        order.splice(order.indexOf(name), 1);
        order.push(name);
    }

    return order.map(n => groups.get(n)!.join('')).join('');
}

/** The four attachments the running game redraws every frame, frozen. */
function live (plan: GunPlan): string
{
    const out: string[] = [];

    for (const b of plan.barrels)
    {
        out.push(`<rect x="${b.x - b.wHalf * 0.45}" y="${-b.muzzle + 3}" width="${b.wHalf * 0.9}" height="4" fill="${hex(plan.pal.edge)}" fill-opacity="0.9"/>`);
    }

    for (let i = 0; i < plan.cells.length; i++)
    {
        const c = plan.cells[i];
        out.push(`<rect x="${c.x - 3.5}" y="${c.y - 6}" width="7" height="12" rx="3.5" fill="${hex(plan.pal.cell)}" fill-opacity="0.22"/>`);
        out.push(`<rect x="${c.x - 2}" y="${c.y - 4.5}" width="4" height="9" rx="2" fill="${hex(plan.pal.cell)}" fill-opacity="0.8"/>`);
    }

    if (plan.chrono)
    {
        const { rx, ry, y } = plan.chrono;
        out.push(`<ellipse cx="0" cy="${y}" rx="${rx}" ry="${ry}" fill="none" stroke="${hex(plan.pal.edge)}" stroke-opacity="0.5" stroke-width="3"/>`);

        for (let i = 0; i < 8; i++)
        {
            const a = (i / 8) * Math.PI * 2;
            const depth = (Math.sin(a) + 1) / 2;
            out.push(`<circle cx="${Math.cos(a) * rx}" cy="${y + Math.sin(a) * ry}" r="${1.4 + depth * 1.9}" fill="${hex(plan.pal.tech)}" fill-opacity="${0.25 + depth * 0.65}"/>`);
        }
    }

    if (plan.coils)
    {
        const { reach, y } = plan.coils;
        const pts = [];

        for (let i = 0; i <= 6; i++)
        {
            const t = i / 6;
            const jitter = i === 0 || i === 6 ? 0 : Math.sin(i * 2.1) * 6;
            pts.push(`${-reach + t * reach * 2},${y + jitter}`);
        }

        out.push(`<polyline points="${pts.join(' ')}" fill="none" stroke="${hex(plan.pal.heat)}" stroke-opacity="0.7" stroke-width="2.5"/>`);
    }

    return out.join('');
}

function cell (title: string, taken: Record<string, number>, accent: number, accent2: number, aim: number): string
{
    const look = gunLook(taken);
    const plan = planGun(look, accent, accent2);
    const scale = (1.6 + look.bulk * 0.15) * 0.82;

    //  Same nesting the turret uses: static frame on the origin, everything
    //  else inside a rig that turns about the pivot.
    const body = `
        <circle cx="0" cy="6" r="${plan.glowR}" fill="${hex(plan.pal.edge)}" fill-opacity="${plan.glowA * 2}"/>
        ${assemble(plan.frame, plan)}
        <g transform="translate(0,-10) rotate(${(aim * 180) / Math.PI})">
            ${assemble(plan.bank, plan, plan.top)}
            ${live(plan)}
        </g>`;

    return `
    <g>
        <rect width="${CELL_W}" height="${CELL_H}" fill="#070b18"/>
        <rect width="${CELL_W}" height="${CELL_H}" fill="none" stroke="#1a2340"/>
        <text x="14" y="26" fill="#7d88b0" font-family="monospace" font-size="18">${title}</text>
        <g transform="translate(${CELL_W / 2},${CELL_H - 96}) scale(${scale})">${body}</g>
    </g>`;
}

const BUILDS: { title: string; taken: Record<string, number>; aim?: number }[] = [
    { title: 'stock', taken: {} },
    { title: 'power x4', taken: { power: 4 } },
    { title: 'rapid x5', taken: { rapid: 5 } },
    { title: 'multi x3 + power x3', taken: { multi: 3, power: 3 } },
    { title: 'boom x4 + blast x3', taken: { boom: 4, blast: 3 } },
    { title: 'crit x5 + perfect', taken: { crit: 5, critdmg: 2, perfect: 1 } },
    { title: 'chain x4 + pierce x3', taken: { chain: 4, pierce: 3 } },
    { title: 'utility (slow/magnet/steady/lucky)', taken: { slow: 3, time: 2, magnet: 3, steady: 2, lucky: 2 } },
    { title: 'economy (greed/xp/combo)', taken: { greed: 5, payout: 3, xp: 4, combo: 4, window: 2 } },
    {
        title: 'endgame',
        taken: {
            power: 5, rapid: 4, crit: 3, multi: 3, pierce: 2, boom: 3, blast: 2,
            chain: 3, greed: 3, xp: 2, combo: 3, magnet: 2, slow: 2, lucky: 1,
            perfect: 1, steady: 2
        }
    },
    { title: 'endgame, aimed', taken: { power: 5, rapid: 4, crit: 3, multi: 3, pierce: 2, boom: 3, blast: 2, chain: 3, greed: 3, xp: 2, combo: 3, magnet: 2, slow: 2, lucky: 1, perfect: 1, steady: 2 }, aim: -0.6 },
    { title: 'six barrels', taken: { multi: 5, power: 6, rapid: 3 } }
];

const rows = Math.ceil(BUILDS.length / COLS);
const cells = BUILDS.map((b, i) =>
{
    const x = (i % COLS) * CELL_W;
    const y = Math.floor(i / COLS) * CELL_H;

    return `<g transform="translate(${x},${y})">${cell(b.title, b.taken, 0x4fd6ff, 0xff5ec7, b.aim || 0)}</g>`;
}).join('');

//  Square, and padded to it: the macOS thumbnailer this is usually viewed
//  through crops to a square rather than fitting one.
const side = Math.max(COLS * CELL_W, rows * CELL_H);
const pad = `translate(${(side - COLS * CELL_W) / 2},${(side - rows * CELL_H) / 2})`;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${side}" height="${side}" viewBox="0 0 ${side} ${side}"><rect width="100%" height="100%" fill="#04060f"/><g transform="${pad}">${cells}</g></svg>`;

await Bun.write(`${OUT}/gun-sheet.svg`, svg);
console.log(`${OUT}/gun-sheet.svg`);


//  ------------------------------------------------------------ in place

/**
 * The same gun where it actually lives, with the HUD furniture around it.
 *
 * The sheet above says whether the weapon holds together as an object; this
 * says whether it fits on the screen -- the gun swings almost flat, so the one
 * thing worth checking every time it changes shape is what the barrels sweep
 * over on their way to the corners.
 */
function inPlace (title: string, taken: Record<string, number>, aim: number): string
{
    const look = gunLook(taken);
    const plan = planGun(look, 0x4fd6ff, 0xff5ec7);
    const scale = (1.6 + look.bulk * 0.15) * GUN_SCALE;

    const chips = Object.keys(taken).length || 1;
    const foot = PLAY.bottom - 26;
    const step = Math.min(30, (foot - (PLAY.top + 8)) / Math.max(1, chips));

    const rail = Array.from({ length: chips }, (_, i) =>
        `<rect x="${HUD.margin - 8 - 11}" y="${foot - i * step - 11}" width="22" height="22" rx="6" fill="#4fd6ff" fill-opacity="0.8"/>`).join('');

    return `
    <g>
        <rect width="${W}" height="${H}" fill="#070b18"/>
        <rect x="${PLAY.left}" y="${PLAY.top}" width="${PLAY.right - PLAY.left}" height="${PLAY.bottom - PLAY.top}" fill="none" stroke="#22305c" stroke-dasharray="6 6"/>
        <text x="14" y="26" fill="#7d88b0" font-family="monospace" font-size="18">${title}</text>

        <rect x="${HUD.margin - 8 - 15}" y="${foot - (chips - 1) * step - 21}" width="30" height="${(chips - 1) * step + 42}" rx="15" fill="#070b1a" fill-opacity="0.62" stroke="#2a3352"/>
        ${rail}
        <rect x="${HUD.margin - 4}" y="${HUD.footerY - 20}" width="128" height="40" rx="13" fill="#0b1024" fill-opacity="0.85" stroke="#ffb347" stroke-opacity="0.7"/>
        <circle cx="${W - HUD.margin + 4}" cy="${HUD.footerY}" r="11" fill="#ffffff" fill-opacity="0.45"/>

        <g transform="translate(${MUZZLE.x},${MUZZLE.y}) scale(${scale})">
            <circle cx="0" cy="6" r="${plan.glowR}" fill="${hex(plan.pal.edge)}" fill-opacity="${plan.glowA * 2}"/>
            ${assemble(plan.frame, plan)}
            <g transform="translate(0,-10) rotate(${(aim * 180) / Math.PI})">
                ${assemble(plan.bank, plan, plan.top)}
                ${live(plan)}
            </g>
        </g>
    </g>`;
}

const ENDGAME = BUILDS.find(b => b.title === 'endgame')!.taken;

const shots = [
    inPlace('stock, level', {}, 0),
    inPlace('endgame, level', ENDGAME, 0),
    inPlace('endgame, hard left', ENDGAME, -AIM_LIMIT),
    inPlace('endgame, hard right', ENDGAME, AIM_LIMIT)
];

const hudW = W * shots.length + 20 * (shots.length - 1);
const hudSide = Math.max(hudW, H);

const hud = `<svg xmlns="http://www.w3.org/2000/svg" width="${hudSide}" height="${hudSide}" viewBox="0 0 ${hudSide} ${hudSide}"><rect width="100%" height="100%" fill="#04060f"/><g transform="translate(${(hudSide - hudW) / 2},${(hudSide - H) / 2})">${shots.map((sh, i) => `<g transform="translate(${i * (W + 20)},0)">${sh}</g>`).join('')}</g></svg>`;

await Bun.write(`${OUT}/hud-${MODE}.svg`, hud);
console.log(`${OUT}/hud-${MODE}.svg`);
