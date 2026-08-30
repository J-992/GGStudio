#!/usr/bin/env node
/**
 * Extracts the subset of source assets the game actually ships.
 *
 * The raw archives in the repo root total ~17 MB and contain hundreds of models
 * across four export formats. We only need a couple of dozen glTF props, so this
 * script cherry-picks them into public/assets/ rather than dumping whole packs
 * into the build.
 *
 * Implemented with a minimal inline ZIP reader so it can safely run as a
 * postinstall step with zero dependencies.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

import { downsamplePng } from './png-resize.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public', 'assets');

/** Where the character/building/obstacle archives live. */
const SRC_ASSETS = join(ROOT, 'src', 'assets');

/**
 * Longest side, in pixels, any colour map is allowed to ship at.
 *
 * The archives author every map at 2048. At the follow camera's distance the
 * cat covers roughly 90 px and a townhouse wall a few hundred, so 2048 is
 * between four and twenty times more texel than the frame can show - it costs
 * 52 MB of download and 176 MB of texture memory across the eleven maps to
 * render detail that is never sampled. Halving to 1024 takes both to about a
 * quarter with no visible difference at gameplay distances.
 */
const MAX_TEXTURE_SIZE = 1024;

// ---------------------------------------------------------------------------
// Minimal ZIP reader (store + deflate; no zip64, which these archives don't use)
// ---------------------------------------------------------------------------

const SIG_EOCD = 0x06054b50;
const SIG_CENTRAL = 0x02014b50;

