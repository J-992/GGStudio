import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';

const file = process.argv[2];
const slab = Number(process.argv[3] || 0.05); // in world meters

await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(file);
const prim = doc.getRoot().listMeshes()[0].listPrimitives()[0];
const pos = prim.getAttribute('POSITION');
const node = doc.getRoot().listNodes()[0];
const [sx, sy, sz] = node.getScale();
const [tx, ty, tz] = node.getTranslation();

const pts = [];
for (let i = 0; i < pos.getCount(); i++) {
  const p = pos.getElement(i, [0, 0, 0]);
  pts.push([p[0] * sx + tx, p[1] * sy + ty, p[2] * sz + tz]);
}

let minY = Infinity, maxY = -Infinity;
for (const [, y] of pts) { minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
console.log(`world Y range: ${minY.toFixed(4)} .. ${maxY.toFixed(4)}  (height ${(maxY - minY).toFixed(4)})`);

// Bucket by Y slab, then within slab report X clusters (gap detection) and Z range.
const buckets = new Map();
for (const [x, y, z] of pts) {
  const b = Math.floor((y - minY) / slab);
  if (!buckets.has(b)) buckets.set(b, []);
  buckets.get(b).push([x, y, z]);
}
const keys = [...buckets.keys()].sort((a, b) => a - b);
for (const k of keys) {
  const rows = buckets.get(k);
  const ys = k * slab + minY;
  const xs = rows.map((r) => r[0]).sort((a, b) => a - b);
  const zs = rows.map((r) => r[2]);
  const xmin = xs[0], xmax = xs[xs.length - 1];
  const zmin = Math.min(...zs), zmax = Math.max(...zs);
  // gap detection: find largest gap in sorted xs
  let gap = 0, gapAt = null;
  for (let i = 1; i < xs.length; i++) {
    const d = xs[i] - xs[i - 1];
    if (d > gap) { gap = d; gapAt = (xs[i] + xs[i - 1]) / 2; }
  }
  const pct = (((ys - minY) / (maxY - minY)) * 100).toFixed(1);
  console.log(
    `y=${ys.toFixed(3)} (${pct}%) n=${rows.length.toString().padStart(4)} ` +
    `x=[${xmin.toFixed(3)}, ${xmax.toFixed(3)}] z=[${zmin.toFixed(3)}, ${zmax.toFixed(3)}] ` +
    `maxgapX=${gap.toFixed(3)}${gap > 0.03 ? ` @x=${gapAt.toFixed(3)}` : ''}`
  );
}
