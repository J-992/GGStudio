import {chromium} from 'playwright-core';
import {spawn} from 'node:child_process';
import {mkdirSync,readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const root=new URL('..',import.meta.url).pathname,shots=new URL('./shots/',import.meta.url).pathname;
mkdirSync(shots,{recursive:true});const routes=JSON.parse(readFileSync(new URL('./.qa/routes.json',import.meta.url),'utf8'));
const server=spawn('node',['node_modules/vite/bin/vite.js','--config','squish/vite.config.ts','--port','5197','--strictPort'],{cwd:root,stdio:'pipe'});
let browser;let count=0;const errors=[];
function check(name,value){assert.ok(value,name);console.log('PASS',name);count++;}
async function pageFor(index=0,mobile=false){
  const page=await browser.newPage(mobile?{viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true}:{viewport:{width:1440,height:900}});
  page.on('pageerror',e=>errors.push(e.message));
  if(!mobile){await page.clock.install({time:new Date('2026-09-04T12:00:00Z')});await page.clock.pauseAt(new Date('2026-09-04T12:00:10Z'));await page.addInitScript(()=>{window.requestAnimationFrame=cb=>window.setTimeout(()=>cb(performance.now()),10);window.cancelAnimationFrame=clearTimeout;});}
  await page.addInitScript(i=>{localStorage.setItem('squish-adventure-v2',JSON.stringify({unlocked:23,current:i,bank:210,stars:[],rescues:[]}));},index);
  await page.goto('http://127.0.0.1:5197/?poki=mock');await page.waitForFunction(()=>window.__SQUISH__&&window.__POKI_EVENTS__?.length>=3);if(!mobile)await page.clock.runFor(100);return page;
}
try{
  await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('Server timeout')),15000);server.stdout.on('data',d=>{if(d.toString().includes('Local:')){clearTimeout(t);resolve();}});server.stderr.on('data',d=>process.stderr.write(d));server.on('exit',code=>reject(Error('Server exited '+code)));});
  browser=await chromium.launch({channel:'chrome',headless:true});
  const page=await pageFor();const snap=()=>page.evaluate(()=>window.__SQUISH__.snapshot());
  check('opens directly inside level one',(await snap()).state==='ready'&&await page.locator('#intro').isHidden());
  check('SDK does not start gameplay on load',await page.evaluate(()=>window.__POKI_EVENTS__.join(',')==='init,loadingStart,loadingFinished'));
  await page.screenshot({path:shots+'adventure-01-opening.png'});
  await page.keyboard.down('Space');await page.clock.runFor(350);
  check('first key starts, squishes, and charges',(await snap()).held&&(await snap()).charge>.5&&(await snap()).state==='playing');
  await page.keyboard.up('Space');await page.clock.runFor(150);check('release jumps',(await snap()).y < -40);
  await page.keyboard.down('Space');await page.clock.runFor(80);check('air press triggers pancake dive',(await snap()).diving&&(await snap()).vy>0);
  await page.keyboard.up('Space');await page.keyboard.press('Escape');const frozen=(await snap()).x;await page.clock.runFor(500);check('pause freezes movement',(await snap()).state==='paused'&&(await snap()).x===frozen);
  check('music stops on pause',!(await snap()).music.playing);
  await page.getByRole('button',{name:'♫ Music: on',exact:true}).click();check('music can be muted independently',(await snap()).save.musicMuted);
  await page.getByRole('button',{name:'♫ Music: off',exact:true}).click();
  await page.keyboard.press('Escape');await page.clock.runFor(30);check('music resumes with gameplay',(await snap()).music.playing&&(await snap()).music.initialized);
  await page.keyboard.press('KeyM');check('mute persists',JSON.parse(await page.evaluate(()=>localStorage.getItem('squish-adventure-v2'))).muted);
  await page.close();
  // Solved input sequences are replayed through real keyboard events in Chrome.
  for(const i of [0,2,3,4,6,7,8,13,15,16,17,23]){
    const route=routes.find(r=>r.index===i);check('solver found level '+(i+1),route&&!route.failed);
    const p=await pageFor(i);await p.click('#begin');let down=false,done=false;
    let checkpointVerified=false;
    for(let step=0;step<route.path.length+3;step++){
      const state=await p.evaluate(()=>window.__SQUISH__.snapshot());
      if(state.index!==i||state.state==='won'){done=true;break;}
      if(state.state==='dead')throw Error('Browser route failed level '+(i+1)+' at '+state.x+', '+state.y+' t='+state.time);
      const want=route.path[Math.min(step,route.path.length-1)];if(want!==down){await p.keyboard[want?'down':'up']('Space');down=want;}
      await p.clock.runFor(100);
      if(i===2&&!checkpointVerified&&state.checkpoint.x>130){check('checkpoint records a safe restart',state.checkpoint.x>130&&state.checkpoint.sweets>=0);checkpointVerified=true;}
      if(step===45&&[2,4,6,8,13,16,17].includes(i))await p.screenshot({path:shots+'adventure-level-'+String(i+1).padStart(2,'0')+'.png'});
      if(i===7&&step===55)await p.screenshot({path:shots+'adventure-boss.png'});
      if(i>=2){if(step===30)check('no tutorial prompts in level '+(i+1),await p.locator('#hint').textContent()==='');}
    }
    if(!done){const s=await p.evaluate(()=>window.__SQUISH__.snapshot());done=s.index!==i||s.state==='won';}
    check('real controls complete level '+(i+1),done);
    if(down)await p.keyboard.up('Space');await p.clock.runFor(550);
    check('level '+(i+1)+' reward saved',await p.evaluate(i=>window.__SQUISH__.snapshot().save.stars[i]>0,i));
    await p.close();
  }
  const recovery=await pageFor(2);await recovery.click('#begin');let held=false;
  for(const down of routes.find(r=>r.index===2).path){if(down!==held){await recovery.keyboard[down?'down':'up']('Space');held=down;}await recovery.clock.runFor(100);const s=await recovery.evaluate(()=>window.__SQUISH__.snapshot());if(s.checkpoint.x>130){if(held)await recovery.keyboard.up('Space');const cp=s.checkpoint;await recovery.keyboard.press('KeyR');const restored=await recovery.evaluate(()=>window.__SQUISH__.snapshot());check('R restores checkpoint position and sweets',restored.index===2&&Math.abs(restored.x-cp.x)<5&&restored.sweets===cp.sweets);break;}}
  await recovery.close();
  const migrated=await browser.newPage();await migrated.addInitScript(()=>localStorage.setItem('squish-v1',JSON.stringify({unlocked:12,bank:70,skin:2})));
  await migrated.goto('http://127.0.0.1:5197/?poki=mock');await migrated.waitForFunction(()=>window.__SQUISH__);
  check('old flavors migrate while new adventure starts at level one',await migrated.evaluate(()=>{const s=window.__SQUISH__.snapshot();return s.index===0&&s.save.bank===70&&s.save.skin===2&&JSON.parse(localStorage.getItem('squish-v1')).unlocked===12;}));await migrated.close();
  const mobile=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});mobile.on('pageerror',e=>errors.push(e.message));
  await mobile.addInitScript(()=>{Object.defineProperty(window,'localStorage',{get(){throw new DOMException('Storage disabled','SecurityError');}});});
  await mobile.goto('http://127.0.0.1:5197/?poki=mock');await mobile.waitForFunction(()=>window.__SQUISH__);await mobile.screenshot({path:shots+'adventure-mobile.png'});
  const cdp=await mobile.context().newCDPSession(mobile);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:160,y:610}]});await mobile.waitForTimeout(350);
  check('touch starts and holds with storage disabled',await mobile.evaluate(()=>window.__SQUISH__.snapshot().held));
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await mobile.waitForTimeout(150);check('touch release jumps',await mobile.evaluate(()=>window.__SQUISH__.snapshot().y < -30));
  await mobile.setViewportSize({width:844,height:390});await mobile.screenshot({path:shots+'adventure-landscape.png'});check('canvas fills rotated phone',await mobile.evaluate(()=>document.querySelector('canvas').getBoundingClientRect().width===innerWidth));
  check('no browser runtime errors',errors.length===0);console.log(count+' checks passed.');
}finally{await browser?.close();server.kill();}
