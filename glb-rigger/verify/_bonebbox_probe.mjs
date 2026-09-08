// No Blender available in this environment, so this is a numeric stand-in for
// render_ortho.py: read the rigged (non-debug) output, walk the node hierarchy
// to get each bone's accumulated world transform, and print the WORLD-SPACE
// AABB of its geometry. A bone whose bbox strays outside its anatomical
// neighborhood (e.g. a "hand" bbox that reaches down to the floor) is the
// signature of a stray/torn triangle the same way an odd-colored blob would be
// in a debug-colors render.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

const file = process.argv[2];
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(file);

function worldMatrix(node) {
  const chain = [];
  for (let n = node; n; n = n.getParentNode()) chain.unshift(n);
  let m = null;
  for (const n of chain) {
    const [tx, ty, tz] = n.getTranslation();
    const [rx, ry, rz, rw] = n.getRotation();
    const [sx, sy, sz] = n.getScale();
    // quaternion -> matrix (assume no rotation set here, but handle anyway)
    const x2 = rx + rx, y2 = ry + ry, z2 = rz + rz;
    const xx = rx * x2, xy = rx * y2, xz = rx * z2;
    const yy = ry * y2, yz = ry * z2, zz = rz * z2;
    const wx = rw * x2, wy = rw * y2, wz = rw * z2;
    const rot = [
      1 - (yy + zz), xy + wz, xz - wy, 0,
      xy - wz, 1 - (xx + zz), yz + wx, 0,
      xz + wy, yz - wx, 1 - (xx + yy), 0,
      0, 0, 0, 1,
    ];
    // scale then rotate then translate, column-major glTF style
    const local = [
      rot[0] * sx, rot[1] * sx, rot[2] * sx, 0,
      rot[4] * sy, rot[5] * sy, rot[6] * sy, 0,
      rot[8] * sz, rot[9] * sz, rot[10] * sz, 0,
      tx, ty, tz, 1,
    ];
    m = m ? multiply(m, local) : local;
  }
  return m;
}

function multiply(a, b) {
  const out = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[k * 4 + r] * b[c * 4 + k];
      out[c * 4 + r] = sum;
    }
  }
  return out;
}

function apply(m, p) {
  const [x, y, z] = p;
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
  ];
}

for (const node of doc.getRoot().listNodes()) {
  const mesh = node.getMesh();
  if (!mesh) continue;
  const m = worldMatrix(node);
  let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  let count = 0;
  for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute('POSITION');
    for (let i = 0; i < pos.getCount(); i++) {
      const wp = apply(m, pos.getElement(i, [0, 0, 0]));
      for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], wp[k]); max[k] = Math.max(max[k], wp[k]); }
      count++;
    }
  }
  if (count === 0) { console.log(`${node.getName().padEnd(12)} EMPTY`); continue; }
  console.log(
    `${node.getName().padEnd(12)} n=${count.toString().padStart(4)} ` +
    `x=[${min[0].toFixed(3)}, ${max[0].toFixed(3)}] ` +
    `y=[${min[1].toFixed(3)}, ${max[1].toFixed(3)}] ` +
    `z=[${min[2].toFixed(3)}, ${max[2].toFixed(3)}]`
  );
}
