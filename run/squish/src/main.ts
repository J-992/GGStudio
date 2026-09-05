import './style.css';
import {makeLevel,Simulation,SKINS,NAMES,WORLDS,type Checkpoint} from './game';
import {NEXT} from './levels';
import {Renderer} from './render';
import {Audio} from './audio';
import {poki} from '../../src/platform/Poki';
const $=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
type Save={unlocked:number;current:number;bank:number;skin:number;stars:number[];rescues:number[];daily:Record<string,number>;muted:boolean;musicMuted:boolean;completed:boolean;activeSeconds:number};
const defaults:Save={unlocked:0,current:0,bank:0,skin:0,stars:[],rescues:[],daily:{},muted:false,musicMuted:false,completed:false,activeSeconds:0};
let save:Save={...defaults};
const finite=(n:unknown,max=1e7)=>Math.max(0,Math.min(max,Number.isFinite(Number(n))?Number(n):0));
try{const current=JSON.parse(localStorage.getItem('squish-adventure-v2')||'null');const old=JSON.parse(localStorage.getItem('squish-v1')||'null');const s=current||{};
  save={...defaults,unlocked:finite(s.unlocked,23),current:finite(s.current,23),bank:finite(s.bank??old?.bank),skin:finite(s.skin??old?.skin,5),stars:Array.isArray(s.stars)?s.stars.slice(0,24).map((n:unknown)=>finite(n,3)):[],rescues:Array.isArray(s.rescues)?s.rescues.slice(0,24).map((n:unknown)=>finite(n,9)):[],daily:s.daily&&typeof s.daily==='object'?s.daily:{},muted:!!(s.muted??old?.muted),musicMuted:!!s.musicMuted,completed:!!s.completed,activeSeconds:finite(s.activeSeconds)};
  save.current=Math.min(save.current,save.unlocked);
}catch{}
function persist(){try{localStorage.setItem('squish-adventure-v2',JSON.stringify(save));}catch{}}
const renderer=new Renderer($<HTMLCanvasElement>('canvas'));renderer.skin=save.skin;
const audio=new Audio();audio.muted=save.muted;audio.musicMuted=save.musicMuted;
let sim=new Simulation(makeLevel(save.current)),index=save.current,daily=false,attempt=1,totalDeaths=0,age=0,toastTime=0,transitionTime=0,rewarded=false,platformReady=false;
let modalAction:()=>void=()=>{},secondaryAction:()=>void=()=>{},previousFocus:HTMLElement|null=null;
const inputs=new Set<string>();
let dailyDate=new Date().toISOString().slice(0,10);const requestedDate=new URLSearchParams(location.search).get('daily');
if(requestedDate&&/^\d{4}-\d{2}-\d{2}$/.test(requestedDate)&&!Number.isNaN(Date.parse(requestedDate)))dailyDate=requestedDate;
const dailySeed=Number(dailyDate.replaceAll('-',''));
function gameplayStart(){if(platformReady)poki.gameplayStart();}
function clearInput(){inputs.clear();sim.held=false;sim.charge=0;sim.diving=false;}
function toast(text:string){$('toast').textContent=text;$('toast').style.opacity='1';toastTime=1.3;}
function closeModal(){$('modal').classList.add('hidden');previousFocus?.focus({preventScroll:true});}
function modal(kicker:string,title:string,copy:string,primary:string,action:()=>void,secondary='BACK TO THE GAME',second:()=>void=resume){
  clearInput();previousFocus=document.activeElement as HTMLElement;$('modal-kicker').textContent=kicker;$('modal-title').textContent=title;$('modal-copy').textContent=copy;$('modal-extra').replaceChildren();$('modal-primary').textContent=primary;$('modal-secondary').textContent=secondary;modalAction=action;secondaryAction=second;$('modal').classList.remove('hidden');$('modal-primary').focus({preventScroll:true});
}
function loadLevel(level:number,isDaily=false,cp?:Checkpoint,auto=false){
  poki.gameplayStop();clearInput();closeModal();index=level;daily=isDaily;
  sim=new Simulation(makeLevel(isDaily?12:level,isDaily?dailySeed:undefined),cp);sim.state=auto?'playing':'ready';age=0;transitionTime=0;rewarded=false;renderer.particles=[];renderer.snapCamera=true;
  if(!cp)attempt=1;
  if(!isDaily){save.current=level;persist();}
  $('level-name').textContent=isDaily?'DAILY EXPEDITION':String(level+1).padStart(2,'0')+' / '+NAMES[level].toUpperCase();
  $('world-label').textContent=isDaily?dailyDate:WORLDS[sim.level.world];$('attempt-label').textContent='ATTEMPT '+String(attempt).padStart(2,'0');
  $('clear-banner').classList.add('hidden');$('canvas').focus({preventScroll:true});
  if(auto){gameplayStart();poki.measureLevel(daily?99:index+1,'start');}
}
function begin(){audio.unlock();if(sim.state!=='ready')return;sim.state='playing';age=0;$('canvas').focus({preventScroll:true});gameplayStart();poki.measureLevel(daily?99:index+1,'start');}
function retry(full=false){attempt++;const cp=full?undefined:sim.checkpoint;loadLevel(index,daily,cp,true);}
function freeze(){if(sim.state==='playing'||sim.state==='ready'){sim.state='paused';poki.gameplayStop();}audio.playing=false;}
function resume(){closeModal();if(sim.state==='won'){loadLevel(daily?save.current:index===23?0:index+1);return;}if(sim.state==='paused'){sim.state='playing';gameplayStart();}audio.unlock();$('canvas').focus({preventScroll:true});}
function extraButton(text:string,action:()=>void){const b=document.createElement('button');b.className='text-button';b.textContent=text;b.onclick=action;$('modal-extra').append(b);}
function pause(){if(sim.state==='paused'&&!$('modal').classList.contains('hidden')){resume();return;}if(sim.state!=='playing'&&sim.state!=='ready')return;freeze();modal('TAKE A BREATHER','Stay soft.','Your next little adventure is right here.','KEEP BOUNCING ↗',resume,'CHOOSE A LEVEL',showMap);extraButton('✿ Jelly closet',closet);extraButton('☀ Daily expedition',()=>loadLevel(12,true));extraButton('↺ Restart this level',()=>retry(true));extraButton(audio.musicMuted?'♫ Music: off':'♫ Music: on',()=>{audio.musicMuted=!audio.musicMuted;save.musicMuted=audio.musicMuted;persist();$('modal-extra').replaceChildren();extraButton(audio.musicMuted?'♫ Music: off':'♫ Music: on',()=>{audio.musicMuted=!audio.musicMuted;save.musicMuted=audio.musicMuted;persist();resume();});});}
function showMap(){freeze();modal('A LITTLE JELLY. A BIG WORLD.','Your adventure.',save.rescues.reduce((a,b)=>a+b,0)+' friends rescued · '+save.stars.reduce((a,b)=>a+b,0)+' stars earned','KEEP BOUNCING',resume);
  const grid=document.createElement('div');grid.className='level-grid';NAMES.forEach((name,i)=>{const b=document.createElement('button');b.disabled=i>save.unlocked;b.className=i===index?'selected':'';b.setAttribute('aria-label','Level '+(i+1)+': '+name);b.innerHTML=(b.disabled?'·':i%8===7?'♛':i+1)+'<small>'+('★'.repeat(save.stars[i]||0)||'—')+'</small>';b.onclick=()=>loadLevel(i);grid.append(b);});$('modal-extra').append(grid);extraButton('✿ Jelly closet',closet);extraButton('☀ Daily expedition',()=>loadLevel(12,true));
}
function closet(){freeze();modal('PICK YOUR FLAVOUR','Jelly closet',save.bank+' sweets collected. Flavours unlock as you explore.','LOOKING SWEET',resume);const grid=document.createElement('div');grid.className='skin-grid';SKINS.forEach((skin,i)=>{const b=document.createElement('button');b.disabled=save.bank<skin.cost;b.className=i===save.skin?'selected':'';b.innerHTML='<span class="skin-dot" style="background:'+skin.color+'"></span>'+skin.name+'<br><small>'+(b.disabled?skin.cost+' sweets':'Unlocked')+'</small>';b.onclick=()=>{save.skin=i;renderer.skin=i;persist();closet();};grid.append(b);});$('modal-extra').append(grid);}
function finish(){
  if(rewarded)return;rewarded=true;
  const total=sim.level.pickups.filter(p=>p.kind==='sweet').length;
  const stars=1+(sim.sweets>=total*.65?1:0)+Number(sim.level.boss?sim.health>=2:sim.friends>0||sim.sweets>=total);
  save.bank+=sim.sweets;
  if(daily){save.daily[dailyDate]=Math.max(Number(save.daily[dailyDate])||0,sim.sweets);save.daily=Object.fromEntries(Object.entries(save.daily).sort(([a],[b])=>b.localeCompare(a)).slice(0,60));}
  else{save.stars[index]=Math.max(save.stars[index]||0,stars);save.rescues[index]=Math.max(save.rescues[index]||0,sim.friends);save.unlocked=Math.min(23,Math.max(save.unlocked,index+1));save.current=Math.min(23,index+1);if(index===23)save.completed=true;}
  persist();
  if(daily||sim.level.boss){
    modal(daily?'DAILY EXPEDITION COMPLETE':index===23?'THE WHOLE PANTRY IS FREE':'A BIG PROBLEM, SQUISHED.',daily?'Sweet expedition.':index===23?'Small blob. Big hero.':'That is how we roll.',sim.sweets+' sweets · '+sim.time.toFixed(1)+' seconds · '+attempt+' '+(attempt===1?'attempt':'attempts'),daily?'RUN IT AGAIN':index===23?'EXPLORE AGAIN':'ON TO '+WORLDS[Math.min(2,sim.level.world+1)],()=>loadLevel(daily?12:index===23?0:index+1,daily,undefined,true),daily?'COPY DAILY CHALLENGE':'YOUR ADVENTURE',daily?()=>void share():showMap);
    const e=document.createElement('div');e.className='stars';e.textContent='★'.repeat(stars)+'☆'.repeat(3-stars);$('modal-extra').append(e);if(daily)extraButton('Return to your adventure',()=>loadLevel(save.current));
  }else{
    transitionTime=1.6;$('clear-title').textContent=['SWEET ESCAPE!','BEAUTIFULLY BOUNCED!','KEEP THAT JELLY ROLLING!'][index%3];$('clear-detail').textContent='✦ '+sim.sweets+'   '+(sim.friends?'♥ '+sim.friends+' friends   ':'')+'★'.repeat(stars);$('clear-next').textContent='NEXT: '+NAMES[index+1]+' — '+NEXT[index+1];$('clear-banner').classList.remove('hidden');
  }
}
async function share(){const url=new URL(location.href);url.search='';url.searchParams.set('daily',dailyDate);const text='SQUISH! '+sim.sweets+' sweets on the '+dailyDate+' expedition. Your turn: '+url.href;try{await navigator.clipboard.writeText(text);$('modal-secondary').textContent='CHALLENGE COPIED ✓';}catch{const p=document.createElement('p');p.className='share-code';p.textContent=text;$('modal-extra').append(p);}}
function sound(){audio.unlock();audio.muted=!audio.muted;save.muted=audio.muted;persist();$('sound').textContent=audio.muted?'♪̸':'♫';$('sound').setAttribute('aria-label',audio.muted?'Unmute sound':'Mute sound');}
$('sound').onclick=sound;$('sound').textContent=audio.muted?'♪̸':'♫';$('home').onclick=showMap;$('pause').onclick=pause;$('begin').onclick=begin;$('modal-primary').onclick=()=>{audio.unlock();modalAction();};$('modal-secondary').onclick=()=>secondaryAction();
function press(source:string){audio.unlock();if(!$('modal').classList.contains('hidden'))return;if(sim.state==='dead'){if(age>.2)retry();return;}if(sim.state==='won'){if(transitionTime>0)loadLevel(index+1,false,undefined,true);return;}if(sim.state==='ready')begin();inputs.add(source);sim.input(true);}
function release(source:string){inputs.delete(source);if(inputs.size===0)sim.input(false);}
const canvas=$<HTMLCanvasElement>('canvas');
canvas.addEventListener('pointerdown',e=>{if(e.button!==0)return;e.preventDefault();canvas.setPointerCapture(e.pointerId);press('pointer'+e.pointerId);});
canvas.addEventListener('pointerup',e=>{e.preventDefault();release('pointer'+e.pointerId);});canvas.addEventListener('pointercancel',()=>{clearInput();if(sim.state==='playing')pause();});canvas.addEventListener('contextmenu',e=>e.preventDefault());
window.addEventListener('keydown',e=>{
  if(e.code==='Tab'&&!$('modal').classList.contains('hidden')){const bs=Array.from($('modal').querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));if(e.shiftKey&&document.activeElement===bs[0]){e.preventDefault();bs.at(-1)?.focus();}else if(!e.shiftKey&&document.activeElement===bs.at(-1)){e.preventDefault();bs[0]?.focus();}return;}
  if(['Space','ArrowUp','KeyW'].includes(e.code)){if(document.activeElement instanceof HTMLButtonElement&&e.code==='Space')return;e.preventDefault();if(!e.repeat)press(e.code);}
  if(e.code==='Escape'){if(!$('modal').classList.contains('hidden'))resume();else pause();}
  if(e.code==='KeyR'&&$('modal').classList.contains('hidden')&&sim.state!=='won'){e.preventDefault();retry();}
  if(e.code==='KeyM')sound();
});
window.addEventListener('keyup',e=>{if(['Space','ArrowUp','KeyW'].includes(e.code)){e.preventDefault();release(e.code);}});
window.addEventListener('blur',()=>{if(sim.state==='playing')pause();clearInput();persist();});
document.addEventListener('visibilitychange',()=>{if(document.hidden){if(sim.state==='playing')pause();clearInput();audio.playing=false;audio.tick();persist();}});
window.addEventListener('resize',()=>renderer.resize());
function events(){for(const e of sim.events){audio.play(e.type,sim.sweets);
  if(e.type==='jump')renderer.burst(e.x,e.y,'#fff8e3',6);
  if(e.type==='land'){renderer.impact=1;renderer.burst(e.x,e.y,'#fff8e3',4);}
  if(e.type==='sweet')renderer.burst(e.x,e.y,'#efc56b',4);
  if(['stomp','break','spring','friend','power','portal','bossHit'].includes(e.type)){renderer.burst(e.x,e.y,e.type==='friend'?'#a9d59a':'#f3c779',e.type==='bossHit'?38:14);if(e.value)toast(e.value);if(e.type==='spring'||e.type==='stomp')renderer.impact=.5;}
  if(e.type==='clear'&&sim.combo>5)toast(sim.combo+'× SWEET STREAK');
  if(e.type==='checkpoint')toast('CHECKPOINT ✦');
  if(e.type==='hit'){renderer.shake=renderer.reduced?0:4;renderer.burst(e.x,e.y,SKINS[save.skin].color,10);}
  if(e.type==='die'){totalDeaths++;age=0;inputs.clear();poki.gameplayStop();poki.measureLevel(daily?99:index+1,'fail');renderer.shake=renderer.reduced?0:5;renderer.burst(e.x,e.y,SKINS[save.skin].color,25);persist();}
  if(e.type==='win'){age=0;poki.gameplayStop();poki.measureLevel(daily?99:index+1,'complete');renderer.burst(e.x,e.y-70,'#efc56b',45);}
  }sim.events=[];
}
let last=performance.now(),accumulator=0,saveTimer=0;
function frame(now:number){const dt=Math.max(0,Math.min((now-last)/1000,.05));last=now;age+=dt;accumulator+=dt;
  while(accumulator>=1/120){sim.step(1/120);accumulator-=1/120;}events();renderer.draw(sim,dt,false);
  audio.playing=sim.state==='playing';audio.world=sim.level.world;audio.boss=sim.bossActive;audio.tick();
  if(sim.state==='playing'){save.activeSeconds+=dt;saveTimer+=dt;if(saveTimer>15){persist();saveTimer=0;}}
  $('progress-fill').style.width=(sim.level.boss?Math.max(0,(sim.bossMax-sim.bossHP)/sim.bossMax*100):Math.min(100,(sim.x-130)/(sim.level.length-130)*100))+'%';
  $('score').textContent='✦ '+sim.sweets;$('hearts').textContent='♥'.repeat(Math.max(0,sim.health))+'♡'.repeat(Math.max(0,2-sim.health));
  $('power').textContent=sim.power?(sim.power==='bubble'?'◌ BUBBLE':'♨ CHILI')+' '+Math.ceil(sim.powerTime)+'s':sim.fever>0?'✦ SWEET MAGNET '+Math.ceil(sim.fever)+'s':'';
  $('boss-hud').classList.toggle('hidden',!sim.bossActive||sim.state==='won');$('boss-name').textContent=sim.level.boss==='king'?'THE PANTRY KING':sim.level.boss==='oven'?'THE RUNAWAY OVEN':'THE GRUMPY WHISK';$('boss-hearts').textContent='◆'.repeat(Math.max(0,sim.bossHP))+'◇'.repeat(sim.bossMax-Math.max(0,sim.bossHP));
  $('ready').classList.toggle('hidden',sim.state!=='ready');
  $('ready-title').textContent=index===0&&!daily?'Small blob. Big adventure.':daily?'The daily expedition':NAMES[index];$('ready-copy').textContent=index<2&&!daily?'Hold to squish. Release to spring.':NEXT[index];
  $('hint').textContent='';$('failure-tip').textContent='';
  if(sim.state==='dead'){$('hint').textContent='OOPS. STILL CUTE.\nTap or press R to bounce back.';if(age>.3)$('failure-tip').textContent=sim.reason;}
  else if(sim.state==='playing'&&index<2&&!daily){
    const obstacle=sim.level.obstacles.find(o=>!o.cleared&&o.x+o.w>sim.x);
    const ground=sim.level.surfaces.find(s=>s.kind==='ground'&&sim.x>=s.x&&sim.x<=s.x+s.w);
    const gap=ground&&ground.x+ground.w<sim.level.length?ground.x+ground.w-sim.x:Infinity;
    if(gap<260)$('hint').textContent=gap<66&&sim.held?'RELEASE ↗':sim.held?'Keep holding. Get closer to the edge.':'HOLD ↓  Charge your spring.';
    else if(obstacle&&obstacle.x-sim.x<260)$('hint').textContent=obstacle.kind==='gate'?'HOLD ↓  Make yourself tiny.':'Hold, then release to hop.';
  }
  if(sim.state==='won'&&age>.4&&!rewarded)finish();
  if(transitionTime>0&&$('modal').classList.contains('hidden')){transitionTime-=dt;if(transitionTime<=0)loadLevel(index+1,false,undefined,true);}
  if(toastTime>0){toastTime-=dt;if(toastTime<=0)$('toast').style.opacity='0';}
  requestAnimationFrame(frame);
}
if(import.meta.env.DEV)(window as unknown as {__SQUISH__:unknown}).__SQUISH__={snapshot:()=>({state:sim.state,time:sim.time,x:sim.x,y:sim.y,vy:sim.vy,direction:sim.direction,charge:sim.charge,held:sim.held,diving:sim.diving,grounded:sim.grounded,index,daily,attempt,totalDeaths,sweets:sim.sweets,friends:sim.friends,health:sim.health,power:sim.power,bossHP:sim.bossHP,bossX:sim.bossX,bossY:sim.bossY,checkpoint:sim.checkpoint,level:sim.level,save,music:{playing:audio.playing,muted:audio.musicMuted,initialized:!!audio.ctx}})};
void(async()=>{await poki.init();poki.loadingStart();poki.loadingFinished();platformReady=true;if(sim.state==='playing'){gameplayStart();poki.measureLevel(daily?99:index+1,'start');}})();
loadLevel(requestedDate?12:save.current,!!requestedDate);requestAnimationFrame(frame);
