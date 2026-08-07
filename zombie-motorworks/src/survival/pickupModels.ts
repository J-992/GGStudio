/**
 * The thing a Supply Crate actually is, on the ground, in the world.
 *
 * Each kind gets its own hovering block built in the same language as the parts
 * on the rig — flat lambert bodies, dark contour lines, one lit accent — so a
 * drop reads as hardware lying in the graveyard rather than a UI token. The
 * silhouette is what names it at speed: a drum is fuel, a stack of notes is
 * money, a gun on a post is a sentry. Colour agrees with the label above it and
 * the marker on the minimap, and is never the only thing carrying the meaning.
 *
 * Every model is built once per mode as a template and cloned into whichever
 * slot is wearing that kind; clones share the template's geometry and
 * materials, so `disposePickupModel` on the templates frees the lot.
 */

import * as THREE from 'three';
import { getPartDef } from '../core/parts.ts';
import { buildPartMesh } from '../editor/meshes.ts';
import {
  DARK_STEEL,
  STEEL,
  boxWithEdges,
  edgesOf,
  glowLambert,
  lambert,
  shade,
} from '../editor/parts/shared.ts';
import type { PickupKind } from './dropTable.ts';

/** Rough height of every crate model, metres — one readable size for all six. */
const UNIT = 1.15;

/**
 * Where the sentry block's barrel tips sit in its own frame. The dropped
 * turret is this same block stood on the ground (see `SentryTurrets`), so its
 * shots have to leave the muzzles the model actually has.
 */
export const SENTRY_MUZZLE_LOCAL = { y: UNIT * 0.16, z: UNIT * 0.65 };

export function buildPickupModel(kind: PickupKind, color: number): THREE.Group {
  switch (kind) {
    case 'fuel':
      return buildFuelDrum(color);
    case 'cash':
      return buildCashStack(color);
    case 'repair':
      return buildToolbox(color);
    case 'sentry':
      return buildSentry(color);
    case 'colossus':
      return buildColossusBlock(color);
    case 'part':
      return buildSalvageCrate(color);
    default:
      return buildSalvageCrate(color);
  }
}

/** A squat fuel drum: the part it refills, shrunk to something you drive over. */
function buildFuelDrum(color: number): THREE.Group {
  const group = new THREE.Group();
  const radius = UNIT * 0.3;
  const height = UNIT * 0.62;

  const barrel = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, height, 16),
    lambert(color),
  );
  group.add(barrel);
  group.add(edgesOf(barrel.geometry));

  // Rolling hoops, the detail that makes a cylinder read as a barrel.
  const hoop = new THREE.CylinderGeometry(radius * 1.06, radius * 1.06, height * 0.12, 16);
  const hoopMaterial = lambert(shade(color, 0.62));
  for (const side of [-1, 1]) {
    const ring = new THREE.Mesh(hoop, hoopMaterial);
    ring.position.y = side * height * 0.28;
    group.add(ring);
  }

  // Filler cap and a lit sight gauge down one flank.
  const cap = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 0.3, radius * 0.3, height * 0.16, 10),
    lambert(STEEL),
  );
  cap.position.set(radius * 0.45, height * 0.55, 0);
  group.add(cap);

  const gauge = new THREE.Mesh(
    new THREE.BoxGeometry(UNIT * 0.06, height * 0.6, UNIT * 0.02),
    glowLambert(shade(color, 1.35), 1, 0.9),
  );
  gauge.position.set(0, 0, radius * 1.01);
  group.add(gauge);

  return group;
}

/** A banded stack of notes with a coin stood against it. */
function buildCashStack(color: number): THREE.Group {
  const group = new THREE.Group();
  const width = UNIT * 0.62;
  const depth = UNIT * 0.34;
  const noteHeight = UNIT * 0.09;

  for (let i = 0; i < 3; i += 1) {
    const note = boxWithEdges(width, noteHeight, depth, shade(color, 1 - i * 0.12));
    note.position.y = (i - 1) * noteHeight * 1.05;
    // Each bundle sits a little off true, the way stacked cash does.
    note.rotation.y = (i - 1) * 0.09;
    group.add(note);
  }

  // The paper band across the middle bundle.
  const band = new THREE.Mesh(
    new THREE.BoxGeometry(width * 0.22, noteHeight * 3.6, depth * 1.06),
    lambert(DARK_STEEL),
  );
  group.add(band);

  // A coin stood on edge against the corner of the stack: the lit accent, and
  // what still says "money" from the side, where the notes are just slabs.
  const coin = new THREE.Mesh(
    new THREE.CylinderGeometry(UNIT * 0.19, UNIT * 0.19, UNIT * 0.05, 18),
    glowLambert(0xffe58a, 1, 0.7),
  );
  coin.rotation.set(Math.PI / 2, 0.5, 0.22);
  coin.position.set(width * 0.52, -noteHeight * 0.5, depth * 0.62);
  group.add(coin);

  return group;
}

