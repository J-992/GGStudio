import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';

const file = process.argv[2];
const yLo = Number(process.argv[3]);
const yHi = Number(process.argv[4]);
const binW = Number(process.argv[5] || 0.02);

await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(file);
const prim = doc.getRoot().listMeshes()[0].listPrimitives()[0];
const pos = prim.getAttribute('POSITION');
const node = doc.getRoot().listNodes()[0];
const [sx, sy, sz] = node.getScale();
const [tx, ty, tz] = node.getTranslation();

const xs = [];
for (let i = 0; i < pos.getCount(); i++) {
  const p = pos.getElement(i, [0, 0, 0]);
  const y = p[1] * sy + ty;
  if (y >= yLo && y < yHi) xs.push(p[0] * sx + tx);
}
console.log(`n=${xs.length} in y=[${yLo},${yHi})`);
const bins = new Map();
for (const x of xs) {
  const b = Math.round(x / binW) * binW;
  bins.set(b, (bins.get(b) || 0) + 1);
}
const keys = [...bins.keys()].sort((a, b) => a - b);
for (const k of keys) {
  console.log(`x=${k.toFixed(3).padStart(7)} ${'#'.repeat(bins.get(k))}`);
}