function readZip(path) {
  const buf = readFileSync(path);

  // The EOCD sits at the end, after a variable-length comment. Scan backwards.
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 22 - 0xffff; i--) {
    if (buf.readUInt32LE(i) === SIG_EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error(`Not a zip file: ${path}`);

  const entryCount = buf.readUInt16LE(eocd + 10);
  let ptr = buf.readUInt32LE(eocd + 16);

  const entries = new Map();
  for (let i = 0; i < entryCount; i++) {
    if (buf.readUInt32LE(ptr) !== SIG_CENTRAL) break;

    const method = buf.readUInt16LE(ptr + 10);
    const compressedSize = buf.readUInt32LE(ptr + 20);
    const nameLen = buf.readUInt16LE(ptr + 28);
    const extraLen = buf.readUInt16LE(ptr + 30);
    const commentLen = buf.readUInt16LE(ptr + 32);
    const localOffset = buf.readUInt32LE(ptr + 42);
    const name = buf.toString('utf8', ptr + 46, ptr + 46 + nameLen);

    entries.set(name, { method, compressedSize, localOffset });
    ptr += 46 + nameLen + extraLen + commentLen;
  }

  return {
    entries,
    read(name) {
      const e = entries.get(name);
      if (!e) return null;
      // The local header repeats the name/extra with possibly different lengths,
      // so the data offset must be recomputed here rather than trusted from the CD.
      const nameLen = buf.readUInt16LE(e.localOffset + 26);
      const extraLen = buf.readUInt16LE(e.localOffset + 28);
      const start = e.localOffset + 30 + nameLen + extraLen;
      const raw = buf.subarray(start, start + e.compressedSize);
      return e.method === 0 ? Buffer.from(raw) : inflateRawSync(raw);
    },
  };
}

// ---------------------------------------------------------------------------
// Asset selection
// ---------------------------------------------------------------------------

/** City Builder Bits: buildings, rooftop furniture, and street-level dressing. */
const CITY_MODELS = [
  'base',
  'building_A', 'building_B', 'building_C', 'building_D',
  'building_E', 'building_F', 'building_G', 'building_H',
  'building_A_withoutBase', 'building_B_withoutBase', 'building_C_withoutBase',
  'building_D_withoutBase', 'building_E_withoutBase', 'building_F_withoutBase',
  'building_G_withoutBase', 'building_H_withoutBase',
  'watertower', 'dumpster', 'bench', 'bush', 'streetlight',
  'box_A', 'box_B', 'trash_A', 'trash_B', 'firehydrant',
  'car_hatchback', 'car_sedan', 'car_taxi', 'car_stationwagon',
  'road_straight', 'road_corner', 'road_junction', 'road_tsplit',
];

/** Restaurant Bits: rooftop clutter and kitchen-flavoured props. */
const RESTAURANT_MODELS = [
  'crate', 'crate_lid', 'crate_tomatoes', 'crate_carrots',
  'crate_potatoes', 'crate_onions', 'crate_lettuce',
  'jar_A_large', 'jar_B_medium', 'jar_C_small', 'jar_D_large',
  'pot_A', 'pot_B', 'pot_large', 'pan_A',
  'menu', 'chair_A', 'chair_B', 'chair_stool',
  'table_round_A', 'table_round_A_small',
  'extractorhood', 'wall_window_open', 'wall_window_closed', 'door_A',
  'plate', 'food_dinner', 'papertowel', 'dishrack',
  'kitchencounter_straight_A', 'stove_single', 'fridge_A',
];

/**
 * Downtown City MegaKit (Quaternius, CC0) - the modular facade kit.
 *
 * Every piece here is on the same grid: 2 m wide, 3 m per floor, 0.2 m thick,
 * origin centred on X with its base at y=0 and its body extending -Z. That
 * regularity is the entire point - it is what lets `buildBuildingFacade` lay out
 * an arbitrary building from a couple of dozen small meshes.
 *
 * Deliberately excludes the kit's three pre-built buildings (18k-45k triangles
 * each) and everything street-level: the player is on the roofs and never sees
 * a pavement.
 */
const MEGAKIT_MODELS = [
  // Brick family.
  'Brick_Plain_1', 'Brick_Plain_3', 'Brick_Plain_4',
  'Brick_Window_Square_Single', 'Brick_Window_Trim',
  'Brick_TopTrim', 'Brick_BottomTrim', 'Brick_Corner_Plain',
  // Painted-metal family.
  'Metal_Plain_1', 'Metal_Plain_3', 'Metal_FullWindow', 'Metal_FirstFloor_Wall',
  // Plaster/trim family.
  'Trim_Plain_3', 'Trim_Window', 'Trim_FirstFloor_Wall', 'Trim_Corner',
  // Cornice courses that cap a facade.
  'Cornice_Brick_Center', 'Cornice_Metal_Center', 'Cornice_Trim_Center',
  // Rooftop dressing.
  'Prop_ACUnit', 'Prop_Planter_Single',
];

const ARCHIVES = [
  {
    zip: 'KayKit_City_Builder_Bits_1.0_FREE.zip',
    prefix: 'KayKit_City_Builder_Bits_1.0_FREE/Assets/gltf/',
    texture: 'citybits_texture.png',
    outDir: join(OUT, 'kaykit', 'city'),
    models: CITY_MODELS,
    license: 'KayKit_City_Builder_Bits_1.0_FREE/License.txt',
  },
  {
    zip: 'KayKit_Restaurant_Bits_1.0_FREE(1).zip',
    prefix: 'KayKit_Restaurant_Bits_1.0_FREE/Assets/gltf/',
    texture: 'restaurantbits_texture.png',
    outDir: join(OUT, 'kaykit', 'restaurant'),
    models: RESTAURANT_MODELS,
    license: 'KayKit_Restaurant_Bits_1.0_FREE/License.txt',
  },
  {
    zip: 'Downtown City MegaKit[Standard].zip',
    prefix: 'Exports/glTF (Godot)/',
    outDir: join(OUT, 'megakit'),
    models: MEGAKIT_MODELS,
    license: 'License_Standard.txt',
    // The kit's textures are ~130 MB of 4K PBR PNGs and semi-realistic besides,
    // which is the wrong art direction for this game. Only geometry ships, and
    // the meshes are recoloured at load time from the game's own palette - see
    // MegaKitPalette.ts. Stripping is mandatory, not an optimisation: a glTF
    // that still names its images would make the loader 404 on every one.
    stripTextures: true,
  },
];

/**
 * Removes every texture reference from a glTF document, keeping material names
 * intact so they can still be mapped to palette colours at load time.
 *
 * The kit's images are all plain `uri` references, so dropping the arrays is
 * enough - no bufferViews are orphaned by this.
 */
function stripGltfTextures(json) {
  const doc = JSON.parse(json.toString('utf8'));

  for (const material of doc.materials ?? []) {
    delete material.normalTexture;
    delete material.occlusionTexture;
    delete material.emissiveTexture;
    const pbr = material.pbrMetallicRoughness;
    if (pbr) {
      delete pbr.baseColorTexture;
      delete pbr.metallicRoughnessTexture;
    }
  }

  delete doc.images;
  delete doc.textures;
  delete doc.samplers;

  return Buffer.from(JSON.stringify(doc));
}

// ---------------------------------------------------------------------------

function write(dir, name, data) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), data);
  return data.length;
}