/** A field toolbox: handle over the lid, cross on the front. */
function buildToolbox(color: number): THREE.Group {
  const group = new THREE.Group();
  const width = UNIT * 0.66;
  const height = UNIT * 0.34;
  const depth = UNIT * 0.4;

  group.add(boxWithEdges(width, height, depth, color));

  const lid = boxWithEdges(width * 1.02, height * 0.22, depth * 1.02, shade(color, 0.7));
  lid.position.y = height * 0.5;
  group.add(lid);

  // Handle: two posts and a bar, so the box reads as something carried.
  const postGeometry = new THREE.BoxGeometry(UNIT * 0.05, height * 0.42, UNIT * 0.05);
  const steel = lambert(STEEL);
  for (const side of [-1, 1]) {
    const post = new THREE.Mesh(postGeometry, steel);
    post.position.set(side * width * 0.2, height * 0.8, 0);
    group.add(post);
  }
  const bar = new THREE.Mesh(
    new THREE.BoxGeometry(width * 0.52, UNIT * 0.05, UNIT * 0.05),
    steel,
  );
  bar.position.y = height * 1;
  group.add(bar);

  // Lit cross across the front face — a repair kit, not a supply box. Sized to
  // most of the face, because it is what names the crate from the front.
  const crossMaterial = glowLambert(0xf2fbff, 1, 1);
  const arm = new THREE.BoxGeometry(width * 0.5, height * 0.22, UNIT * 0.03);
  const stem = new THREE.BoxGeometry(width * 0.17, height * 0.68, UNIT * 0.03);
  for (const geometry of [arm, stem]) {
    for (const face of [1, -1]) {
      const piece = new THREE.Mesh(geometry, crossMaterial);
      piece.position.z = face * depth * 0.51;
      group.add(piece);
    }
  }

  return group;
}

/** A gun on a post: the same shape that stands up when the crate is taken. */
function buildSentry(color: number): THREE.Group {
  const group = new THREE.Group();

  // A narrow footplate under a clear length of post: the gap between base and
  // head is what makes the shape read as a mounted gun rather than a box.
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(UNIT * 0.2, UNIT * 0.26, UNIT * 0.1, 12),
    lambert(shade(color, 0.5)),
  );
  base.position.y = -UNIT * 0.36;
  group.add(base);
  group.add(edgesOf(base.geometry).translateY(-UNIT * 0.36));

  const post = new THREE.Mesh(
    new THREE.CylinderGeometry(UNIT * 0.07, UNIT * 0.08, UNIT * 0.34, 10),
    lambert(STEEL),
  );
  post.position.y = -UNIT * 0.14;
  group.add(post);

  const head = boxWithEdges(UNIT * 0.4, UNIT * 0.32, UNIT * 0.36, color);
  head.position.y = UNIT * 0.18;
  group.add(head);

  // Twin barrels, long enough to break the head's outline from every side.
  const barrelGeometry = new THREE.BoxGeometry(UNIT * 0.08, UNIT * 0.08, UNIT * 0.5);
  const barrelMaterial = lambert(DARK_STEEL);
  for (const side of [-1, 1]) {
    const barrel = new THREE.Mesh(barrelGeometry, barrelMaterial);
    barrel.position.set(side * UNIT * 0.1, UNIT * 0.16, UNIT * 0.4);
    group.add(barrel);
  }

  // Optic: the lit accent, and the thing that says which way it is looking.
  const eye = new THREE.Mesh(
    new THREE.BoxGeometry(UNIT * 0.2, UNIT * 0.07, UNIT * 0.03),
    glowLambert(shade(color, 1.5), 1, 1),
  );
  eye.position.set(0, UNIT * 0.27, UNIT * 0.17);
  group.add(eye);

  return group;
}

/**
 * A tesseract: a cube inside a cube, corner struts between them. A block that
 * is visibly more block than it has room for is the buff — the rig is about to
 * be bigger than it should be.
 */
