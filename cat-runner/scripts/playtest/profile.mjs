/**
 * Render-cost profiler for Rooftop Rascal.
 *
 *   npm run build && npm run preview     # in one terminal
 *   npm run profile                      # in another
 *
 * Boots the built game over CDP, loads each level, and reports what the frame
 * actually costs: draw calls, triangles submitted, resident GPU resources, and
 * how many of those meshes are being drawn a second time into the shadow map.
 *
 * WHY THESE NUMBERS AND NOT FPS
 * -----------------------------
 * The harness runs on SwiftShader, a software rasteriser, so the frame rate it
 * measures says more about this machine's CPU than about the game - the same
 * build has been observed anywhere from a few fps to a fraction of one. Draw
 * calls and triangle counts, on the other hand, are exactly what the real GPU
 * would be handed. They are hardware-independent, they are what a budget is
 * written against, and they are what a regression shows up in first. FPS is
 * reported too, but only as a coarse relative signal between runs on the same
 * machine.
 *
 * `--json <path>` writes the raw sample so two runs can be diffed.
 */

import { launchChrome, CdpConnection, evaluate, sleep } from './cdp.mjs';
import { writeFileSync } from 'node:fs';

const TARGET = process.argv[2]?.startsWith('http') ? process.argv[2] : 'http://localhost:4173/';
const jsonFlag = process.argv.indexOf('--json');
const JSON_OUT = jsonFlag >= 0 ? process.argv[jsonFlag + 1] : null;

/** Frame stats have to be read after a render, and rAF is the only witness. */
const SAMPLE_SCRIPT = `(() => new Promise((resolve) => {
  const g = window.__game;
  requestAnimationFrame(() => {
    const r = g.renderer.info.render;
    const m = g.renderer.info.memory;

    // Walk the live scene rather than trusting the level definition: what
    // costs a frame is what is actually parented and visible, which includes
    // everything the obstacle factory and the facade builder added on their
    // own account.
    let meshes = 0, visibleMeshes = 0, shadowCasters = 0, instanced = 0, instances = 0;
    let sceneTriangles = 0;
    g.scene.traverse((o) => {
      if (!o.isMesh && !o.isInstancedMesh) return;
      meshes++;
      if (o.visible) visibleMeshes++;
      if (o.castShadow) shadowCasters++;

      const index = o.geometry?.index;
      const pos = o.geometry?.getAttribute?.('position');
      const tris = index ? index.count / 3 : pos ? pos.count / 3 : 0;
      if (o.isInstancedMesh) {
        instanced++;
        instances += o.count;
        sceneTriangles += tris * o.count;
      } else {
        sceneTriangles += tris;
      }
    });

    resolve({
      calls: r.calls,
      triangles: r.triangles,
      geometries: m.geometries,
      textures: m.textures,
      programs: g.renderer.info.programs?.length ?? 0,
      meshes, visibleMeshes, shadowCasters,
      instancedMeshes: instanced, instanceCount: instances,
      sceneTriangles: Math.round(sceneTriangles),
      colliders: g.physics.world.colliders.len(),
      bodies: g.physics.world.bodies.len(),
      shadowMapEnabled: g.renderer.shadowMap.enabled,
      pixelRatio: g.renderer.getPixelRatio(),
    });
  });
}))()`;

/** Frames actually delivered over `ms`, via rAF. */
const fpsScript = (ms) => `(() => new Promise((resolve) => {
  let n = 0;
  const t0 = performance.now();
  const tick = () => {
    n++;
    if (performance.now() - t0 >= ${ms}) resolve(+(n / ((performance.now() - t0) / 1000)).toFixed(2));
    else requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}))()`;

const chrome = await launchChrome({ headless: true });
const cdp = await CdpConnection.connect(chrome.wsUrl);
const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
const { sessionId: session } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });

await cdp.send('Runtime.enable', {}, session);
await cdp.send('Page.enable', {}, session);
await cdp.send('Page.navigate', { url: TARGET }, session);

let booted = false;
for (let i = 0; i < 120 && !booted; i++) {
  await sleep(500);
  booted = await evaluate(cdp, session, `!!window.__game`).catch(() => false);
}
if (!booted) {
  console.error('ABORT: game never booted at ' + TARGET);
  chrome.close();
  process.exit(1);
}

const rows = [];
for (const index of [1, 2, 3]) {
  await evaluate(cdp, session, `window.__game.startLevel(${index})`);
  await sleep(3000);
  const sample = await evaluate(cdp, session, SAMPLE_SCRIPT);
  const fps = await evaluate(cdp, session, fpsScript(4000));
  rows.push({ level: index, fps, ...sample });
}

const pad = (v, w) => String(v).padStart(w);
const fmt = (n) => (n >= 1000 ? n.toLocaleString('en-US') : String(n));

console.log('\n=== RENDER COST PER LEVEL ===\n');
console.log('  level   calls   triangles   scene tris    meshes  shadowcast   instances   colliders     fps');
console.log('  ' + '-'.repeat(96));
for (const r of rows) {
  console.log(
    `  ${pad(r.level, 5)}   ${pad(fmt(r.calls), 5)}   ${pad(fmt(r.triangles), 9)}   ${pad(fmt(r.sceneTriangles), 10)}` +
    `   ${pad(r.meshes, 7)}   ${pad(r.shadowCasters, 10)}   ${pad(fmt(r.instanceCount), 9)}   ${pad(r.colliders, 9)}   ${pad(r.fps, 5)}`,
  );
}

const first = rows[0];
console.log(
  `\n  resident: ${first.geometries} geometries, ${first.textures} textures, ` +
  `${first.programs} shader programs | shadowMap=${first.shadowMapEnabled} dpr=${first.pixelRatio}`,
);
console.log('  (fps is SwiftShader software rasterisation - relative signal only)\n');

if (JSON_OUT) {
  writeFileSync(JSON_OUT, JSON.stringify(rows, null, 2));
  console.log(`  wrote ${JSON_OUT}\n`);
}

cdp.close();
chrome.close();
process.exit(0);
