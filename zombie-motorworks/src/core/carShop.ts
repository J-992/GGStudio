/**
 * The Blueprint Shop: ten finished cars a player works towards owning.
 *
 * The garage is a grid editor, and a grid editor is a hobby. Plenty of players
 * want the other thing — pick the car that looks good, keep killing zombies,
 * and watch it get better on its own — and before this there was no way to
 * play that way at all. A shop car is that promise in data: a base rig cheap
 * enough to drive home today, and a fixed order of improvements that install
 * themselves the moment the wallet can cover the next one.
 *
 * Three rules make it work, and `unit/car-shop.test.ts` enforces all three:
 *
 * 1. **Every stage is a drivable rig.** Stage zero has a root, an engine and
 *    wheels; every later stage only ever *adds* to the stage before it. There
 *    is no point in the progression where the player owns a car they cannot
 *    deploy, and no improvement can be taken away to pay for another.
 * 2. **Order is fixed and hand-authored.** The stages are a build order, not a
 *    shopping list: guns before armour, armour before luxuries, and the parts
 *    that change how the car *plays* early enough to be worth the wait.
 * 3. **Nothing here is a signature block.** Storm Rod, Pyre Core and Fallout
 *    Silo come from a Build and are sold by nobody (see `builds.ts`), so a
 *    shop car that wanted one could never actually be bought.
 *
 * Pure data and pure functions. This module knows nothing about the profile,
 * the garage, or which mode is running — callers hand it a wallet and a list
 * of owned unlocks and it answers with prices and blueprints. That is what
 * lets the same shop serve Campaign, Daily, Endless and Creative unchanged.
 *
 * ## Geometry
 *
 * Cars are laid out on the same two decks the shipped Builds use, because
 * those are proven to connect: a flat deck of frame at `y = 1` with the
 * chassis core in it, wheels one cell outboard of the deck's own flanks, and
 * everything else standing on top at `y = 2`. A wheel on the `-x` flank takes
 * orientation 0 and one on the `+x` flank takes a 180-degree yaw, so both
 * mount inward onto the frame beside them. Multi-cell parts grow towards `+x`
 * and `+z` from their origin cell.
 */

import { createEmptyBlueprint } from './blueprint.ts';
import { orientationFromSteps } from './grid.ts';
import { getPartDef } from './parts.ts';
import type { PartConfig, PlacedPart, Vec3i, VehicleBlueprint } from './types.ts';

export type ShopCarId =
  | 'rustbucket'
  | 'roadkill'
  | 'ember-wagon'
  | 'frost-hauler'
  | 'bonecrusher'
  | 'widowmaker'
  | 'hellhound'
  | 'storm-chaser'
  | 'doomtread'
  | 'apex-predator';

/** One step of a car's build order. Stage zero is the base rig. */
export interface CarStage {
  /** Stable id, used by saves and the funnel. Never rename one. */
  readonly id: string;
  /** What the player is buying, on a button. Three words at most. */
  readonly label: string;
  /** One line on what it changes, under the label. */
  readonly note: string;
  /** Parts this stage bolts on. Empty is meaningless and never authored. */
  readonly parts: readonly PlacedPart[];
}

export interface ShopCar {
  readonly id: ShopCarId;
  readonly name: string;
  /** Two or three words on the chassis, for the card's subtitle. */
  readonly chassis: string;
  /** One line on how it plays. Never longer than a phone card's width. */
  readonly blurb: string;
  readonly stages: readonly CarStage[];
}

const YAW_180 = orientationFromSteps(0, 2, 0);

const v = (x: number, y: number, z: number): Vec3i => ({ x, y, z });

/** Driven, braked, and not steering backwards: the default for every axle. */
function drive(extra: PartConfig = {}): PartConfig {
  return { driven: true, braking: true, steerInverted: false, ...extra };
}

/** Off-road wheels ride the preset with the travel to match their size. */
function roughDrive(): PartConfig {
  return drive({ suspensionPreset: 'off-road' });
}

type PartSpec = [
  defId: string,
  pos: Vec3i,
  orient?: number,
  config?: PartConfig,
];

type StageSpec = [id: string, label: string, note: string, parts: PartSpec[]];