function buildColossusBlock(color: number): THREE.Group {
  const group = new THREE.Group();
  const outer = UNIT * 0.66;
  const inner = UNIT * 0.33;
  const barSize = UNIT * 0.055;
  const half = outer / 2;

  // The outer cube as twelve bars, so it reads as a frame you can see into.
  const barMaterial = lambert(color);
  const alongX = new THREE.BoxGeometry(outer + barSize, barSize, barSize);
  const alongY = new THREE.BoxGeometry(barSize, outer + barSize, barSize);
  const alongZ = new THREE.BoxGeometry(barSize, barSize, outer + barSize);
  for (const a of [-1, 1]) {
    for (const b of [-1, 1]) {
      const x = new THREE.Mesh(alongX, barMaterial);
      x.position.set(0, a * half, b * half);
      group.add(x);
      const y = new THREE.Mesh(alongY, barMaterial);
      y.position.set(a * half, 0, b * half);
      group.add(y);
      const z = new THREE.Mesh(alongZ, barMaterial);
      z.position.set(a * half, b * half, 0);
      group.add(z);
    }
  }

  // The inner cube, lit, floating free inside the frame.
  const core = new THREE.Mesh(
    new THREE.BoxGeometry(inner, inner, inner),
    glowLambert(shade(color, 1.45), 1, 1),
  );
  group.add(core);
  group.add(edgesOf(core.geometry, 1, shade(color, 1.7)));

  // The eight struts joining the corners of one cube to the other — the part
  // of the drawing that says four dimensions rather than two boxes.
  const strutMaterial = lambert(shade(color, 0.6));
  const strutLength = Math.hypot(half - inner / 2, half - inner / 2, half - inner / 2) * 2;
  const strutGeometry = new THREE.BoxGeometry(
    barSize * 0.7,
    strutLength,
    barSize * 0.7,
  );
  const from = new THREE.Vector3();
  const to = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const strut = new THREE.Mesh(strutGeometry, strutMaterial);
        from.set((sx * inner) / 2, (sy * inner) / 2, (sz * inner) / 2);
        to.set(sx * half, sy * half, sz * half);
        strut.position.copy(from).add(to).multiplyScalar(0.5);
        strut.quaternion.setFromUnitVectors(
          up,
          to.clone().sub(from).normalize(),
        );
        strut.scale.y = to.distanceTo(from) / strutLength;
        group.add(strut);
      }
    }
  }

  return group;
}

/** A strapped salvage crate: a block off someone else's rig, boxed up. */
function buildSalvageCrate(color: number): THREE.Group {
  const group = new THREE.Group();
  const size = UNIT * 0.54;

  group.add(boxWithEdges(size, size, size, color));

  // Cargo straps over two axes.
  const strapMaterial = lambert(DARK_STEEL);
  const alongX = new THREE.BoxGeometry(size * 1.04, size * 0.16, size * 1.04);
  const alongZ = new THREE.BoxGeometry(size * 0.16, size * 1.04, size * 1.04);
  group.add(new THREE.Mesh(alongX, strapMaterial));
  group.add(new THREE.Mesh(alongZ, strapMaterial));

  // Corner blocks, and a lit stencil on the lid so it reads from above too.
  const cornerGeometry = new THREE.BoxGeometry(size * 0.18, size * 0.18, size * 0.18);
  const cornerMaterial = lambert(shade(color, 0.55));
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const corner = new THREE.Mesh(cornerGeometry, cornerMaterial);
      corner.position.set(sx * size * 0.46, size * 0.46, sz * size * 0.46);
      group.add(corner);
    }
  }
  const stencil = new THREE.Mesh(
    new THREE.BoxGeometry(size * 0.44, size * 0.02, size * 0.44),
    glowLambert(shade(color, 1.4), 1, 0.75),
  );
  stencil.position.y = size * 0.52;
  group.add(stencil);

  return group;
}

/**
 * The block a salvage crate is actually carrying, drawn as the part itself.
 *
 * A crate that shows the ram it holds is worth reading from across the arena in
 * a way that a generic box never is, so this borrows the Garage's own mesh for
 * the definition rather than inventing a stand-in. The result is re-centred on
 * its own bounds (part meshes are modelled at a cell centre) and scaled to the
 * same envelope as every other crate, so a wheel and a fuel drum hover at the
 * same size.
 *
 * The caller owns what comes back: unlike the six kind templates, this is built
 * per spawn and must be passed to `disposePickupModel` when it is replaced.
 */
