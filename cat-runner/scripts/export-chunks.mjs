#!/usr/bin/env node
/**
 * Exports the six endless-run chunk types (`src/levels/procedural/ChunkTypes.ts`)
 * as individual OBJ files, one chunk per file, for polishing in Blender.
 *
 * These mirror exactly what `ObstaclePool`/`ChunkBuilder` place at runtime -
 * same box/cone primitives, same sizes, same chunk-local positions - just
 * assembled once here and written out instead of pooled into a live scene.
 * Placeholder geometry only (this track has no sculpted art yet), but the
 * scale and layout are the real thing, so anything built on top of these
 * meshes in Blender will already be sized and placed correctly in-game.
 *
 * Chunk-local coordinate convention (matches ChunkBuilder's `frame`-local
 * space before it's carried onto the route):
 *   x - lateral. Lane centres sit at laneX(-1 | 0 | 1) = mp*laneSpacing.
 *   y - height above the walking surface (0 = standing height).
 *   z - 0 at the chunk's leading edge, running to CHUNK_LENGTH (30).
 *
 * Run with: node scripts/export-chunks.mjs
 */

import { BoxGeometry, ConeGeometry, Group, Mesh, MeshBasicMaterial } from 'three';
import { OBJExporter } from 'three/examples/jsm/exporters/OBJExporter.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// --- Constants, mirrored from TrackConfig.ts / ChunkTypes.ts / PhysicsConfig.ts ---
// (plain numbers here rather than importing the .ts sources, which this plain
// Node script has no loader for - see each constant's source file for the
// reasoning behind the value itself.)

const DECK_THICKNESS = 1; // TrackConfig.ts
const DECK_WIDTH = 14; // TrackConfig.ts
const CHUNK_LENGTH = 30; // TrackConfig.ts
const LANE_SPACING = 2.4; // PhysicsConfig.ts

const GAP_LENGTH = 6.5; // ChunkTypes.ts
const DECK_A_LENGTH = (CHUNK_LENGTH - GAP_LENGTH) / 2;
const DECK_B_LENGTH = DECK_A_LENGTH;
const DECK_A_CENTER_Z = DECK_A_LENGTH / 2;
const DECK_C_CENTER_Z = DECK_A_LENGTH + GAP_LENGTH / 2;
const DECK_B_CENTER_Z = DECK_A_LENGTH + GAP_LENGTH + DECK_B_LENGTH / 2;

const OBSTACLE_SIZE = { width: 2.2, height: 1.4, depth: 1.8 }; // ChunkTypes.ts
const OBSTACLE_Z_LOOSE = [7, 23]; // ChunkTypes.ts

const CLOTHESLINE_ROPE_HEIGHT = 1.8; // ProceduralProps.ts
const CLOTHESLINE_CURTAIN_DROP = 1.25; // ProceduralProps.ts
const BEAM_RADIUS = CLOTHESLINE_CURTAIN_DROP / 2; // ChunkTypes.ts
const BEAM_LENGTH = DECK_WIDTH * 0.6; // ChunkTypes.ts
const BEAM_LOCAL_Z = CHUNK_LENGTH * 0.5; // ChunkTypes.ts
const BEAM_HEIGHT = CLOTHESLINE_ROPE_HEIGHT - CLOTHESLINE_CURTAIN_DROP / 2; // ChunkTypes.ts

const TURN_MARKER_LOCAL_Z = CHUNK_LENGTH * 0.15; // ChunkTypes.ts
const TURN_MARKER_RADIUS = 1.0; // ChunkTypes.ts
const TURN_MARKER_HEIGHT = 1.4; // ChunkTypes.ts

function laneX(lane) {
  return -lane * LANE_SPACING;
}

// --- Geometry helpers --------------------------------------------------------

const box = new BoxGeometry(1, 1, 1);
const cone = new ConeGeometry(0.5, 1, 4); // matches unitConeGeometry in PlaceholderAssets.ts
// Untextured, unnamed material: keeps the OBJ free of `usemtl`/mtllib lines
// pointing at a .mtl this script doesn't also write. Blender will import
// clean, undyed geometry ready for its own materials.
const material = new MeshBasicMaterial();