/**
 * Number a car's stages into `PlacedPart` lists.
 *
 * Ids run sequentially across the whole car rather than restarting per stage,
 * so the parts of stage N are always the first K entries of stage N + 1 and a
 * half-built car's ids never shift under it. That is what lets a saved rig be
 * matched back to the stage it was left at.
 */
function stages(specs: readonly StageSpec[]): CarStage[] {
  let next = 1;
  return specs.map(([id, label, note, parts]) => ({
    id,
    label,
    note,
    parts: parts.map(([defId, pos, orient = 0, config = {}]) => ({
      id: `p${next++}`,
      defId,
      pos: { ...pos },
      orient,
      config: { ...config },
    })),
  }));
}

/**
 * The small deck: three wide by three deep, with the core in the middle.
 *
 * Nine cells of frame is the cheapest platform that still has room for an
 * engine, a tank and a gun on the storey above, which is what makes it the
 * base for every car meant to be affordable early.
 */
function deckS(): PartSpec[] {
  const parts: PartSpec[] = [['chassis-core', v(0, 1, 0)]];
  for (const x of [-1, 0, 1]) {
    for (const z of [-1, 0, 1]) {
      if (x !== 0 || z !== 0) parts.push(['frame-box', v(x, 1, z)]);
    }
  }
  return parts;
}

/**
 * The long deck: four wide by four deep, offset so the core sits at the
 * origin.
 *
 * Even width on purpose. The 2x2 pads — the Heavy Cannon's barbette, the
 * sawblade — can only sit on the centreline of a deck with an even number of
 * cells across it, and every car here that carries one is built on this.
 */
function deckL(): PartSpec[] {
  const parts: PartSpec[] = [['chassis-core', v(0, 1, 0)]];
  for (const x of [-2, -1, 0, 1]) {
    for (const z of [-2, -1, 0, 1]) {
      if (x !== 0 || z !== 0) parts.push(['frame-box', v(x, 1, z)]);
    }
  }
  return parts;
}

/** The tank deck: four wide by three deep, in reinforced frame. */
function deckT(): PartSpec[] {
  const parts: PartSpec[] = [['chassis-core', v(0, 1, 0)]];
  for (const x of [-2, -1, 0, 1]) {
    for (const z of [-1, 0, 1]) {
      if (x !== 0 || z !== 0) parts.push(['frame-reinforced', v(x, 1, z)]);
    }
  }
  return parts;
}

/** Four wheels on the small deck's corners. */
function wheelsS(defId: string, config: PartConfig): PartSpec[] {
  return [
    [defId, v(-2, 1, 1), 0, config],
    [defId, v(2, 1, 1), YAW_180, config],
    [defId, v(-2, 1, -1), 0, config],
    [defId, v(2, 1, -1), YAW_180, config],
  ];
}

/** Four wheels on the long deck's corners, for the longest wheelbase it has. */
function wheelsL(defId: string, config: PartConfig): PartSpec[] {
  return [
    [defId, v(-3, 1, 1), 0, config],
    [defId, v(2, 1, 1), YAW_180, config],
    [defId, v(-3, 1, -2), 0, config],
    [defId, v(2, 1, -2), YAW_180, config],
  ];
}

/**
 * A stack of frame boxes, for the masts and pylons the big cars are built
 * around. Cheap in money and light in mass, which is what makes height the
 * affordable kind of drama: three blocks and a gun is a silhouette, where the
 * same money spent flat is another slab.
 */
function mast(x: number, z: number, fromY: number, toY: number): PartSpec[] {
  const parts: PartSpec[] = [];
  for (let y = fromY; y <= toY; y += 1) parts.push(['frame-box', v(x, y, z)]);
  return parts;
}

