import {chromium} from 'playwright-core';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
mkdirSync(new URL('./shots/',import.meta.url),{recursive:true});
const server=spawn('node',['node_modules/vite/bin/vite.js','--config','squish/vite.config.ts','--port','5201','--strictPort'],{stdio:'pipe'});
let browser;
try{
  await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('Server timeout')),15000);server.stdout.on('data',d=>{if(d.toString().includes('Local:')){clearTimeout(t);resolve();}});server.on('exit',()=>reject(Error('Server exited')));});
  browser=await chromium.launch({channel:'chrome',headless:true});
  for(const viewport of [{width:320,height:568},{width:390,height:844},{width:844,height:390},{width:1440,height:900}]){
    const page=await browser.newPage({viewport});
    await page.clock.install({time:new Date('2026-09-04T12:00:00Z')});await page.clock.pauseAt(new Date('2026-09-04T12:00:10Z'));
    await page.addInitScript(()=>{window.drawnText=[];const original=CanvasRenderingContext2D.prototype.fillText;CanvasRenderingContext2D.prototype.fillText=function(text,...args){window.drawnText.push(text);return original.call(this,text,...args);};});
    await page.goto('http://127.0.0.1:5201/?poki=mock');await page.waitForFunction(()=>window.__SQUISH__);await page.clock.runFor(100);
    assert.equal(await page.evaluate(()=>window.drawnText.some(t=>/HOLD|RELEASE/.test(t))),false,'tutorial must not also be painted into the world');
    async function bounds(ids){
      const problems=await page.evaluate(ids=>{const errors=[];const rects=ids.map(id=>{const e=document.getElementById(id);const r=e.getBoundingClientRect();if(r.width===0||r.height===0||!e.textContent.trim())return null;if(r.left<0||r.right>innerWidth+1||r.top<0||r.bottom>innerHeight+1||e.scrollWidth>e.clientWidth+1)errors.push(id+' overflows');return {id,left:r.left,right:r.right,top:r.top,bottom:r.bottom};}).filter(Boolean);for(let i=0;i<rects.length;i++)for(let j=i+1;j<rects.length;j++){const a=rects[i],b=rects[j];if(a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top)errors.push(a.id+' overlaps '+b.id);}return errors;},ids);
      assert.deepEqual(problems,[],JSON.stringify(viewport));
    }
    await bounds(['home','level-info','hearts','score','sound','pause','ready','bottom']);
    await bounds(['ready-title','ready-copy','begin']);
    await page.screenshot({path:new URL('./shots/layout-ready-'+viewport.width+'.png',import.meta.url).pathname});
    // Stress the real notification layout with the longest simultaneous status strings.
    await page.evaluate(()=>{document.body.dataset.state='playing';document.getElementById('ready').classList.add('hidden');document.getElementById('messages').classList.remove('hidden');document.getElementById('boss-hud').classList.remove('hidden');for(const [id,text] of Object.entries({'level-name':'23 / THROUGH THE LOOKING JELLY','hearts':'♥♥♥','score':'✦ 999','boss-name':'THE PANTRY KING','boss-hearts':'◆◆◆◆◆','power':'✦ SWEET MAGNET 12s','hint':'Keep holding. Get closer to the edge.','toast':'CHECKPOINT ✦'})){const e=document.getElementById(id);e.textContent=text;e.classList.remove('hidden');e.style.opacity='1';}});
    assert.ok(await page.locator('#messages').isVisible());
    await bounds(['home','level-info','hearts','score','sound','pause','boss-hud','power','hint','toast','bottom']);
    await page.evaluate(()=>{document.body.dataset.state='dead';document.getElementById('hint').textContent='OOPS. STILL CUTE.\nTap or press R to bounce back.';document.getElementById('failure-tip').textContent='Hold to flatten underneath the moving crusher.';document.getElementById('boss-hud').classList.add('hidden');document.getElementById('power').textContent='';document.getElementById('toast').classList.add('hidden');});
    await bounds(['hud','hint','failure-tip','bottom']);
    await page.screenshot({path:new URL('./shots/layout-'+viewport.width+'.png',import.meta.url).pathname});
    await page.evaluate(()=>{document.body.dataset.state='won';document.getElementById('messages').classList.add('hidden');document.getElementById('clear-banner').classList.remove('hidden');document.getElementById('clear-title').textContent='KEEP THAT JELLY ROLLING!';document.getElementById('clear-detail').textContent='✦ 99   ♥ 4 friends   ★★★';document.getElementById('clear-next').textContent='NEXT: Through the looking jelly — A shortcut through somewhere strange.';});
    await bounds(['hud','clear-banner','bottom']);
    await bounds(['clear-title','clear-detail','clear-next']);
    console.log('PASS text layout '+viewport.width+'×'+viewport.height);await page.close();
  }
}finally{await browser?.close();server.kill();}
