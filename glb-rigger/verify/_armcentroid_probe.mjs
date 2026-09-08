import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';

const file = process.argv[2];
const xLo = Number(process.argv[3]);
const xHi = Number(process.argv[4]);
const slab = Number(process.argv[5] || 0.05);

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
  const x = p[0] * sx + tx, y = p[1] * sy + ty, z = p[2] * sz + tz;
  if (x >= xLo && x < xHi) pts.push([x, y, z]);
}
const buckets = new Map();
for (const [x, y, z] of pts) {
  const b = Math.floor(y / slab);
  if (!buckets.has(b)) buckets.set(b, []);
  buckets.get(b).push([x, y, z]);
}
const keys = [...buckets.keys()].sort((a, b) => a - b);
for (const k of keys) {
  const rows = buckets.get(k);
  const y = k * slab;
  const cx = rows.reduce((s, r) => s + r[0], 0) / rows.length;
  const cz = rows.reduce((s, r) => s + r[2], 0) / rows.length;
  const xr = [Math.min(...rows.map(r=>r[0])), Math.max(...rows.map(r=>r[0]))];
  const zr = [Math.min(...rows.map(r=>r[2])), Math.max(...rows.map(r=>r[2]))];
  console.log(`y=${y.toFixed(3)} n=${rows.length.toString().padStart(3)} centroid=(x${cx.toFixed(3)}, z${cz.toFixed(3)}) xr=[${xr[0].toFixed(3)},${xr[1].toFixed(3)}] zr=[${zr[0].toFixed(3)},${zr[1].toFixed(3)}]`);
}
