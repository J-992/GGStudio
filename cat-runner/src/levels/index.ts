import { BEAM_TOP } from './procedural/ChunkTypes';

/**
 * Modelled lane obstacles, preloaded before any run is built so loading
 * finishes during the loading screen rather than hitching mid-run.
 *
 * `CITY_PROPS`/`RESTAURANT_PROPS` (the KayKit city/restaurant packs) and the
 * `fishcrates`/`pipevent`/`table` obstacle models used to live here too -
 * removed along with their `kaykit/city`, `kaykit/restaurant`, and
 * `obstacles/{fishcrates,pipevent,table}.glb` files. They were leftovers from
 * the pre-endless-only campaign: nothing in `src/levels/procedural/` (the
 * only game mode left) ever called `getProp()` or `getModel('obstacle/...')`
 * for any of them - confirmed by grep before deleting - so they were pure
 * dead weight on every boot. `clothesline1` is the one real survivor: it's
 * the endless track's own slide-under hazard, scaled to `BEAM_TOP` rather
 * than this list's old "under 1.0" rule since `ClotheslineHazard
 * .buildClotheslineHazard()` re-derives its own placement from the model's
 * measured proportions once loaded, and needs the full authored height to do
 * that - see that file's own doc comment.
 */
export const OBSTACLE_MODELS = [['clothesline1', BEAM_TOP]] as const;
