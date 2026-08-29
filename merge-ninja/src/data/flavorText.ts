/**
 * Pokedex-style one-liners for the almanac. Content only -- never touches
 * gameplay data, names, or combat stats. Approved copy, drafted against
 * `src/data/ninjas.ts` and `src/data/enemies.ts`'s current roster order.
 *
 * The bitmap font has no lowercase glyphs (see theme.ts / DECISIONS.md #28),
 * so every line ships pre-shouted rather than relying on a caller to upper
 * it, matching how the almanac already treats names.
 */

/** Indexed 0 = tier 1, matching `ninjaFlavorText`'s 1-based input. */
const NINJA_FLAVOR: readonly string[] = [
  'STILL LEARNING TO HOLD THE SWORD STEADY.',
  "SCOUTS AHEAD ON ICE THAT WON'T HOLD ANYONE ELSE.",
  'NEVER MISSES A SHOT AMONG THE TREES.',
  'GUARDS THE DOJO GATE, RAIN OR SHINE.',
  'CARRIES ORDERS FASTER THAN ANY MESSENGER BIRD.',
  'ARMOR SO DARK IT EATS THE MOONLIGHT.',
  'STRIKES ONCE, THEN IS SIMPLY GONE.',
  'TWO SWORDS, ONE BREATH BETWEEN STRIKES.',
  'SAILED IN ON A SHIP NOBODY SAW COMING.',
  'BUILT LIKE THE MACHINES IT TRAINED AGAINST.',
  'PLANS THREE MOVES AHEAD OF THE FIGHT.',
  'COMMANDS FIRE THE WAY OTHERS COMMAND ARMIES.',
  'HALF HERE, HALF SOMEWHERE ELSE, ALL FAST.',
  'FOLLOWS A TRAIL NO ONE ELSE CAN SEE.',
  'EVERY ARROW LANDS WARM.',
  'A SHIELD BRIGHT ENOUGH TO BLIND A BOSS.',
  'THE FIRST NINJA TO TRULY TAKE FLIGHT.',
  'SHARPER AND FASTER THAN THE CRUSADER IT OUTGREW.',
  'SPEAKS AND THE SEA ANSWERS.',
  'WEAVES WAVES INTO A CROWN OF WATER.',
  'GONE BEFORE THE SMOKE EVEN CLEARS.',
  'STEPS BETWEEN WORLDS LIKE STEPPING OVER A PUDDLE.',
  'A MASTERLESS BLADE THAT COILS BEFORE IT STRIKES.',
  'VISIBLE ONLY WHEN THE LIGHT GIVES UP.',
  'WALKS A ROAD OF ASH AND EMBER.',
  'GUARDS THE LINE WITH AN AXE OF LIVING THORNS.',
  'HUNTS THROUGH BRIARS THAT PART FOR NO ONE ELSE.',
  'SEES THE FIGHT FROM SOMEWHERE ABOVE THE SKY.',
  'THE LAST FORM. THE DOJO HAS NOTHING LEFT TO TEACH.',
];

/** Indexed 0-based, matching `BOSS_NAMES` / `bossIdentity`'s own index. */
const BOSS_FLAVOR: readonly string[] = [
  "EVERY LEGEND'S VERY FIRST OPPONENT.",
  'STILL COUNTING THE STEPS TO A GOOD SWING.',
  'WEARS A MASK TO HIDE HOW NERVOUS HE IS.',
  'TRAINED WITH A BAMBOO POLE UNTIL IT FELT LIKE A SWORD.',
  'TWO SWORDS AND ZERO PATIENCE.',
  'CHALLENGES EVERY LINE THAT PASSES THE GATE.',
  'HITS LIKE A FOUNDRY DOOR SLAMMING SHUT.',
  'TICKS LIKE A CLOCK RIGHT BEFORE IT STRIKES.',
  'BUILT FROM SPARE PARTS AND A BAD ATTITUDE.',
  'SWINGS A CHAIN NOBODY SEES COMING TWICE.',
  'SAILS IN ON A TIDE OF BAD NEWS.',
  'WATCHES THE FIGHT THROUGH A CRACK IN THE AIR.',
  'COMMANDS A LEGION WITH FOXFIRE ALONE.',
  'SWINGS A STAFF HEAVY ENOUGH TO CRACK STONE.',
  'FENCES IN THE AIR AS EASILY AS ON THE GROUND.',
  'GUARDS THE PASS WITH A SWORD THAT NEVER COOLS.',
  'CAME UP FROM SOMEWHERE DEEP AND DARK.',
  'ENDS FIGHTS BEFORE THE SMOKE EVEN SETTLES.',
  'COMMANDS ARCHERS HIDDEN IN EVERY LEAF.',
  'DIVES OUT OF A SKY FULL OF FROST.',
  'A MOUNTAIN THAT LEARNED TO WALK.',
  'HUNTS SILENT THROUGH TANGLED THORNS.',
  'SPLITS SHIELDS THE WAY OTHERS SPLIT LOGS.',
  'RULES EVERY WAVE THAT REACHES SHORE.',
  "BUILT SOMEWHERE THE STARS CAN'T REACH.",
  "RAIDS THROUGH BRAMBLES LIKE THEY'RE OPEN ROAD.",
  'LEADS THE CLAN WITH FISTS OF RIVER STONE.',
  'HALF LEGEND, HALF MACHINE, ALL TALON.',
  'A RIVER SPIRIT WIRED WITH STOLEN TECH.',
  'NINE TAILS, ONE VERY OLD TRICK.',
  'EIGHT LEGS OF PURE CLOCKWORK MENACE.',
  "CARRIES ITS ANCESTORS' STRENGTH IN CARVED WOOD.",
  "A NINJA'S SHADOW THAT GREW SCALES.",
  'BREWED IN A VAT, RAISED ON LIGHTNING.',
  'EVERY FANG WOUND LIKE A SPRING.',
  'CUT OFF ONE HEAD, THREE GEARS SPIN UP.',
  'THE LAST BOSS. THE MOUNTAIN ITSELF BURNS FOR THIS ONE.',
];

/** One-line description for a ninja tier (1-based), or '' past the roster. */
export function ninjaFlavorText(tier: number): string {
  return NINJA_FLAVOR[Math.floor(tier) - 1] ?? '';
}

/** One-line description for a boss identity (0-based, matching `bossIdentity`). */
export function bossFlavorText(appearanceIndex: number): string {
  return BOSS_FLAVOR[Math.floor(appearanceIndex)] ?? '';
}

/**
 * The one line each boss modifier gets, the first time a player ever meets it.
 *
 * Written as an instruction, not a description: this banner is the only
 * teaching these mechanics get, and "SHIELDED" alone says what the boss is
 * without saying what to do about it. Kept to a handful of words because it
 * plays over a live fight and nothing pauses for it.
 */
export const ARCHETYPE_LESSON: Readonly<Record<string, string>> = {
  shielded: 'TAP THE BOSS TO BREAK THE GUARD',
  enraged: 'KEEP MERGING OR IT HEALS',
  greedy: 'BEAT THE CLOCK FOR TRIPLE COINS',
};