const CARS: Record<ShopCarId, ShopCar> = {
  /**
   * The first car anyone can afford, and deliberately the humblest. Its job is
   * to prove the shop works: a wave after picking it, something bolts itself on
   * without the player opening a single panel. Even so it does not stay flat —
   * the guns go up on posts, so the shape changes as it grows.
   */
  rustbucket: {
    id: 'rustbucket',
    name: 'Rustbucket Runner',
    chassis: 'Four wheels, gun posts',
    blurb:
      'Cheap, honest and slow to die. Grows a pair of gun posts and a blade, ' +
      'and suddenly it is not a wreck any more.',
    stages: stages([
      [
        'base',
        'Rolling Chassis',
        'A deck, four wheels and an engine. It drives.',
        [
          ...deckS(),
          ...wheelsS('wheel-standard', drive()),
          ['engine-small', v(1, 2, -1)],
          ['fuel-tank', v(-1, 2, -1)],
        ],
      ],
      [
        'blaster',
        'Gun Post',
        'A blaster up on a post, shooting over everything.',
        [...mast(0, 0, 2, 2), ['turret', v(0, 3, 0)]],
      ],
      [
        'plates',
        'Shoulder Plates',
        'Armour where a walker reaches the deck from.',
        [
          ['armour-plate', v(-1, 2, 1)],
          ['armour-plate', v(1, 2, 1)],
        ],
      ],
      [
        'saw',
        'Nose Sawblade',
        'Rewards driving through the horde instead of around it.',
        [['sawblade', v(-1, 1, 2)]],
      ],
      [
        'blaster-2',
        'Second Post',
        'A matching tower up front. Two guns, two storeys.',
        [...mast(0, 1, 2, 2), ['turret', v(0, 3, 1)]],
      ],
      [
        'engine-2',
        'Second Engine',
        'Torque sums. It finally launches.',
        [['engine-small', v(0, 2, -1)]],
      ],
      [
        'drones',
        'Drone Pod',
        'A little swarm that shoots what you are not.',
        [...mast(-1, 0, 2, 2), ['drone-swarm', v(-1, 3, 0)]],
      ],
    ]),
  },

  /**
   * Low, long and pointed. The Coupe grows forwards rather than upwards: a
   * spiked lance three cells past the front axle, and a raised tail wing over
   * the engines. It should look like it is doing 60 standing still.
   */
  roadkill: {
    id: 'roadkill',
    name: 'Roadkill Coupe',
    chassis: 'Long nose, tail wing',
    blurb:
      'A lance on the front and a wing on the back. Built to hit things at ' +
      'speed and be somewhere else by the time they land.',
    stages: stages([
      [
        'base',
        'Rolling Chassis',
        'Motorcycle wheels on a light deck. Very quick, very fragile.',
        [
          ...deckS(),
          ...wheelsS('wheel-moto', drive()),
          ['engine-small', v(1, 2, -1)],
          ['fuel-tank', v(-1, 2, -1)],
        ],
      ],
      [
        'lance',
        'Spiked Lance',
        'A nose that reaches three cells past the front axle.',
        [['frame-box', v(0, 1, 2)], ['spike-ram', v(0, 1, 3)]],
      ],
      [
        'blaster',
        'Gun Post',
        'Something is always shooting, even mid-drift.',
        [...mast(0, 0, 2, 2), ['turret', v(0, 3, 0)]],
      ],
      [
        'wing',
        'Tail Wing',
        'A plated wing over the engine bay. Mostly for the look.',
        [
          ['armour-plate', v(-1, 3, -1)],
          ['armour-plate', v(1, 3, -1)],
        ],
      ],
      [
        'blaster-2',
        'Second Post',
        'A pair now covers both flanks.',
        [...mast(0, 1, 2, 2), ['turret', v(0, 3, 1)]],
      ],
      [
        'engine-2',
        'Second Engine',
        'Off a standing start, nothing else is close.',
        [['engine-small', v(0, 2, -1)]],
      ],
      [
        'nitro',
        'Nitro Injector',
        'A button that turns the whole rig into the weapon.',
        [['nitro-injector', v(-1, 2, 0)]],
      ],
    ]),
  },

  /**
   * A tanker. The drum goes up on a raised cradle amidships and the burners
   * hang off outrigger arms, so the finished wagon is wider than its own
   * wheelbase and carries its fuel where everyone can see it.
   */
  'ember-wagon': {
    id: 'ember-wagon',
    name: 'Ember Wagon',
    chassis: 'Outrigger burners, raised drum',
    blurb:
      'Drives into the middle of a pack and cooks it from both sides. The ' +
      'drum on the roof is not decoration.',
    stages: stages([
      [
        'base',
        'Rolling Chassis',
        'A long four-wheel deck with room to build out from.',
        [
          ...deckL(),
          ...wheelsL('wheel-standard', drive()),
          ['engine-small', v(1, 2, -2)],
          ['fuel-tank', v(-2, 2, -2)],
        ],
      ],
      [
        'blaster',
        'Gun Post',
        'Cover while the burners warm up.',
        [...mast(0, 0, 2, 2), ['turret', v(0, 3, 0)]],
      ],
      [
        'outrigger',
        'Port Burner',
        'An arm out past the wheel with a burner standing on the end of it.',
        [
          ['frame-box', v(-2, 2, 1)],
          ['frame-box', v(-3, 2, 1)],
          ['flamethrower', v(-3, 3, 1)],
        ],
      ],
      [
        'plates',
        'Nose Plates',
        'The face that meets the horde, armoured.',
        [
          ['armour-plate', v(-1, 2, 1)],
          ['armour-plate', v(0, 2, 1)],
        ],
      ],
      [
        'outrigger-2',
        'Starboard Burner',
        'The matching arm. Two cones, one pack, no survivors.',
        [
          ['frame-box', v(1, 2, 1)],
          ['frame-box', v(2, 2, 1)],
          ['flamethrower', v(2, 3, 1)],
        ],
      ],
      [
        'engine-2',
        'Second Engine',
        'The wagon is wide and heavy now. This is not optional.',
        [['engine-small', v(-1, 2, -2)]],
      ],
      [
        'drum',
        'Raised Drum',
        'Rolling fuel on a cradle, and the third engine it takes to carry it.',
        [
          ['frame-box', v(-1, 2, -1)],
          ['frame-box', v(0, 2, -1)],
          ['frame-box', v(1, 2, -1)],
          ['barrel-drum', v(0, 3, -1)],
          ['engine-small', v(0, 2, -2)],
        ],
      ],
    ]),
  },

  /**
   * A cold turret on a two-storey pylon, with a shield dome beside it. The
   * Hauler is the tallest of the mid-priced cars and reads as a mobile
   * gun emplacement rather than a car with a gun on it.
   */
  'frost-hauler': {
    id: 'frost-hauler',
    name: 'Frost Hauler',
    chassis: 'Ice turret on a pylon',
    blurb:
      'Freezes what is coming and shrugs off what arrives. The turret sits ' +
      'two storeys up, where nothing can reach it.',
    stages: stages([
      [
        'base',
        'Rolling Chassis',
        'Monster wheels on a long deck. Slow, planted, hard to flip.',
        [
          ...deckL(),
          ...wheelsL('wheel-offroad', roughDrive()),
          ['engine-small', v(1, 2, -2)],
          ['fuel-tank', v(-2, 2, -2)],
        ],
      ],
      [
        'blaster',
        'Gun Post',
        'The gun that never stops firing.',
        [...mast(0, -1, 2, 2), ['turret', v(0, 3, -1)]],
      ],
      [
        'plates',
        'Nose Plates',
        'Plate across the front rank.',
        [
          ['armour-plate', v(-2, 2, 1)],
          ['armour-plate', v(1, 2, 1)],
        ],
      ],
      [
        'pylon',
        'Ice Turret',
        'A cannon three storeys up that slows a whole pack to a shuffle.',
        [...mast(0, 0, 2, 3), ['ice-cannon', v(0, 4, 0)]],
      ],
      [
        'engine-2',
        'Second Engine',
        'Weight has caught up with it.',
        [['engine-small', v(-1, 2, -2)]],
      ],
      [
        'shield',
        'Shield Dome',
        'A bubble on a key, for the moment it all goes wrong.',
        [...mast(-1, 1, 2, 2), ['shield-generator', v(-1, 3, 1)]],
      ],
      [
        'drones',
        'Drone Pod',
        'Cleans up whatever the ice left standing.',
        [...mast(0, 1, 2, 2), ['drone-swarm', v(0, 3, 1)]],
      ],
    ]),
  },

  /**
   * All nose. The blade goes on early and everything after it is height behind
   * the blade: a stacked cab, a plated brow, and a thumper slung under the
   * tail. It should look like it was built around the shovel.
   */
  bonecrusher: {
    id: 'bonecrusher',
    name: 'Bonecrusher',
    chassis: 'Bulldozer blade, stacked cab',
    blurb:
      'Does not shoot its way through a crowd so much as push it somewhere ' +
      'else. Heavy, tall, and glad of both.',
    stages: stages([
      [
        'base',
        'Rolling Chassis',
        'Monster wheels and a long deck to hang a blade off.',
        [
          ...deckL(),
          ...wheelsL('wheel-offroad', roughDrive()),
          ['engine-small', v(1, 2, -2)],
          ['fuel-tank', v(-2, 2, -2)],
        ],
      ],
      [
        'blaster',
        'Gun Post',
        'Something has to shoot while you drive.',
        [...mast(0, 0, 2, 2), ['turret', v(0, 3, 0)]],
      ],
      [
        'cab',
        'Stacked Cab',
        'A second storey behind the nose, plated on the brow.',
        [
          ['frame-box', v(-1, 2, 0)],
          ['frame-box', v(-1, 2, 1)],
          ['armour-plate', v(-1, 3, 1)],
          ['armour-plate', v(-1, 3, 0)],
        ],
      ],
      [
        'engine-2',
        'Second Engine',
        'A blade needs something behind it.',
        [['engine-small', v(-1, 2, -2)]],
      ],
      [
        'blaster-2',
        'Second Post',
        'Covers the flank the blade cannot.',
        [...mast(1, 0, 2, 2), ['turret', v(1, 3, 0)]],
      ],
      [
        'blade',
        'Bulldozer Blade',
        'Three cells of steel across the nose.',
        [['dozer-blade', v(0, 1, 2)]],
      ],
      [
        'thumper',
        'Thumper',
        'A ground slam that clears the ring, and a third engine behind it.',
        [
          ['thumper', v(0, 2, -1)],
          ['engine-small', v(0, 2, -2)],
        ],
      ],
    ]),
  },

  /**
   * Two long guns on two masts, and almost nothing else. The Widowmaker is the
   * narrowest silhouette in the shop and the only one that is taller than it is
   * wide, which is the whole read: a spider on stilts, not a truck.
   */
  widowmaker: {
    id: 'widowmaker',
    name: 'Widowmaker',
    chassis: 'Twin masts, long guns',
    blurb:
      'Kills things before they are a problem, from the top of two masts, ' +
      'and phases out of the ones that get close anyway.',
    stages: stages([
      [
        'base',
        'Rolling Chassis',
        'A light, quick deck built to keep its distance.',
        [
          ...deckS(),
          ...wheelsS('wheel-moto', drive()),
          ['engine-small', v(0, 2, -1)],
          ['fuel-tank', v(-1, 2, -1)],
        ],
      ],
      [
        'mast',
        'Port Mast',
        'A sniper three storeys up, reaching across the arena.',
        [...mast(-1, 1, 2, 3), ['sniper-light', v(-1, 4, 1)]],
      ],
      [
        'engine-2',
        'Second Engine',
        'Repositioning is the whole game here.',
        [['engine-small', v(1, 2, -1)]],
      ],
      [
        'mast-2',
        'Starboard Mast',
        'The matching tower. Two long guns, twice the reach.',
        [...mast(1, 1, 2, 3), ['sniper-light', v(1, 4, 1)]],
      ],
      [
        'plate',
        'Mast Plating',
        'Armour around the legs, which is what actually gets bitten.',
        [
          ['armour-plate', v(-1, 2, 0)],
          ['armour-plate', v(1, 2, 0)],
        ],
      ],
      [
        'phase',
        'Phase Drive',
        'Straight through whatever cornered you.',
        [['phase-drive', v(0, 2, 0)]],
      ],
      [
        'pulse',
        'Pulse Emitter',
        'Shoves the ring back when the reach runs out.',
        [['pulse-emitter', v(1, 3, 0)]],
      ],
    ]),
  },

  /**
   * A missile battery with a car underneath it. The rack goes on a raised aft
   * platform and the burners hang off wings, so the finished rig is a wide
   * flat-topped thing bristling in three directions.
   */
  hellhound: {
    id: 'hellhound',
    name: 'Hellhound',
    chassis: 'Missile deck, burner wings',
    blurb:
      'Answers a horde with ordnance from a raised rack. Everything on it is ' +
      'loud and most of it is on fire.',
    stages: stages([
      [
        'base',
        'Rolling Chassis',
        'Monster wheels under a long deck.',
        [
          ...deckL(),
          ...wheelsL('wheel-offroad', roughDrive()),
          ['engine-small', v(1, 2, -2)],
          ['fuel-tank', v(-2, 2, -2)],
        ],
      ],
      [
        'blaster',
        'Gun Post',
        'The floor every rig deserves.',
        [...mast(0, 0, 2, 2), ['turret', v(0, 3, 0)]],
      ],
      [
        'saw',
        'Nose Sawblade',
        'For anything that survives the drive in.',
        [['sawblade', v(-1, 1, 2)]],
      ],
      [
        'plates',
        'Nose Plates',
        'Plate across the front rank.',
        [
          ['armour-plate', v(-2, 2, 1)],
          ['armour-plate', v(1, 2, 1)],
        ],
      ],
      [
        'engine-2',
        'Second Engine',
        'Ordnance is heavy.',
        [['engine-small', v(-1, 2, -2)]],
      ],
      [
        'wing',
        'Burner Wing',
        'An arm out past the wheel with a burner standing on the tip.',
        [
          ['frame-box', v(-2, 2, 0)],
          ['frame-box', v(-3, 2, 0)],
          ['flamethrower', v(-3, 3, 0)],
        ],
      ],
      [
        'missiles',
        'Missile Deck',
        'A raised rack over the tail. The reason to build the rest of this car.',
        [
          ['frame-box', v(-1, 2, -1)],
          ['frame-box', v(0, 2, -1)],
          ['frame-box', v(1, 2, -1)],
          ['missile-launcher', v(0, 3, -1)],
          ['engine-small', v(0, 2, -2)],
        ],
      ],
    ]),
  },

  /**
   * The lightning rod. Everything on the Chaser is in service of one image: a
   * four-storey mast with a coil on top, throwing chains across a crowd while
   * the car underneath is already leaving.
   */
  'storm-chaser': {
    id: 'storm-chaser',
    name: 'Storm Chaser',
    chassis: 'Four-storey tesla mast',
    blurb:
      'Chains lightning through a pack from the top of a mast and is gone ' +
      'before the next one lands.',
    stages: stages([
      [
        'base',
        'Rolling Chassis',
        'Monster wheels on a compact deck. Quick for its weight.',
        [
          ...deckS(),
          ...wheelsS('wheel-offroad', roughDrive()),
          ['engine-small', v(1, 2, -1)],
          ['fuel-tank', v(-1, 2, -1)],
        ],
      ],
      [
        'blaster',
        'Gun Post',
        'Holds the line until the mast is up.',
        [...mast(0, 1, 2, 2), ['turret', v(0, 3, 1)]],
      ],
      [
        'plates',
        'Shoulder Plates',
        'Armour on the corners that get bitten.',
        [
          ['armour-plate', v(-1, 2, 1)],
          ['armour-plate', v(1, 2, 1)],
        ],
      ],
      [
        'engine-2',
        'Second Engine',
        'Chasing a storm means never being still.',
        [['engine-small', v(0, 2, -1)]],
      ],
      [
        'thumper',
        'Thumper',
        'Clears the ring when they close in.',
        [['thumper', v(1, 2, 0)]],
      ],
      [
        'nitro',
        'Nitro Injector',
        'Out of trouble faster than it arrived.',
        [['nitro-injector', v(-1, 2, 0)]],
      ],
      [
        'tesla',
        'Tesla Mast',
        'Four storeys of pylon with a coil on the roof.',
        [...mast(0, 0, 2, 4), ['tesla-coil', v(0, 5, 0)]],
      ],
    ]),
  },

  /**
   * The tank. A reinforced hull on belts, a blade, plate skirts, and a
   * barbette two storeys over the deck carrying the cannon — so the gun clears
   * its own armour instead of sitting in it.
   */
  doomtread: {
    id: 'doomtread',
    name: 'Doomtread',
    chassis: 'Belts, blade, raised barbette',
    blurb:
      'Slow, reinforced and nearly unkillable. The cannon sits on a tower ' +
      'over the hull and fires down its own spine.',
    stages: stages([
      [
        'base',
        'Rolling Chassis',
        'A reinforced hull on two belts, and the pair of engines it takes to move it.',
        [
          ...deckT(),
          ['tread-tank', v(-3, 1, 0), 0, drive()],
          ['tread-tank', v(2, 1, 0), YAW_180, drive()],
          ['engine-small', v(1, 2, -1)],
          ['engine-small', v(-2, 2, -1)],
          ['fuel-tank', v(-2, 2, 0)],
        ],
      ],
      [
        'blaster',
        'Gun Post',
        'Short arc, for whatever is chewing on the belts.',
        [...mast(1, 0, 2, 2), ['turret', v(1, 3, 0)]],
      ],
      [
        'plates',
        'Nose Plates',
        'Plate on the face that meets the horde.',
        [
          ['armour-plate', v(-2, 2, 1)],
          ['armour-plate', v(1, 2, 1)],
        ],
      ],
      [
        'skirts',
        'Hull Skirts',
        'The rest of the hull, walled in.',
        [
          ['armour-plate', v(-1, 2, -1)],
          ['armour-plate', v(0, 2, -1)],
        ],
      ],
      [
        'blade',
        'Bulldozer Blade',
        'Three cells of steel, pushed by three tonnes.',
        [['dozer-blade', v(0, 1, 2)]],
      ],
      [
        'barbette',
        'Raised Barbette',
        'A cannon on a tower, clearing its own armour.',
        [
          ['frame-reinforced', v(-1, 2, 0)],
          ['frame-reinforced', v(0, 2, 0)],
          ['frame-reinforced', v(-1, 2, 1)],
          ['frame-reinforced', v(0, 2, 1)],
          ['cannon-heavy', v(-1, 3, 0)],
        ],
      ],
    ]),
  },

  /**
   * The cathedral. Every stage past the base is a headline part on a structure
   * built to carry it, and the finished car is four storeys tall with a beam
   * on the spire — so a half-built Apex is already the strangest thing in the
   * arena and the finished one is unmistakable from across it.
   */
  'apex-predator': {
    id: 'apex-predator',
    name: 'Apex Predator',
    chassis: 'Four storeys, spired beam',
    blurb:
      'The end of the shop. A cannon shoulder, a missile shoulder, a tesla ' +
      'mast, and a mind control beam on the spire above all of it.',
    stages: stages([
      [
        'base',
        'Rolling Chassis',
        'A long deck on monster wheels, with two engines from the start.',
        [
          ...deckL(),
          ...wheelsL('wheel-offroad', roughDrive()),
          ['engine-small', v(-2, 2, -2)],
          ['engine-small', v(1, 2, -2)],
          ['fuel-tank', v(0, 2, -2)],
        ],
      ],
      [
        'saw',
        'Nose Sawblade',
        'The cheap thing that makes the base rig fun.',
        [['sawblade', v(-1, 1, 2)]],
      ],
      [
        'plates',
        'Deck Plates',
        'Armour amidships, where the deck is widest.',
        [
          ['armour-plate', v(-2, 2, 1)],
          ['armour-plate', v(1, 2, 1)],
        ],
      ],
      [
        'nitro',
        'Nitro Injector',
        'Three tonnes of car, moved like it is not.',
        [['nitro-injector', v(-1, 2, -1)]],
      ],
      [
        'tesla',
        'Tesla Mast',
        'A coil three storeys up, and the third engine the height costs.',
        [
          ...mast(0, 1, 2, 3),
          ['tesla-coil', v(0, 4, 1)],
          ['engine-small', v(-1, 2, -2)],
        ],
      ],
      [
        'cannon',
        'Cannon Shoulder',
        'A barbette on the port side, raised clear of the deck.',
        [
          ['frame-box', v(-2, 2, 0)],
          ['frame-box', v(-1, 2, 0)],
          ['frame-box', v(-2, 2, -1)],
          ['cannon-heavy', v(-2, 3, -1)],
        ],
      ],
      [
        'beam',
        'Spired Beam',
        'Four storeys of pylon, and a beam that turns the front rank around.',
        [...mast(0, 0, 2, 4), ['mind-control-beam', v(0, 5, 0)]],
      ],
      [
        'missiles',
        'Missile Shoulder',
        'The starboard rack. The last thing this car needed, and it got it.',
        [
          ['frame-box', v(1, 2, 0)],
          ['frame-box', v(1, 2, -1)],
          ['missile-launcher', v(1, 3, 0)],
        ],
      ],
    ]),
  },
};

