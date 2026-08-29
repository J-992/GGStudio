import { mix } from '../core/theme';
import type { BodyShape } from '../core/shapes';
import type { TrailId } from '../core/trails';

/**
 * A target's paint. Zones repaint their own rank and file so the board always
 * belongs to the place it is standing in; a bought skin then paints over the
 * zone, so the player's money is visible in every world they walk into.
 */
export interface Skin
{
    color: number;
    ring: number;
}

/** Which shelf of the wardrobe a skin sits on. */
export type SkinGroup = 'photo' | 'core' | 'crew' | 'flags';

/** Everything a skin changes about how a target is drawn. */
export interface TargetStyle
{
    shape: BodyShape;
    /** Radians per second the body turns. Zero for a shape that sits still. */
    spin: number;
    /** Multiplier on the halo behind the body. */
    glow: number;
    /** Decal painted over the body (see core/skinart and core/photoskins). */
    art?: string;
    /** Particle wake (see core/trails). */
    trail?: TrailId;
}

export interface TargetSkin
{
    id: string;
    name: string;
    /** One line, in the player's words, about what they are looking at. */
    blurb: string;
    cost: number;
    group: SkinGroup;
    /** The colour the store card is lit in. */
    accent: number;
    shape: BodyShape;
    spin: number;
    glow: number;
    /**
     * Decal name. Drawn faces and flags live in core/skinart; the ones cut
     * from image files are listed in core/photoskins. Nothing downstream cares
     * which of the two a given name came from.
     */
    art?: string;
    trail?: TrailId;
    /**
     * Repaints the rank and file, given whatever the zone had already picked.
     * Left out on a skin that is happy with the zone's own colours -- the
     * shape, the face or the wake is the purchase.
     */
    tint?: (base: Skin) => Skin;
}

/**
 * The photographs, and the two painted textures that came in with them.
 *
 * These lead the wardrobe because they are the loudest thing in it: a face
 * that is unmistakably a photograph sells the whole shelf, and a player who
 * opens SKINS should see the reason to keep scrolling in the first row.
 */
const PHOTOS: TargetSkin[] = [
    {
        id: 'slurp', name: 'SLURP', group: 'photo',
        blurb: 'CAUGHT MID-LICK.',
        cost: 1500, accent: 0xe8b98a,
        shape: 'circle', spin: 0, glow: 1.1, art: 'nyan'
    },
    {
        id: 'capybara', name: 'CAPYBARA', group: 'photo',
        blurb: 'UNBOTHERED. MOISTURISED.',
        cost: 1600, accent: 0x8a7a4a,
        shape: 'circle', spin: 0, glow: 1.1, art: 'capybara', trail: 'bubbles'
    },
    {
        id: 'doge', name: 'DOGE', group: 'photo',
        blurb: 'MUCH TARGET. VERY SHINE.',
        cost: 2000, accent: 0xd9a441,
        shape: 'circle', spin: 0, glow: 1.35, art: 'doge', trail: 'sparkle'
    },
    {
        id: 'timber', name: 'TIMBER', group: 'photo',
        blurb: 'WOODEN AND WATCHING.',
        cost: 2400, accent: 0xb5722a,
        shape: 'circle', spin: 0, glow: 1.2, art: 'sticky', trail: 'embers'
    },
    {
        id: 'mossman', name: 'MOSSMAN', group: 'photo',
        blurb: 'GROWN, NOT BUILT.',
        cost: 2600, accent: 0x6f9a3a,
        shape: 'circle', spin: 0, glow: 1.15, art: 'treeman', trail: 'toxic'
    },
    {
        id: 'mouser', name: 'MOUSER', group: 'photo',
        blurb: 'HAT. SWORD. ENORMOUS EYES.',
        cost: 2800, accent: 0xc98a4a,
        shape: 'circle', spin: 0, glow: 1.1, art: 'boots'
    },
    {
        id: 'greatwhite', name: 'GREAT WHITE', group: 'photo',
        blurb: 'STRAIGHT OFF THE BREAK.',
        cost: 3000, accent: 0x6f93b5,
        shape: 'circle', spin: 0, glow: 1.15, art: 'sharky', trail: 'bubbles'
    },
    {
        id: 'barista', name: 'BARISTA', group: 'photo',
        blurb: 'SERVED HOT. STILL STEAMING.',
        cost: 3200, accent: 0xd8a25e,
        shape: 'circle', spin: 0, glow: 1.25, art: 'latte', trail: 'steam'
    },
    {
        id: 'liquid', name: 'RIPTIDE', group: 'photo',
        blurb: 'POURED, NOT PAINTED.',
        cost: 2400, accent: 0x00b3ff,
        shape: 'circle', spin: 0, glow: 1.4, art: 'liquid', trail: 'bubbles'
    },
    {
        id: 'johnPork', name: 'JOHN PORK', group: 'photo',
        blurb: 'HE IS CALLING. PICK UP.',
        cost: 3400, accent: 0xf2a3ae,
        shape: 'circle', spin: 0, glow: 1.2, art: 'johnPork', trail: 'sparkle'
    },
    {
        id: 'ember', name: 'FIRECLOUD', group: 'photo',
        blurb: 'ROLLING FLAME. TRAILS EMBERS.',
        cost: 3800, accent: 0xff4d1a,
        shape: 'circle', spin: 0.25, glow: 1.5, art: 'ember', trail: 'embers'
    }
];