function addBox(group, name, position, size) {
  const mesh = new Mesh(box, material);
  mesh.name = name;
  mesh.position.set(...position);
  mesh.scale.set(...size);
  group.add(mesh);
  return mesh;
}

function addCone(group, name, position, size) {
  const mesh = new Mesh(cone, material);
  mesh.name = name;
  mesh.position.set(...position);
  mesh.scale.set(...size);
  group.add(mesh);
  return mesh;
}

/** The three-piece deck every chunk shares. `hasGap` omits the centre filler. */
function addDeck(group, hasGap) {
  addBox(group, 'DeckA', [0, -DECK_THICKNESS / 2, DECK_A_CENTER_Z], [DECK_WIDTH, DECK_THICKNESS, DECK_A_LENGTH]);
  if (!hasGap) {
    addBox(
      group,
      'DeckC_GapFiller',
      [0, -DECK_THICKNESS / 2, DECK_C_CENTER_Z],
      [DECK_WIDTH, DECK_THICKNESS, GAP_LENGTH],
    );
  }
  addBox(group, 'DeckB', [0, -DECK_THICKNESS / 2, DECK_B_CENTER_Z], [DECK_WIDTH, DECK_THICKNESS, DECK_B_LENGTH]);
}

// --- The six chunk types -------------------------------------------------------

function buildStraight() {
  const group = new Group();
  group.name = 'Chunk_Straight';
  addDeck(group, false);
  return group;
}

/** Representative two-obstacle layout (the generator's more common case,
 *  65% weighted) at the "loose" Z pair, one obstacle per outer lane, middle
 *  lane clear - see ChunkGenerators.ts's generateObstacle(). */
function buildObstacle() {
  const group = new Group();
  group.name = 'Chunk_Obstacle';
  addDeck(group, false);
  const [zNear, zFar] = OBSTACLE_Z_LOOSE;
  addBox(
    group,
    'Obstacle_LaneLeft',
    [laneX(-1), OBSTACLE_SIZE.height / 2, zNear],
    [OBSTACLE_SIZE.width, OBSTACLE_SIZE.height, OBSTACLE_SIZE.depth],
  );
  addBox(
    group,
    'Obstacle_LaneRight',
    [laneX(1), OBSTACLE_SIZE.height / 2, zFar],
    [OBSTACLE_SIZE.width, OBSTACLE_SIZE.height, OBSTACLE_SIZE.depth],
  );
  return group;
}

function buildSlide() {
  const group = new Group();
  group.name = 'Chunk_Slide';
  addDeck(group, false);
  addBox(group, 'SlideBeam', [0, BEAM_HEIGHT, BEAM_LOCAL_Z], [BEAM_LENGTH, BEAM_RADIUS * 2, 0.15]);
  return group;
}

function buildJump() {
  const group = new Group();
  group.name = 'Chunk_Jump';
  addDeck(group, true); // deckC omitted - this is the gap itself
  return group;
}

function buildTurn(dir) {
  const group = new Group();
  group.name = dir === -1 ? 'Chunk_TurnLeft' : 'Chunk_TurnRight';
  addDeck(group, false);
  addCone(
    group,
    'TurnMarker',
    [laneX(dir), 0.02, TURN_MARKER_LOCAL_Z],
    [TURN_MARKER_RADIUS * 2, TURN_MARKER_HEIGHT, TURN_MARKER_RADIUS * 2],
  );
  return group;
}

const CHUNKS = {
  straight: buildStraight(),
  obstacle: buildObstacle(),
  slide: buildSlide(),
  jump: buildJump(),
  turnLeft: buildTurn(-1),
  turnRight: buildTurn(1),
};

// --- Export --------------------------------------------------------------------

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'exports', 'chunks');
mkdirSync(OUT, { recursive: true });

const exporter = new OBJExporter();
for (const [type, group] of Object.entries(CHUNKS)) {
  group.updateMatrixWorld(true);
  const obj = exporter.parse(group);
  const path = join(OUT, `${type}.obj`);
  writeFileSync(path, obj);
  console.log(`wrote ${path}`);
}
