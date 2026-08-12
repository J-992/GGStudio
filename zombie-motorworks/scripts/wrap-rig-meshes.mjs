/**
 * Move every mesh off its named bone onto an unnamed child wrapper.
 *
 * `gltf-transform quantize` has to park a dequantization transform somewhere.
 * On a bone that already has children it inserts a wrapper and leaves the bone
 * alone; on a leaf bone it bakes the transform into the bone itself, which
 * silently moves that bone's pivot. The rigs are posed by assigning Euler
 * angles to bones looked up by name, so a moved pivot swings the limb around
 * the wrong point — arms, head and feet are all leaves.
 *
 * Running this first gives every mesh a wrapper of its own, so quantization has
 * nowhere to touch a bone. That is the shape the already-shipping rigs are in:
 * 13 named bones carrying no mesh, 13 unnamed wrappers carrying one each.
 *
 * Usage: `node scripts/wrap-rig-meshes.mjs in.glb out.glb`
 */
import { readFileSync, writeFileSync } from 'node:fs';

const GLB_MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

function readGlb(path) {
  const buf = readFileSync(path);
  if (buf.readUInt32LE(0) !== GLB_MAGIC) throw new Error(`not a GLB: ${path}`);
  const total = buf.readUInt32LE(8);
  let offset = 12;
  let json = null;
  let bin = null;
  while (offset + 8 <= total) {
    const length = buf.readUInt32LE(offset);
    const type = buf.readUInt32LE(offset + 4);
    const body = buf.subarray(offset + 8, offset + 8 + length);
    if (type === CHUNK_JSON) json = JSON.parse(body.toString('utf8'));
    else if (type === CHUNK_BIN) bin = Buffer.from(body);
    offset += 8 + length + ((4 - (length % 4)) % 4);
  }
  if (json === null) throw new Error(`no JSON chunk: ${path}`);
  return { json, bin };
}

function writeGlb(path, json, bin) {
  const pad = (buf, filler) => {
    const rem = (4 - (buf.length % 4)) % 4;
    return rem === 0 ? buf : Buffer.concat([buf, Buffer.alloc(rem, filler)]);
  };
  const jsonChunk = pad(Buffer.from(JSON.stringify(json), 'utf8'), 0x20);
  const binChunk = bin ? pad(bin, 0x00) : null;

  const header = (length, type) => {
    const head = Buffer.alloc(8);
    head.writeUInt32LE(length, 0);
    head.writeUInt32LE(type, 4);
    return head;
  };

  const parts = [header(jsonChunk.length, CHUNK_JSON), jsonChunk];
  if (binChunk !== null) parts.push(header(binChunk.length, CHUNK_BIN), binChunk);

  const body = Buffer.concat(parts);
  const top = Buffer.alloc(12);
  top.writeUInt32LE(GLB_MAGIC, 0);
  top.writeUInt32LE(2, 4);
  top.writeUInt32LE(12 + body.length, 8);
  writeFileSync(path, Buffer.concat([top, body]));
}

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error('usage: node scripts/wrap-rig-meshes.mjs in.glb out.glb');
  process.exit(1);
}

const { json, bin } = readGlb(input);
const nodes = json.nodes ?? [];
let wrapped = 0;

// Snapshot the length first: the wrappers appended below carry no mesh of their
// own, and re-visiting them would wrap the wrappers.
const originalCount = nodes.length;
for (let index = 0; index < originalCount; index++) {
  const node = nodes[index];
  if (node.mesh === undefined) continue;
  const wrapper = { mesh: node.mesh };
  if (node.skin !== undefined) {
    wrapper.skin = node.skin;
    delete node.skin;
  }
  delete node.mesh;
  nodes.push(wrapper);
  node.children = [...(node.children ?? []), nodes.length - 1];
  wrapped++;
}

writeGlb(output, json, bin);
console.log(
  `${input} -> ${output}: wrapped ${wrapped} mesh node(s), ${originalCount} -> ${nodes.length} nodes`,
);