/** Shape, colour and light. The standard issue leads, so it is easy to get back to. */
const CORE: TargetSkin[] = [
    {
        id: 'classic', name: 'STANDARD', group: 'core',
        blurb: 'THE RANGE ISSUE. ZONE COLOURS.',
        cost: 0, accent: 0x3fe0ff,
        shape: 'circle', spin: 0, glow: 1
    },
    {
        id: 'neon', name: 'NEON', group: 'core',
        blurb: 'HOT PINK, TWICE THE GLOW.',
        cost: 900, accent: 0xff2fd6,
        shape: 'circle', spin: 0, glow: 2.1,
        tint: b => ({ color: mix(b.color, 0xff2fd6, 0.72), ring: 0xffd6f4 })
    },
    {
        id: 'hexcore', name: 'HEXCORE', group: 'core',
        blurb: 'MACHINED HEXES, SLOWLY TURNING.',
        cost: 1900, accent: 0x6cf5c8,
        shape: 'hex', spin: 0.5, glow: 1.1
    },
    {
        id: 'midas', name: 'MIDAS', group: 'core',
        blurb: 'STRUCK IN GOLD. TRAILS SPARKS.',
        cost: 3400, accent: 0xffc857,
        shape: 'diamond', spin: 0.9, glow: 1.5, trail: 'sparkle',
        tint: b => ({ color: mix(b.color, 0xffc857, 0.86), ring: 0xfff3b0 })
    },
    {
        id: 'toxic', name: 'BIOHAZARD', group: 'core',
        blurb: 'SPINNING STARS, LEAKING GAS.',
        cost: 4800, accent: 0x7dff6b,
        shape: 'star', spin: 1.5, glow: 1.35, trail: 'toxic',
        tint: b => ({ color: mix(b.color, 0x7dff6b, 0.8), ring: 0xe6ffd6 })
    },
    {
        id: 'void', name: 'VOID', group: 'core',
        blurb: 'BLACK PLATES POURING SMOKE.',
        cost: 7500, accent: 0xb388ff,
        shape: 'chip', spin: 0.35, glow: 1.8, trail: 'smoke',
        tint: b => ({ color: mix(b.color, 0x07040f, 0.82), ring: 0xffffff })
    }
];