/**
 * The shop's running order, cheapest total first.
 *
 * The order is the progression: a player reads down the list and the cars get
 * further away. `unit/car-shop.test.ts` holds it to that, so a re-priced part
 * that reshuffles the ladder fails the suite rather than quietly leaving the
 * dearest car at the top of the panel.
 */
export const SHOP_CARS: readonly ShopCar[] = [
  CARS.rustbucket,
  CARS.roadkill,
  CARS['ember-wagon'],
  CARS['frost-hauler'],
  CARS.bonecrusher,
  CARS.widowmaker,
  CARS.hellhound,
  CARS['storm-chaser'],
  CARS.doomtread,
  CARS['apex-predator'],
];

export function getShopCar(id: string | undefined): ShopCar | undefined {
  return SHOP_CARS.find((car) => car.id === id);
}

/**
 * The rig as it stands with stages 0..`stageIndex` installed.
 *
 * Clamped rather than guarded: a save naming a stage this car no longer has —
 * a shortened build order, a hand-edited profile — should hand back the whole
 * car rather than throw in the middle of opening the garage.
 */
export function carBlueprintAt(
  car: ShopCar,
  stageIndex: number,
): VehicleBlueprint {
  const last = Math.min(
    car.stages.length - 1,
    Math.max(0, Math.floor(Number.isFinite(stageIndex) ? stageIndex : 0)),
  );
  const bp = createEmptyBlueprint(car.name);
  bp.parts = car.stages
    .slice(0, last + 1)
    .flatMap((stage) => stage.parts.map((part) => ({ ...part })));
  return bp;
}