/**
 * Writes a colour map, downsampled to {@link MAX_TEXTURE_SIZE}.
 *
 * A resampler failure ships the original rather than nothing: an oversized
 * texture is a performance note, a missing one is a white cat.
 */
function writeImage(dir, name, data) {
  let out = data;
  try {
    const scaled = downsamplePng(data, MAX_TEXTURE_SIZE);
    out = scaled.data;
    if (scaled.resized) resized.push(`${name} -> ${scaled.width}x${scaled.height}`);
  } catch (err) {
    missing.push(`${name}: could not downsample (${err.message}), shipping as-is`);
  }
  return write(dir, name, out);
}

let totalBytes = 0;
let totalFiles = 0;
const missing = [];
/** Colour maps that were shrunk, reported so the saving is visible in the log. */
const resized = [];

function extractArchive(spec) {
  const zipPath = join(ROOT, spec.zip);
  if (!existsSync(zipPath)) {
    missing.push(spec.zip);
    return;
  }

  const zip = readZip(zipPath);

  // Each glTF is a .gltf + .bin pair that references the shared palette texture
  // by relative filename, so everything lands in one flat directory.
  for (const model of spec.models) {
    for (const ext of ['.gltf', '.bin']) {
      let data = zip.read(spec.prefix + model + ext);
      if (!data) {
        missing.push(`${spec.zip}:${model}${ext}`);
        continue;
      }
      if (spec.stripTextures && ext === '.gltf') data = stripGltfTextures(data);
      totalBytes += write(spec.outDir, model + ext, data);
      totalFiles++;
    }
  }

  if (spec.texture) {
    const tex = zip.read(spec.prefix + spec.texture);
    if (tex) {
      totalBytes += write(spec.outDir, spec.texture, tex);
      totalFiles++;
    } else {
      missing.push(`${spec.zip}:${spec.texture}`);
    }
  }

  const license = zip.read(spec.license);
  if (license) {
    totalBytes += write(spec.outDir, 'LICENSE.txt', license);
    totalFiles++;
  }
}

function copyCat() {
  const outDir = join(OUT, 'cat');
  // cat.blend (1.6 MB) is the source file, not a runtime asset - deliberately skipped.
  //
  // Neither Meshy biped is extracted here any more. kitty_model.glb (V1, a
  // quadruped) and kitty_modelV2.glb (the model cat_model.glb replaced) are
  // both unreferenced - see CatRig.ts's header comment - and the shipping
  // model is not a build artefact at all: cat_model.glb is 47 KB, so it is
  // committed to `public/assets/cat/` directly rather than being
  // reconstituted from an archive nobody but the author has.
  //
  // The pack's rigged `kittycat.fbx` and its animation takes are still copied
  // below - they are the fallback now, not the shipping model. See
  // AssetRegistry.loadCat's fallback chain.
  const sources = [
    // The old quadruped cat, the last resort if both rigs above it fail.
    [join(ROOT, 'cat'), 'cat.fbx'],
    [join(ROOT, 'cat'), 'catskin.png'],
  ];

  for (const [srcDir, name] of sources) {
    const src = join(srcDir, name);
    if (!existsSync(src)) {
      missing.push(`${basename(srcDir)}/${name}`);
      continue;
    }
    mkdirSync(outDir, { recursive: true });
    copyFileSync(src, join(outDir, name));
    totalBytes += readFileSync(src).length;
    totalFiles++;
  }
}

/**
 * Obstacle models.
 *
 * Meshy-style GLBs at arbitrary scale, so AssetRegistry normalises each one to
 * an authored world size on load rather than trusting the file. They are large
 * - about 8 MB apiece - which is fine locally and worth compressing before this
 * ships anywhere download time matters.
 */
