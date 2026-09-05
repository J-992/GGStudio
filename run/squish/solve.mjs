import {build} from 'vite';
import {mkdirSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const out=fileURLToPath(new URL('./.qa/',import.meta.url));mkdirSync(out,{recursive:true});
await build({configFile:false,logLevel:'silent',build:{outDir:out,emptyOutDir:false,minify:false,lib:{entry:fileURLToPath(new URL('./src/game.ts',import.meta.url)),formats:['es'],fileName:()=> 'simulation.mjs'}}});
const {Simulation,makeLevel}=await import('./.qa/simulation.mjs?'+Date.now());
const DT=.1;
function clone(sim){const copy=Object.create(Simulation.prototype);Object.assign(copy,structuredClone({...sim,events:[]}));return copy;}
function key(s){return [Math.round(s.x/18),Math.round(s.y/10),Math.round(s.vy/80),s.held,Math.round(s.charge*4),s.health,s.power,Math.round(s.powerTime),s.direction,s.bossHP,Math.round(s.bossFlash*2),s.standing].join('|');}
function score(s){return s.level.boss?(s.bossMax-s.bossHP)*2000+s.health*120+s.sweets*2-Math.abs(s.x-s.bossX)*.07:s.x+s.health*110+s.friends*55+s.sweets*2+Math.min(200,-s.y)*.04;}
function solve(index,seed){const initial=new Simulation(makeLevel(index,seed));initial.state='playing';let beam=[{s:initial,path:[],events:{}}],best=null;
  for(let frame=0;frame<900;frame++){
    const candidates=new Map();
    for(const node of beam)for(const down of [false,true]){
      const s=clone(node.s);s.input(down);for(let j=0;j<12;j++)s.step(1/120);
      if(s.state==='dead')continue;
      const path=[...node.path,down];const events={...node.events};for(const e of s.events)events[e.type]=(events[e.type]||0)+1;s.events=[];
      if(s.state==='won')return {index,seed,step:DT,path,events,time:s.time,health:s.health,sweets:s.sweets,friends:s.friends};
      const k=key(s),v=score(s);const old=candidates.get(k);if(!old||v>old.v)candidates.set(k,{s,path,events,v});
    }
    beam=[...candidates.values()].sort((a,b)=>b.v-a.v).slice(0,index%8===7?110:65);best=beam[0];
    if(!beam.length)break;
  }
  return {index,failed:true,best:best?{x:best.s.x,y:best.s.y,health:best.s.health,bossHP:best.s.bossHP,time:best.s.time}:null};
}
const chosen=process.argv.slice(2).map(Number);const indices=chosen.length?chosen:Array.from({length:24},(_,i)=>i);
const results=[];for(const i of indices){const result=solve(i);results.push(result);console.log(JSON.stringify({...result,path:result.path?.length}));}
writeFileSync(out+'routes.json',JSON.stringify(results));
if(results.some(r=>r.failed))process.exitCode=1;
