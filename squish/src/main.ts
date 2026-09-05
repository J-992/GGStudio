import './style.css';
import { makeLevel, Simulation, SKINS, NAMES } from './game';
import { Renderer } from './render';
import { Audio } from './audio';
import { poki } from '../../src/platform/Poki';
const $=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
type Save={unlocked:number;bank:number;skin:number;stars:number[];daily:Record<string,number>;muted:boolean};
const defaults:Save={unlocked:0,bank:0,skin:0,stars:[],daily:{},muted:false};
let save:Save={...defaults};
try{const s=JSON.parse(localStorage.getItem('squish-v1')||'null');if(s&&typeof s==='object')save={unlocked:Math.max(0,Math.min(17,Number(s.unlocked)||0)),bank:Math.max(0,Number(s.bank)||0),skin:Math.max(0,Math.min(5,Number(s.skin)||0)),stars:Array.isArray(s.stars)?s.stars.slice(0,18).map((n:unknown)=>Math.max(0,Math.min(3,Number(n)||0))):[],daily:s.daily&&typeof s.daily==='object'?s.daily:{},muted:!!s.muted};}catch{}
function persist(){try{localStorage.setItem('squish-v1',JSON.stringify(save));}catch{}}
const renderer=new Renderer($<HTMLCanvasElement>('canvas'));renderer.skin=save.skin;
const audio=new Audio();audio.muted=save.muted;
let sim=new Simulation(makeLevel(0));let index=0,intro=true,daily=false,attempt=1,totalDeaths=0,toastTime=0,stateAge=0;
let platformReady=false;
function gameplayStart(){if(platformReady)poki.gameplayStart();}
let modalAction:()=>void=()=>{},secondaryAction:()=>void=()=>{};
let dailyDate=new Date().toISOString().slice(0,10);
const requestedDate=new URLSearchParams(location.search).get('daily');
if(requestedDate && /^\d{4}-\d{2}-\d{2}$/.test(requestedDate) && !Number.isNaN(Date.parse(requestedDate)))dailyDate=requestedDate;
const dailySeed=Number(dailyDate.replaceAll('-',''));
const inputs=new Set<string>();let previousFocus:HTMLElement|null=null;
function clearInput(){inputs.clear();sim.held=false;sim.charge=0;}
function syncSound(){$('sound').textContent=audio.muted?'♪̸':'♫';$('sound').setAttribute('aria-label',audio.muted?'Unmute sound':'Mute sound');}
syncSound();
function toast(text:string){$('toast').textContent=text;$('toast').style.opacity='1';toastTime=1.25;}
function closeModal(){$('modal').classList.add('hidden');previousFocus?.focus({preventScroll:true});}
function modal(kicker:string,title:string,copy:string,primary:string,action:()=>void,secondary='Back to menu',second:()=>void=home){
  clearInput();previousFocus=document.activeElement as HTMLElement;$('modal-kicker').textContent=kicker;$('modal-title').textContent=title;$('modal-copy').textContent=copy;$('modal-extra').replaceChildren();$('modal-primary').textContent=primary;$('modal-secondary').textContent=secondary;modalAction=action;secondaryAction=second;$('modal').classList.remove('hidden');$('modal-primary').focus({preventScroll:true});
}
function start(level=0,isDaily=false,retry=false){
  clearInput();audio.unlock();closeModal();intro=false;daily=isDaily;index=level;if(!retry)attempt=1;
  sim=new Simulation(makeLevel(isDaily?12:level,isDaily?dailySeed:undefined));sim.state='playing';stateAge=0;renderer.particles=[];
  $('intro').classList.add('hidden');document.body.classList.add('playing');$('level-name').textContent=isDaily?'DAILY · '+dailyDate:`${String(level+1).padStart(2,'0')} / ${NAMES[level].toUpperCase()}`;
  $('canvas').focus({preventScroll:true});
  $('world-label').textContent=isDaily?'SAME COURSE. EVERYONE. TODAY.':`${String(Math.floor(level/6)+1).padStart(2,'0')} / ${['THE SOFT START','THE SUGAR WORKS','THE MINT ESCAPE'][Math.floor(level/6)]}`;
  $('attempt-label').textContent=`ATTEMPT ${String(attempt).padStart(2,'0')}`;
  gameplayStart();poki.measureLevel(isDaily?99:level+1,'start');
}
function home(){poki.gameplayStop();clearInput();closeModal();intro=true;sim=new Simulation(makeLevel(save.unlocked));$('intro').classList.remove('hidden');document.body.classList.remove('playing');$('hint').textContent='';$('level-name').textContent='THE GREAT JELLY ESCAPE';$('progress-fill').style.width='0%';$('score').textContent=`✦ ${save.bank}`;$('world-label').textContent='01 / THE SOFT START';$('attempt-label').textContent='MADE OF JELLY. BUILT FOR TROUBLE.';updatePlay();}
function updatePlay(){$('play').innerHTML=save.unlocked>0?`KEEP BOUNCING <span>↗</span>`:`LET’S BOUNCE <span>↗</span>`;}
function retry(){attempt++;start(index,daily,true);}
function pause(){if(sim.state==='playing'){sim.state='paused';poki.gameplayStop();modal('TAKE A BREATHER','Stay soft.','Your jelly is right where you left it.','KEEP BOUNCING',()=>{closeModal();sim.state='playing';gameplayStart();});}else if(sim.state==='paused'){closeModal();sim.state='playing';gameplayStart();}}
function finish(){
  const stars=1+(sim.sweets>=Math.ceil(sim.level.sweets.length*.55)?1:0)+(sim.sweets===sim.level.sweets.length?1:0);
  if(daily){save.daily[dailyDate]=Math.max(Number(save.daily[dailyDate])||0,sim.sweets);const entries=Object.entries(save.daily).sort(([a],[b])=>b.localeCompare(a));save.daily=Object.fromEntries(entries.slice(0,60));}
  else{save.stars[index]=Math.max(save.stars[index]||0,stars);save.unlocked=Math.min(17,Math.max(save.unlocked,index+1));}
  save.bank+=sim.sweets;persist();
  const final=!daily&&index===17;
  modal(daily?'DAILY RUN COMPLETE':final?'FREEDOM TASTES SWEET':`LEVEL ${index+1} COMPLETE`,final?'You escaped!':daily?'Sweet run.':'Freshly squished.',`${sim.sweets} / ${sim.level.sweets.length} sweets · ${sim.time.toFixed(1)} seconds · ${attempt} ${attempt===1?'attempt':'attempts'}${daily?` · Best: ${save.daily[dailyDate]}`:''}`,daily?'RUN IT AGAIN':final?'PLAY FROM THE START':'NEXT LEVEL ↗',()=>start(daily?12:final?0:index+1,daily),daily?'Copy daily challenge':'Replay for more sweets',()=>{if(daily)void share();else retry();});
  const starsEl=document.createElement('div');starsEl.className='stars';starsEl.textContent='★'.repeat(stars)+'☆'.repeat(3-stars);$('modal-extra').append(starsEl);
  const back=document.createElement('button');back.className='text-button';back.textContent='Back to menu';back.onclick=home;$('modal-extra').append(back);
}
async function share(){const url=new URL(location.href);url.search='';url.searchParams.set('daily',dailyDate);const text=`SQUISH! I collected ${sim.sweets}/${sim.level.sweets.length} sweets on ${dailyDate}. Your turn: ${url.href}`;try{await navigator.clipboard.writeText(text);$('modal-secondary').textContent='Challenge copied ✓';}catch{const p=document.createElement('p');p.className='share-code';p.textContent=text;$('modal-extra').append(p);}}
function closet(){modal('PICK YOUR FLAVOUR','Jelly closet',`${save.bank} sweets collected. New flavours unlock as you play.`,'LOOKING SWEET',home);const grid=document.createElement('div');grid.className='skin-grid';SKINS.forEach((skin,i)=>{const btn=document.createElement('button');btn.disabled=save.bank<skin.cost;btn.className=i===save.skin?'selected':'';btn.innerHTML=`<span class="skin-dot" style="background:${skin.color}"></span>${skin.name}<br><small>${btn.disabled?`${skin.cost} sweets`:'Unlocked'}</small>`;btn.onclick=()=>{save.skin=i;renderer.skin=i;persist();closet();};grid.append(btn);});$('modal-extra').append(grid);}
function levels(){modal('18 LITTLE ESCAPES','Pick a bounce.','Collect every sweet to earn all three stars.','BACK TO MENU',home);const grid=document.createElement('div');grid.className='level-grid';NAMES.forEach((name,i)=>{const b=document.createElement('button');b.disabled=i>save.unlocked;b.setAttribute('aria-label',`Level ${i+1}: ${name}${b.disabled?', locked':''}`);b.innerHTML=`${b.disabled?'·':i+1}<small>${'★'.repeat(save.stars[i]||0)||'—'}</small>`;b.onclick=()=>start(i);grid.append(b);});$('modal-extra').append(grid);}
$('play').onclick=()=>start(save.unlocked);$('daily').onclick=()=>start(12,true);$('wardrobe').onclick=closet;$('levels').onclick=levels;$('home').onclick=home;$('pause').onclick=pause;
$('sound').onclick=()=>{audio.unlock();audio.muted=!audio.muted;save.muted=audio.muted;persist();syncSound();};
$('modal-primary').onclick=()=>{audio.unlock();modalAction();};$('modal-secondary').onclick=()=>secondaryAction();
function press(source:string){audio.unlock();if(!$('modal').classList.contains('hidden'))return;if(intro)start(save.unlocked);if(sim.state==='dead'){if(stateAge>.22)retry();return;}if(sim.state==='won')return;inputs.add(source);sim.input(true);}
function release(source:string){inputs.delete(source);if(inputs.size===0)sim.input(false);}
const canvas=$<HTMLCanvasElement>('canvas');
canvas.addEventListener('pointerdown',e=>{if(e.button!==0)return;e.preventDefault();canvas.setPointerCapture(e.pointerId);press(`pointer${e.pointerId}`);});
canvas.addEventListener('pointerup',e=>{e.preventDefault();release(`pointer${e.pointerId}`);});
canvas.addEventListener('pointercancel',e=>{inputs.delete(`pointer${e.pointerId}`);if(sim.state==='playing')pause();});
canvas.addEventListener('contextmenu',e=>e.preventDefault());
window.addEventListener('keydown',e=>{
  if(e.code==='Tab'&&!$('modal').classList.contains('hidden')){const buttons=Array.from($('modal').querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));const first=buttons[0],last=buttons.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}return;}
  if(['Space','ArrowUp','KeyW'].includes(e.code)){
    if(document.activeElement instanceof HTMLButtonElement && e.code==='Space')return;
    e.preventDefault();if(!e.repeat)press(e.code);
  }
  if(e.code==='Escape'){if(!$('modal').classList.contains('hidden')&&sim.state!=='paused')home();else pause();}
  if(e.code==='KeyR'&&!intro&&$('modal').classList.contains('hidden')){e.preventDefault();poki.gameplayStop();retry();}
  if(e.code==='KeyM')$('sound').click();
});
window.addEventListener('keyup',e=>{if(['Space','ArrowUp','KeyW'].includes(e.code)){e.preventDefault();release(e.code);}});
window.addEventListener('blur',()=>{if(sim.state==='playing')pause();clearInput();});
document.addEventListener('visibilitychange',()=>{if(document.hidden){if(sim.state==='playing')pause();clearInput();}});
window.addEventListener('resize',()=>renderer.resize());
function frameEvents(){for(const e of sim.events){audio.play(e.type,sim.sweets);if(e.type==='jump')renderer.burst(e.x,0,'#fff8e3',7);if(e.type==='land'){renderer.impact=1;renderer.burst(e.x,0,'#fff8e3',5);}if(e.type==='sweet')renderer.burst(e.x,e.y,'#efc56b',5);if(e.type==='clear'&&sim.combo>1)toast(['','NICE!','SO SMOOTH!','JELLY ON A ROLL!','UNSQUISHABLE!'][Math.min(4,sim.combo)]);if(e.type==='die'){totalDeaths++;stateAge=0;inputs.clear();poki.gameplayStop();poki.measureLevel(daily?99:index+1,'fail');renderer.shake=renderer.reduced?0:5;renderer.burst(e.x,e.y,SKINS[save.skin].color,24);}if(e.type==='win'){stateAge=0;poki.gameplayStop();poki.measureLevel(daily?99:index+1,'complete');renderer.burst(e.x,-70,'#efc56b',50);}}sim.events=[];}
let last=performance.now(),accumulator=0,finished=false;
function frame(now:number){const dt=Math.max(0,Math.min((now-last)/1000,.05));last=now;stateAge+=dt;accumulator+=dt;
  while(accumulator>=1/120){sim.step(1/120);accumulator-=1/120;}frameEvents();renderer.draw(sim,dt,intro);
  if(!intro){$('progress-fill').style.width=`${Math.min(100,(sim.x-150)/(sim.level.length-150)*100)}%`;$('score').textContent=`✦ ${sim.sweets}`;
    if(sim.state==='dead')$('hint').textContent=stateAge>.25?'OOPS. STILL CUTE.\nTap or press R to try again':'';
    else if(sim.state==='playing'){
      finished=false;const next=sim.level.obstacles.find(o=>!o.cleared && o.x+o.w>sim.x-40);
      $('hint').textContent=index<4&&!daily&&next&&next.x-sim.x<360 ? (next.kind==='gate'?'HOLD ↓  Make yourself tiny.':!sim.grounded?'NICE ↗  Enjoy the air!':sim.held&&next.x-sim.x<65?'RELEASE ↗  Let it fly!':sim.held?'KEEP HOLDING ↓  Wait for the edge.':'HOLD ↓  Charge your bounce.') : '';
    }else $('hint').textContent='';
    if(sim.state==='won'&&stateAge>.65&&!finished){finished=true;finish();}
  }
  $('failure-tip').textContent=!intro&&sim.state==='dead'&&stateAge>.25?sim.reason:'';
  if(toastTime>0){toastTime-=dt;if(toastTime<=0)$('toast').style.opacity='0';}
  requestAnimationFrame(frame);
}
// Read-only inspection for browser QA; no cheats or level-skipping in the shipped game.
if(import.meta.env.DEV)(window as unknown as {__SQUISH__:unknown}).__SQUISH__={snapshot:()=>({state:sim.state,x:sim.x,y:sim.y,charge:sim.charge,held:sim.held,grounded:sim.grounded,index,daily,attempt,totalDeaths,sweets:sim.sweets,level:sim.level,save})};
void (async()=>{await poki.init();poki.loadingStart();poki.loadingFinished();platformReady=true;if(sim.state==='playing'){gameplayStart();poki.measureLevel(daily?99:index+1,'start');}})();
home();requestAnimationFrame(frame);
