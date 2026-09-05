import assert from 'node:assert/strict';
import {Simulation,makeLevel,surfaceY} from './.qa/simulation.mjs';
let checks=0;
function check(name,value){assert.ok(value,name);console.log('PASS',name);checks++;}
function fixture(extra={}){return {index:2,name:'Fixture',world:0,length:3000,speed:220,surfaces:[{id:0,x:-100,y:0,w:3500,kind:'ground'}],obstacles:[],enemies:[],pickups:[],signs:[],portals:[],checkpoints:[],...extra};}
function run(s,n=60){s.state='playing';for(let i=0;i<n;i++)s.step(1/120);return s;}
let s=new Simulation(fixture());s.state='playing';s.input(true);run(s,60);s.input(false);run(s,12);const oldVy=s.vy;s.input(true);check('air press reverses upward motion into a dive',oldVy<0&&s.diving&&s.vy>0);
s=new Simulation(fixture({surfaces:[{id:1,x:100,y:-50,w:170,kind:'crumble'},{id:0,x:-100,y:0,w:3500,kind:'ground'}]}));s.y=-100;s.vy=500;s.grounded=false;s.diving=true;s.held=true;run(s,14);check('pancake dive breaks brittle terrain',s.level.surfaces[0].broken);
s=new Simulation(fixture({surfaces:[{id:1,x:100,y:0,w:80,kind:'spring'},{id:0,x:-100,y:0,w:3500,kind:'ground'}]}));run(s,1);check('spring launches on contact',s.vy<=-850&&!s.grounded);
s=new Simulation(fixture({surfaces:[{id:1,x:0,y:-50,w:600,kind:'ledge',motion:20}]}));s.y=-50;s.standing=1;run(s,30);check('moving surface carries the jelly',Math.abs(s.y-surfaceY(s.level.surfaces[0],s.time))<.001&&s.grounded);
s=new Simulation(fixture({surfaces:[{id:1,x:0,y:0,w:600,kind:'belt',belt:80}]}));run(s,60);check('conveyor affects actual travel speed',s.x>275);
s=new Simulation(fixture({obstacles:[{kind:'crate',x:170,y:0,w:50,h:60}]}));s.power='chili';s.powerTime=7;run(s,30);check('chili breaks crates without damage',s.level.obstacles[0].broken&&s.health===2);
s=new Simulation(fixture({surfaces:[]}));s.y=-200;s.grounded=false;s.power='bubble';s.powerTime=7;s.held=true;run(s,100);check('held bubble caps descent speed',s.vy<=75&&s.state==='playing');
s=new Simulation(fixture({enemies:[{kind:'slug',x:180,y:0,origin:180,range:0,phase:0}]}));s.y=-85;s.vy=350;s.grounded=false;run(s,20);check('landing on an enemy bounces and defeats it',s.level.enemies[0].dead&&s.vy<0);
s=new Simulation(fixture({portals:[{x:155,y:-25,toX:800,toY:-160}]}));run(s,3);check('portal changes route and altitude',s.x>790&&s.y<-150&&s.level.portals[0].used);
const level=fixture({checkpoints:[165],pickups:[{kind:'sweet',x:150,y:-25},{kind:'friend',x:165,y:-30}]});s=new Simulation(structuredClone(level));run(s,25);const cp=structuredClone(s.checkpoint);const resumed=new Simulation(structuredClone(level),cp);check('checkpoint restores position and earned collectibles',cp.x>130&&resumed.x===cp.x&&resumed.sweets===cp.sweets&&resumed.friends===cp.friends&&resumed.level.pickups.every(p=>p.got));
s=new Simulation(fixture({surfaces:[]}));run(s,120);check('missing floor eventually kills the jelly',s.state==='dead');
check('daily layout is repeatable',JSON.stringify(makeLevel(12,20260904))===JSON.stringify(makeLevel(12,20260904)));
check('different daily seeds create different courses',JSON.stringify(makeLevel(12,20260904))!==JSON.stringify(makeLevel(12,20260905)));
check('tutorial signs stop after level two',Array.from({length:22},(_,i)=>makeLevel(i+2)).every(l=>l.signs.every(s=>s.type!=='tutorial')));
check('three bosses have increasing endurance',[7,15,23].map(i=>new Simulation(makeLevel(i)).bossMax).join(',')==='3,4,5');
console.log(checks+' mechanic checks passed.');