/** Drawn faces -- animals and characters, vector art baked at boot. */
const CREW: TargetSkin[] = [
    {
        id: 'frog', name: 'FROG', group: 'crew',
        blurb: 'RIBBIT. BLOWS BUBBLES.',
        cost: 1200, accent: 0x5fbf3f,
        shape: 'circle', spin: 0, glow: 1.1, art: 'frog', trail: 'bubbles'
    },
    {
        id: 'cat', name: 'CAT', group: 'crew',
        blurb: 'ENTIRELY UNIMPRESSED.',
        cost: 1400, accent: 0x9aa3b2,
        shape: 'circle', spin: 0, glow: 1, art: 'cat'
    },
    {
        id: 'panda', name: 'PANDA', group: 'crew',
        blurb: 'CALM UNDER FIRE.',
        cost: 1800, accent: 0xf7f4ef,
        shape: 'circle', spin: 0, glow: 1.15, art: 'panda'
    },
    {
        id: 'fox', name: 'FOX', group: 'crew',
        blurb: 'QUICK AND ORANGE.',
        cost: 2200, accent: 0xef7c30,
        shape: 'circle', spin: 0, glow: 1.1, art: 'fox'
    },
    {
        id: 'ninja', name: 'NINJA', group: 'crew',
        blurb: 'VANISHES IN A PUFF OF SMOKE.',
        cost: 2600, accent: 0x232a3d,
        shape: 'circle', spin: 0, glow: 1.3, art: 'ninja', trail: 'smoke'
    },
    {
        id: 'tiger', name: 'TIGER', group: 'crew',
        blurb: 'BURNING BRIGHT. TRAILS EMBERS.',
        cost: 2900, accent: 0xf59027,
        shape: 'circle', spin: 0, glow: 1.2, art: 'tiger', trail: 'embers'
    },
    {
        id: 'robot', name: 'ROBOT', group: 'crew',
        blurb: 'THROWS SPARKS WHEN IT MOVES.',
        cost: 3200, accent: 0x8e9bb0,
        shape: 'circle', spin: 0, glow: 1.15, art: 'robot', trail: 'sparks'
    },
    {
        id: 'shark', name: 'SHARK', group: 'crew',
        blurb: 'ALL TEETH, ALL BUBBLES.',
        cost: 3600, accent: 0x5f7d99,
        shape: 'circle', spin: 0, glow: 1.1, art: 'shark', trail: 'bubbles'
    },
    {
        id: 'alien', name: 'ALIEN', group: 'crew',
        blurb: 'NOT FROM THE RANGE. LEAVES STARS.',
        cost: 4200, accent: 0x6fdc8c,
        shape: 'circle', spin: 0, glow: 1.45, art: 'alien', trail: 'stars'
    },
    {
        id: 'clown', name: 'CLOWN', group: 'crew',
        blurb: 'LAUGHING AT YOUR AIM.',
        cost: 4400, accent: 0xff4d5e,
        shape: 'circle', spin: 0, glow: 1.2, art: 'clown'
    },
    {
        id: 'skull', name: 'SKULL', group: 'crew',
        blurb: 'GRINNING THROUGH THE SMOKE.',
        cost: 5200, accent: 0xece7dc,
        shape: 'circle', spin: 0, glow: 1.35, art: 'skull', trail: 'smoke'
    }
];

/** A flag costs the same as any other flag: the set is meant to be collected. */
const FLAG_COST = 650;

function flag (id: string, name: string, accent: number): TargetSkin
{
    return {
        id, name, group: 'flags', accent,
        blurb: 'FLY THE COLOURS.',
        cost: FLAG_COST,
        shape: 'circle', spin: 0, glow: 1.1,
        art: id
    };
}

const FLAGS: TargetSkin[] = [
    flag('usa',        'USA',         0xb22234),
    flag('uk',         'UK',          0x012169),
    flag('france',     'FRANCE',      0x002395),
    flag('germany',    'GERMANY',     0xdd0000),
    flag('italy',      'ITALY',       0x008c45),
    flag('spain',      'SPAIN',       0xaa151b),
    flag('brazil',     'BRAZIL',      0x009c3b),
    flag('argentina',  'ARGENTINA',   0x75aadb),
    flag('mexico',     'MEXICO',      0x006847),
    flag('canada',     'CANADA',      0xd80621),
    flag('japan',      'JAPAN',       0xbc002d),
    flag('southKorea', 'SOUTH KOREA', 0x0047a0),
    flag('india',      'INDIA',       0xff9933),
    flag('nigeria',    'NIGERIA',     0x008751)
];

/**
 * The wardrobe, in the order the store deals it.
 *
 * Only the rank and file ever wear a face. A bomb has to read as a bomb and a
 * coin as money from the corner of the eye, in every zone and under every
 * skin, so the specials keep the paint the player learned them in and take
 * only the silhouette.
 */
export const SKINS: TargetSkin[] = [ ...PHOTOS, ...CORE, ...CREW, ...FLAGS ];

export const SKIN_BY_ID: Record<string, TargetSkin> =
    Object.fromEntries(SKINS.map(s => [ s.id, s ]));

/** The free one every save owns. Not the first tile any more, so named here. */
export const DEFAULT_SKIN = CORE[0];

/**
 * The drawing half of a skin, which is all a target needs handed to it.
 *
 * `art` is opt-out because a decal is the one part of a skin that competes for
 * the same space as a kind's own glyph: a coin target already has a dollar on
 * it, and a frog face underneath would leave the player reading two symbols to
 * answer one question. Those kinds take the silhouette and the wake and skip
 * the face.
 */
export function styleOf (skin: TargetSkin, withArt = true): TargetStyle
{
    return {
        shape: skin.shape,
        spin: skin.spin,
        glow: skin.glow,
        art: withArt ? skin.art : undefined,
        trail: skin.trail
    };
}

/** The skin's take on a zone's paint. Undefined base means a special kind. */
export function paintOf (skin: TargetSkin, base?: Skin): Skin | undefined
{
    if (!base) return undefined;
    return skin.tint ? skin.tint(base) : base;
}
