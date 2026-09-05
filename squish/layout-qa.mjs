import {build} from 'vite';
import {fileURLToPath} from 'node:url';
await build({configFile:false,logLevel:'silent',build:{outDir:fileURLToPath(new URL('./.qa/',import.meta.url)),emptyOutDir:false,minify:false,lib:{entry:fileURLToPath(new URL('./src/game.ts',import.meta.url)),formats:['es'],fileName:()=> 'layout-simulation.mjs'}}});
const {makeLevel,obstacleRect,surfaceY}=await import('./.qa/layout-simulation.mjs?'+Date.now());
const problems=[];
const courses=Array.from({length:24},(_,i)=>makeLevel(i));
for(let seed=20260901;seed<=20260930;seed++)courses.push(makeLevel(12,seed));
for(const level of courses){
  const index=level.index;
  for(const s of level.surfaces.filter(s=>s.kind==='ledge')){
    if(s.y+(s.motion||0)+32>-12)problems.push('Level '+(index+1)+': ledge at '+s.x+' sinks into the ground');
  }
  for(const s of level.surfaces.filter(s=>s.kind!=='ground'&&s.kind!=='belt'))for(const o of level.obstacles){
    if(s.x+s.w<=o.x-12||s.x>=o.x+o.w+12)continue;
    for(let step=0;step<80;step++){
      const time=step*.125,r=obstacleRect(o,time),y=surfaceY(s,time),top=y-(s.kind==='spring'?20:0),bottom=y+(s.kind==='spring'?15:s.kind==='cloud'?36:32);
      const piston=(o.kind==='gate'||o.kind==='crusher')&&s.x+s.w>o.x+o.w/2-19&&s.x<o.x+o.w/2+19;
      if(bottom>r.y-(piston?60:0)-12&&top<r.y+r.h+12){problems.push('Level '+(index+1)+': '+s.kind+' at '+s.x+' overlaps '+o.kind+' at '+o.x);break;}
    }
  }
}
if(problems.length){console.error(problems.join('\n'));console.error(problems.length+' platform / hazard conflicts');process.exitCode=1;}
else console.log('PASS: 24 courses and 30 daily seeds have clear platform / hazard bodies and pistons across movement phases.');
