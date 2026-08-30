/**
 * Draw-call attribution.
 *
 *   npm run build
 *   node node_modules/vite/bin/vite.js preview --port 4173 --host 127.0.0.1
 *   node scripts/playtest/prof-draws.mjs
 *
 * `profile.mjs` next door reports *how many* draw calls a frame costs. This
 * reports *which objects they are*, by wrapping `WebGLRenderer.renderBufferDirect`
 * - the one function every submission goes through - and tallying each call
 * against the submitting object's scene path, material and world scale.
 *
 * That distinction is the whole reason this exists. The count alone said the
 * endless track cost ~1,100 draw calls a frame at ~13k triangles, which is
 * plainly wrong but says nothing about where to look. The attribution said
 * "530 of them are white window-textured boxes at scale 14x45", which is one
 * grep away from `Buildings.buildingMaterials` handing every skyline box a
 * six-entry material array on a six-group `BoxGeometry`.
 *
 * Read the output as calls-per-frame: divide each row by
 * `tallied / calls last frame`.
 */

import { launchChrome, CdpConnection, evaluate, sleep } from './cdp.mjs';
const TARGET = process.argv[2] || 'http://127.0.0.1:4173/';
const HOOK = `(() => {
  const g = window.window.__game, r = g.renderer;
  const orig = r.renderBufferDirect.bind(r);
  window.__tally = {};
  window.__frames = 0;
  r.renderBufferDirect = function (camera, scene, geometry, material, object, group) {
    const t = window.__tally;
    const chain = []; let p = object;
    while (p && p !== g.scene) { chain.push(p.name || p.type); p = p.parent; }
    object.getWorldScale(window.__sv = window.__sv || new window.__three.Vector3());
    const sc = window.__sv.toArray().map(n=>n.toFixed(1)).join('x');
    const key = chain.reverse().join('/') + ' | ' + (material?.type||'?') + ':' + (material?.color?.getHexString?.()||'') + (material?.map?'+map':'') + ' | ' + (geometry?.type||'?') + ' | scale ' + sc;
    t[key] = (t[key]||0)+1;
    return orig(camera, scene, geometry, material, object, group);
  };
  return 'hooked';
})()`;
const READ = `(() => { const e = Object.entries(window.__tally).sort((a,b)=>b[1]-a[1]); const tot=e.reduce((a,b)=>a+b[1],0); return { tot, top: e.slice(0,25) }; })()`;
const chrome = await launchChrome({ headless: true });
const cdp = await CdpConnection.connect(chrome.wsUrl);
const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
const { sessionId: s } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
await cdp.send('Runtime.enable', {}, s); await cdp.send('Page.enable', {}, s);
await cdp.send('Page.navigate', { url: TARGET }, s);
let booted=false; for(let i=0;i<120&&!booted;i++){await sleep(500); booted=await evaluate(cdp,s,'!!window.__game').catch(()=>false);}
await evaluate(cdp, s, 'window.__game.startEndless()');
await sleep(20000);
console.log(await evaluate(cdp, s, HOOK));
await evaluate(cdp, s, 'window.__tally={}');
await sleep(1500);
const frames = await evaluate(cdp, s, 'window.__game.renderer.info.render.calls');
const r = await evaluate(cdp, s, READ);
console.log('calls last frame:', frames, ' tallied over ~1.5s:', r.tot);
for (const [k,v] of r.top) console.log(String(v).padStart(6), k);
cdp.close(); chrome.close(); process.exit(0);
