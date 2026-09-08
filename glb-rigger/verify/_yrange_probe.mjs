import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';

const file = process.argv[2];
const xLo = Number(process.argv[3]);
const xHi = Number(process.argv[4]);

await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(file);
const prim = doc.getRoot().listMeshes()[0].listPrimitives()[0];
const pos = prim.getAttribute('POSITION');
const node = doc.getRoot().listNodes()[0];
const [sx, sy, sz] = node.getScale();
const [tx, ty, tz] = node.getTranslation();

let minY = Infinity, maxY = -Infinity, n = 0;
const ys = [];
for (let i = 0; i < pos.getCount(); i++) {
  const p = pos.getElement(i, [0, 0, 0]);
  const x = p[0] * sx + tx;
  const y = p[1] * sy + ty;
  if (x >= xLo && x < xHi) { minY = Math.min(minY, y); maxY = Math.max(maxY, y); n++; ys.push(y); }
}
console.log(`x in [${xLo},${xHi}): n=${n} y range [${minY.toFixed(4)}, ${maxY.toFixed(4)}]`);
// histogram of y in this x band
const binW = 0.03;
const bins = new Map();
for (const y of ys) {
  const b = Math.round(y / binW) * binW;
  bins.set(b, (bins.get(b) || 0) + 1);
}
const keys = [...bins.keys()].sort((a, b) => a - b);
for (const k of keys) console.log(`y=${k.toFixed(3).padStart(7)} ${'#'.repeat(bins.get(k))}`);