/** Catalog cost of one part, ignoring unlocks. */
function partCost(defId: string): number {
  try {
    return getPartDef(defId).cost;
  } catch {
    return 0;
  }
}

function unlockCostOf(defId: string): number {
  try {
    return getPartDef(defId).unlockCost ?? 0;
  } catch {
    return 0;
  }
}

/**
 * What stage `stageIndex` costs to install right now.
 *
 * An unlock is charged once, the first time the stage needs it — four
 * off-road wheels on a rig whose owner has never bought one is four wheels
 * plus one unlock, not four of each.
 */
export function carStageCost(
  car: ShopCar,
  stageIndex: number,
  unlockedDefIds: readonly string[],
): number {
  const stage = car.stages[stageIndex];
  if (stage === undefined) return 0;
  const owned = new Set(unlockedDefIds);
  let total = 0;
  for (const part of stage.parts) {
    total += partCost(part.defId);
    if (!owned.has(part.defId)) {
      total += unlockCostOf(part.defId);
      owned.add(part.defId);
    }
  }
  return total;
}

/** Everything the car costs from nothing, including the base rig. */
export function carTotalCost(
  car: ShopCar,
  unlockedDefIds: readonly string[],
): number {
  const owned = [...unlockedDefIds];
  let total = 0;
  for (let index = 0; index < car.stages.length; index += 1) {
    total += carStageCost(car, index, owned);
    for (const part of car.stages[index].parts) owned.push(part.defId);
  }
  return total;
}