function extractObstacles() {
  const zipPath = join(SRC_ASSETS, 'Environment_Obstacles.zip');
  if (!existsSync(zipPath)) {
    missing.push('src/assets/Environment_Obstacles.zip');
    return;
  }

  const zip = readZip(zipPath);
  for (const name of ['fishcrates.glb', 'pipevent.glb', 'table.glb']) {
    const data = zip.read(`Environment_Obstacles/${name}`);
    if (!data) {
      missing.push(`Environment_Obstacles.zip:${name}`);
      continue;
    }
    totalBytes += write(join(OUT, 'obstacles'), name, data);
    totalFiles++;
  }
}

/**
 * The player cat: one rig, five animation takes, six skins.
 *
 * Everything ships separately rather than as one merged export, which is what
 * makes the skins affordable. The rig is 269 KB and carries no texture
 * reference at all, so a skin is just a map bound at load time and swapping one
 * costs nothing but the map itself - where a merged GLB per skin would be six
 * copies of the same mesh.
 *
 * The takes all target the same 24-joint skeleton (`Hips`, `Spine02`, `Spine`,
 * `neck`, `Head`, `Left*`/`Right*`), so their tracks bind to the rig by name
 * with no retargeting - see `buildFbxClipSet` in CatAnimations.
 */
const CAT_ANIMATIONS = [
  'Cat_Animation_Running',
  'Cat_Animation_Jump_Run',
  'Cat_Animation_Jump_Over_Obstacle',
  'Cat_Animation_slide_right',
  'Cat_Animation_Walking',
];

/** Skin id (what the save file stores) -> file in the archive. */
const CAT_SKIN_FILES = {
  orange: 'cat_texture_orange.png',
  black: 'cat_texture_black.png',
  tuxedo: 'cat_texture_tuxedo.png',
  tabby: 'cat_texture_tabby.png',
  calico: 'cat_texture_calico.png',
  russianblue: 'cat_texture_russian_blue.png',
};

function extractCharacterCat() {
  const zipPath = join(SRC_ASSETS, 'Character_Cat.zip');
  if (!existsSync(zipPath)) {
    missing.push('src/assets/Character_Cat.zip');
    return;
  }

  const zip = readZip(zipPath);
  const outDir = join(OUT, 'cat');

  const rig = zip.read('Character_Cat/kittycat.fbx');
  if (rig) {
    totalBytes += write(outDir, 'kittycat.fbx', rig);
    totalFiles++;
  } else {
    missing.push('Character_Cat.zip:kittycat.fbx');
  }

  for (const name of CAT_ANIMATIONS) {
    const data = zip.read(`Character_Cat/Cat_Animations/${name}.fbx`);
    if (!data) {
      missing.push(`Character_Cat.zip:${name}.fbx`);
      continue;
    }
    totalBytes += write(join(outDir, 'anim'), `${name}.fbx`, data);
    totalFiles++;
  }

  for (const [id, file] of Object.entries(CAT_SKIN_FILES)) {
    const data = zip.read(`Character_Cat/Cat_Skins/${file}`);
    if (!data) {
      missing.push(`Character_Cat.zip:${file}`);
      continue;
    }
    totalBytes += writeImage(join(outDir, 'skins'), `${id}.png`, data);
    totalFiles++;
  }
}

/**
 * The townhouse every rooftop stands on, plus its five wall finishes.
 *
 * 327 vertices, and the five finishes share one UV layout - so a whole street
 * of visibly different buildings is one geometry and five materials, which is
 * the entire reason this model was chosen over authoring variants.
 *
 * The FBX carries its own PBR maps embedded (base colour, normal, emissive,
 * metallic, roughness). They are not stripped here because rewriting a binary
 * FBX to remove them is far riskier than dropping them on load, which
 * `AssetRegistry.toLambert` already does for every other model in the game.
 */
const BUILDING_TEXTURES = [
  'buildingtexture_beige',
  'buildingtexture_blue',
  'buildingtexture_brownbrick',
  'buildingtexture_orangebrick',
  'buildingtexture_yellow',
];