export function buildSalvagePartModel(defId: string): THREE.Group | null {
  let mesh: THREE.Group;
  try {
    mesh = buildPartMesh(getPartDef(defId), {
      id: `salvage:${defId}`,
      defId,
      pos: { x: 0, y: 0, z: 0 },
      orient: 0,
      config: {},
    });
  } catch {
    return null;
  }
  mesh.name = '';

  const bounds = new THREE.Box3().setFromObject(mesh);
  if (bounds.isEmpty()) return null;
  const size = bounds.getSize(new THREE.Vector3());
  const centre = bounds.getCenter(new THREE.Vector3());
  const largest = Math.max(size.x, size.y, size.z);
  const scale = largest > 1e-4 ? (UNIT * 0.62) / largest : 1;

  // Two groups: the inner one re-centres the part, the outer one scales it, so
  // the slot can spin the result about its own middle.
  mesh.position.set(-centre.x, -centre.y, -centre.z);
  const holder = new THREE.Group();
  holder.scale.setScalar(scale);
  holder.add(mesh);
  const group = new THREE.Group();
  group.add(holder);
  return group;
}

/** Free a template's geometries and materials (clones own neither). */
export function disposePickupModel(model: THREE.Object3D): void {
  model.traverse((object) => {
    const mesh = object as Partial<THREE.Mesh> & Partial<THREE.LineSegments>;
    mesh.geometry?.dispose();
    const material = mesh.material;
    if (Array.isArray(material)) for (const entry of material) entry.dispose();
    else material?.dispose();
  });
}

const GLOW_TEXTURE_PX = 128;
const LABEL_TEXTURE_W = 256;
const LABEL_TEXTURE_H = 128;

/**
 * The soft pool of light a crate sits in. A radial falloff rather than a ring:
 * a drawn circle on the ground reads as a decal stuck to the terrain, and the
 * crate is meant to look lit, not stickered.
 */
export function createGroundGlowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = GLOW_TEXTURE_PX;
  canvas.height = GLOW_TEXTURE_PX;
  const context = canvas.getContext('2d');
  if (context !== null) {
    const half = GLOW_TEXTURE_PX / 2;
    const gradient = context.createRadialGradient(half, half, 0, half, half, half);
    gradient.addColorStop(0, 'rgba(255, 255, 255, 0.85)');
    gradient.addColorStop(0.45, 'rgba(255, 255, 255, 0.28)');
    gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, GLOW_TEXTURE_PX, GLOW_TEXTURE_PX);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * The crate's name over its head, with an arrow under the word pointing down at
 * the thing itself. Drawn in the kind's colour over a heavy dark outline so it
 * survives being read against pale sand and black asphalt alike.
 */
export function createLabelTexture(label: string, color: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = LABEL_TEXTURE_W;
  canvas.height = LABEL_TEXTURE_H;
  const context = canvas.getContext('2d');
  if (context !== null) {
    const centreX = LABEL_TEXTURE_W / 2;
    const textY = LABEL_TEXTURE_H * 0.36;
    // Salvage labels carry a part name, which can be much longer than "FUEL";
    // shrink the type until it fits rather than letting it run off the sprite.
    let fontPx = 54;
    context.font = `700 ${fontPx}px sans-serif`;
    while (fontPx > 22 && context.measureText(label).width > LABEL_TEXTURE_W - 24) {
      fontPx -= 3;
      context.font = `700 ${fontPx}px sans-serif`;
    }
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.lineJoin = 'round';
    context.lineWidth = 14;
    context.strokeStyle = 'rgba(6, 9, 12, 0.92)';
    context.strokeText(label, centreX, textY);
    context.fillStyle = color;
    context.fillText(label, centreX, textY);

    // Arrow: outlined the same way, so the pointer is as legible as the word.
    const tipY = LABEL_TEXTURE_H * 0.94;
    const topY = LABEL_TEXTURE_H * 0.62;
    const halfWidth = 22;
    context.beginPath();
    context.moveTo(centreX - halfWidth, topY);
    context.lineTo(centreX + halfWidth, topY);
    context.lineTo(centreX, tipY);
    context.closePath();
    context.lineWidth = 12;
    context.stroke();
    context.fillStyle = color;
    context.fill();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