export interface InstallPlan {
  /** How many further stages the wallet covers. */
  readonly stages: number;
  /** What they cost together, unlocks included and never double-charged. */
  readonly spend: number;
  /** Catalog ids the purchase unlocks, for the profile to record. */
  readonly unlocks: readonly string[];
}

const NOTHING: InstallPlan = { stages: 0, spend: 0, unlocks: [] };

/**
 * How much of the remaining car this wallet can buy, in order.
 *
 * Greedy and strictly sequential: the shop never skips ahead to a cheap stage
 * behind an expensive one, because the build order is the design. Returns the
 * whole run in one plan so the caller can apply it as a single transaction —
 * a garage opened after a good wave should install everything it can at once
 * rather than one part per visit.
 */
export function installableStages(
  car: ShopCar,
  installedStages: number,
  money: number,
  unlockedDefIds: readonly string[],
): InstallPlan {
  if (!Number.isFinite(money) || money <= 0) return NOTHING;

  const owned = new Set(unlockedDefIds);
  const unlocks: string[] = [];
  let spend = 0;
  let bought = 0;

  for (
    let index = Math.max(0, Math.floor(installedStages));
    index < car.stages.length;
    index += 1
  ) {
    const cost = carStageCost(car, index, [...owned]);
    if (spend + cost > money) break;
    spend += cost;
    bought += 1;
    for (const part of car.stages[index].parts) {
      if (owned.has(part.defId)) continue;
      owned.add(part.defId);
      if (unlockCostOf(part.defId) > 0) unlocks.push(part.defId);
    }
  }

  return bought === 0 ? NOTHING : { stages: bought, spend, unlocks };
}