function extractTownhouse() {
  const zipPath = join(SRC_ASSETS, 'Environment_Building.zip');
  if (!existsSync(zipPath)) {
    missing.push('src/assets/Environment_Building.zip');
    return;
  }

  const zip = readZip(zipPath);
  const outDir = join(OUT, 'building');

  const model = zip.read('building/townhouse.fbx');
  if (model) {
    totalBytes += write(outDir, 'townhouse.fbx', model);
    totalFiles++;
  } else {
    missing.push('Environment_Building.zip:townhouse.fbx');
  }

  for (const name of BUILDING_TEXTURES) {
    const data = zip.read(`building/${name}.png`);
    if (!data) {
      missing.push(`Environment_Building.zip:${name}.png`);
      continue;
    }
    totalBytes += writeImage(outDir, `${name}.png`, data);
    totalFiles++;
  }
}

/**
 * Real sound samples, layered into `AudioManager`'s otherwise fully
 * synthesised mixer - see that file's header comment. The archive has ~70
 * other sounds; only these are used, `background_music.wav` being the
 * gameplay music bed rather than an effect.
 */
function extractSoundEffects() {
  const zipPath = join(SRC_ASSETS, 'sound_effects1.zip');
  if (!existsSync(zipPath)) {
    missing.push('src/assets/sound_effects1.zip');
    return;
  }

  const zip = readZip(zipPath);
  for (const name of [
    'bwah.wav',
    'bonus.wav',
    'bounce.wav',
    'collect4.wav',
    'wobbledown2.wav',
    'meow2.wav',
    'background_music.wav',
  ]) {
    const data = zip.read(name);
    if (!data) {
      missing.push(`sound_effects1.zip:${name}`);
      continue;
    }
    totalBytes += write(join(OUT, 'audio'), name, data);
    totalFiles++;
  }
}

/**
 * Power-up pickup models plus the collectible fish, each an OBJ + a single
 * colour-map PNG (no .mtl - the texture is bound manually at load time, same
 * pattern AssetRegistry already uses for the dog rig). Renamed on the way out
 * to the short names AssetRegistry/PowerUps reference.
 */
const ITEM_FILES = {
  heart: ['Nine_Lives/heart.obj', 'Nine_Lives/heart_texture.png'],
  shield: ['Shield/shield.obj', 'Shield/shield_texture.png'],
  magnet: ['Magnet/magnet.obj', 'Magnet/magnet_texture.png'],
  fish: ['Fish/better_fish.obj', 'Fish/better_fish_texture.png'],
  catnipRush: ['Catnip_Rush/jordan.obj', 'Catnip_Rush/jordan_texture.png'],
};

function extractItems() {
  const zipPath = join(SRC_ASSETS, 'Items.zip');
  if (!existsSync(zipPath)) {
    missing.push('src/assets/Items.zip');
    return;
  }

  const zip = readZip(zipPath);
  const outDir = join(OUT, 'items');

  for (const [outName, [objName, texName]] of Object.entries(ITEM_FILES)) {
    const obj = zip.read(`Items/${objName}`);
    if (!obj) {
      missing.push(`Items.zip:${objName}`);
    } else {
      totalBytes += write(outDir, `${outName}.obj`, obj);
      totalFiles++;
    }

    const tex = zip.read(`Items/${texName}`);
    if (!tex) {
      missing.push(`Items.zip:${texName}`);
    } else {
      totalBytes += writeImage(outDir, `${outName}_texture.png`, tex);
      totalFiles++;
    }
  }
}

for (const spec of ARCHIVES) extractArchive(spec);
copyCat();
extractObstacles();
extractTownhouse();
extractCharacterCat();
extractSoundEffects();
extractItems();

const mb = (totalBytes / 1024 / 1024).toFixed(2);
console.log(`[assets] extracted ${totalFiles} files (${mb} MB) into public/assets/`);

if (resized.length) {
  console.log(`[assets] downsampled ${resized.length} colour map(s) to ${MAX_TEXTURE_SIZE}px:`);
  for (const r of resized) console.log(`  - ${r}`);
}

if (missing.length) {
  console.warn(`[assets] ${missing.length} item(s) not found:`);
  for (const m of missing.slice(0, 20)) console.warn(`  - ${m}`);
  if (missing.length > 20) console.warn(`  ... and ${missing.length - 20} more`);
  console.warn('[assets] The game falls back to procedural geometry for anything missing.');
}
