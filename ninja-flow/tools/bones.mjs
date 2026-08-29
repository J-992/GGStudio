import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
for (const f of process.argv.slice(2)) {
  const doc = await io.read(f);
  const root = doc.getRoot();
  const names = root.listNodes().map(n=>n.getName());
  const skins = root.listSkins().map(s=>({joints:s.listJoints().length}));
  console.log('==', f.split('/').pop());
  console.log('nodes', names.length, 'skins', JSON.stringify(skins));
  console.log(names.join(','));
  // scales
  for (const n of root.listNodes()) { const s=n.getScale(), t=n.getTranslation(); if (Math.abs(s[0]-1)>1e-6) console.log('SCALE', n.getName(), s, t); }
}
