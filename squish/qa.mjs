import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
const root=new URL('..',import.meta.url).pathname;
const shots=new URL('./shots/',import.meta.url).pathname;
mkdirSync(shots,{recursive:true});
const server=spawn('node',['node_modules/vite/bin/vite.js','--config','squish/vite.config.ts','--port','5175','--strictPort'],{cwd:root,stdio:'pipe'});
let browser;
const results=[];
function check(name,condition){assert.ok(condition,name);results.push(name);console.log('PASS',name);}
try{
  await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('Server timeout')),15000);server.stdout.on('data',d=>{if(d.toString().includes('Local:')){clearTimeout(t);resolve();}});server.stderr.on('data',d=>process.stderr.write(d));server.on('exit',code=>reject(Error(`Server exited: ${code}`)));});
  browser=await chromium.launch({channel:'chrome',headless:true});
  const page=await browser.newPage({viewport:{width:1440,height:900}});
  await page.clock.install();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:5175/?poki=mock');
  await page.waitForFunction(()=>window.__SQUISH__&&window.__POKI_EVENTS__?.length>=3);
  await page.screenshot({path:shots+'01-title-desktop.png'});
  check('title and SDK loading lifecycle',await page.evaluate(()=>window.__POKI_EVENTS__.join(',')==='init,loadingStart,loadingFinished'));
  const snapshot=()=>page.evaluate(()=>window.__SQUISH__.snapshot());
  await page.click('#play');
  await page.keyboard.down('Space');await page.clock.runFor(250);
  check('Space squishes and charges after clicking play',(await snapshot()).charge>.3&&(await snapshot()).held);
  await page.keyboard.up('Space');await page.clock.runFor(120);
  check('release launches jelly',(await snapshot()).y < -20);
  await page.keyboard.press('Escape');const paused=await snapshot();await page.clock.runFor(700);
  check('pause freezes simulation',(await snapshot()).x===paused.x&&paused.state==='paused');
  await page.keyboard.press('Escape');await page.clock.runFor(20);
  check('resume returns to play',(await snapshot()).state==='playing');
  await page.keyboard.press('KeyR');
  await page.clock.runFor(2600);
  check('unflattened jelly collides with gate',(await snapshot()).state==='dead');
  await page.screenshot({path:shots+'02-failure.png'});
  await page.keyboard.press('KeyR');
  check('restart retains current level',(await snapshot()).index===0&&(await snapshot()).state==='playing');
  // Drive every course with real button input. The only game hook is read-only.
  async function playCourse(){
    let down=false;
    for(let frame=0;frame<3500;frame++){
      const s=await snapshot();
      if(s.state==='dead')throw Error(`Bot died on ${s.index+1} at x=${s.x.toFixed(1)}: ${JSON.stringify(s.level.obstacles)}`);
      if(s.state==='won'){if(down)await page.keyboard.up('Space');return s;}
      const next=s.level.obstacles.find(o=>!o.cleared&&o.x+o.w+34>s.x);
      let want=false;
      if(next){
        if(next.kind==='gate')want=s.x>next.x-190&&s.x<next.x+next.w+34;
        else want=s.x>next.x-230 && s.x<next.x-(next.kind==='gap'?34:48);
      }
      if(want!==down){await page.keyboard[want?'down':'up']('Space');down=want;}
      await page.clock.runFor(33);
      if(s.index===3&&!s.daily&&s.held&&next?.kind==='gate'&&s.x>next.x+45&&s.x<next.x+54)await page.screenshot({path:shots+'08-squish-action.png'});
    }
    throw Error('Course timeout');
  }
  for(let level=0;level<18;level++){
    const won=await playCourse();check(`level ${level+1} can be completed through real controls`,won.state==='won');
    await page.clock.runFor(800);
    if(level===0)await page.screenshot({path:shots+'03-victory.png'});
    if(level<17)await page.click('#modal-primary');
  }
  check('all campaign progress saved',(await snapshot()).save.unlocked===17&&(await snapshot()).save.stars.filter(Boolean).length===18);
  await page.click('#home',{force:true}).catch(()=>{});
  await page.keyboard.press('Escape');
  await page.reload();await page.waitForFunction(()=>window.__SQUISH__);
  check('progress persists across reload',(await snapshot()).save.unlocked===17);
  await page.click('#wardrobe');await page.locator('.skin-grid button').nth(1).click();
  check('earned cosmetic equips',(await snapshot()).save.skin===1);
  await page.click('#modal-primary');
  await page.click('#daily');
  const dailyLayout=JSON.stringify((await snapshot()).level.obstacles);
  await page.clock.runFor(400);await page.screenshot({path:shots+'04-gameplay-desktop.png'});
  await page.keyboard.press('KeyR');
  check('daily course is deterministic',JSON.stringify((await snapshot()).level.obstacles)===dailyLayout);
  const dailyWon=await playCourse();check('daily challenge can be completed',dailyWon.state==='won');
  await page.clock.runFor(800);
  check('daily personal best is saved',Object.keys((await snapshot()).save.daily).length===1);
  check('SDK stops gameplay on completion',await page.evaluate(()=>window.__POKI_EVENTS__.filter(e=>e==='gameplayStart'||e==='gameplayStop').at(-1)==='gameplayStop'));
  const mobile=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
  mobile.on('pageerror',e=>errors.push(e.message));
  await mobile.addInitScript(()=>{Object.defineProperty(window,'localStorage',{get(){throw new DOMException('Storage disabled','SecurityError');}});});
  await mobile.goto('http://127.0.0.1:5175/?poki=mock');await mobile.waitForFunction(()=>window.__SQUISH__);
  await mobile.screenshot({path:shots+'05-title-mobile.png'});
  await mobile.setViewportSize({width:375,height:667});await mobile.screenshot({path:shots+'05b-title-small-mobile.png'});
  await mobile.setViewportSize({width:390,height:844});
  // CDP sends actual touch events, including a sustained contact.
  await mobile.tap('#play');
  const cdp=await mobile.context().newCDPSession(mobile);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:170,y:580}]});
  await mobile.waitForTimeout(350);
  check('touch hold works with storage disabled',await mobile.evaluate(()=>window.__SQUISH__.snapshot().held&&window.__SQUISH__.snapshot().charge>.3));
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await mobile.waitForTimeout(110);
  check('touch release jumps',await mobile.evaluate(()=>window.__SQUISH__.snapshot().y < -20));
  await mobile.screenshot({path:shots+'06-gameplay-mobile.png'});
  await mobile.setViewportSize({width:844,height:390});
  await mobile.waitForTimeout(100);await mobile.screenshot({path:shots+'07-landscape-mobile.png'});
  check('responsive canvas covers viewport',await mobile.evaluate(()=>{const r=document.querySelector('canvas').getBoundingClientRect();return r.width===innerWidth&&r.height===innerHeight;}));
  const late=await browser.newPage();late.on('pageerror',e=>errors.push(e.message));
  await late.addInitScript(()=>{
    window.__lateEvents=[];
    window.PokiSDK={init:()=>new Promise(resolve=>{window.__releasePoki=resolve;}),gameLoadingStart:()=>window.__lateEvents.push('loadingStart'),gameLoadingFinished:()=>window.__lateEvents.push('loadingFinished'),gameplayStart:()=>window.__lateEvents.push('gameplayStart'),gameplayStop:()=>window.__lateEvents.push('gameplayStop')};
  });
  await late.goto('http://127.0.0.1:5175/');await late.click('#play');
  check('game remains playable during SDK initialization',await late.evaluate(()=>window.__SQUISH__.snapshot().state==='playing'&&window.__lateEvents.length===0));
  await late.evaluate(()=>window.__releasePoki());await late.waitForFunction(()=>window.__lateEvents.length>=3);
  check('late SDK receives loading then active gameplay lifecycle',await late.evaluate(()=>window.__lateEvents.join(',')==='loadingStart,loadingFinished,gameplayStart'));
  check('no browser runtime errors',errors.length===0);
  console.log(`\n${results.length} checks passed. Screenshots: ${shots}`);
}finally{await browser?.close();server.kill();}
