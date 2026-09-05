export type Obstacle = { kind: 'gate' | 'spikes' | 'gap'; x: number; w: number; cleared?: boolean };
export type Sweet = { x: number; y: number; got: boolean };
export type Level = { name: string; world: number; length: number; speed: number; obstacles: Obstacle[]; sweets: Sweet[] };
export type GameEvent = { type: 'jump' | 'land' | 'sweet' | 'clear' | 'die' | 'win'; x: number; y: number; value?: string };
export const NAMES = ['The soft start', 'Mind your head', 'A little leap', 'Under & over', 'Jelly sandwich', 'Trust the squish', 'Prickly business', 'Full of bounce', 'Sugar rush', 'Tiny windows', 'No hard feelings', 'The long way', 'Mint condition', 'Spring cleaning', 'A close shave', 'Hold that thought', 'One last squeeze', 'The great escape'];
export const SKINS = [
  { name: 'Strawberry', color: '#f58ba6', light: '#ffc4d1', cost: 0 },
  { name: 'Matcha', color: '#a1c881', light: '#d5e9ba', cost: 15 },
  { name: 'Blueberry', color: '#a5a0e2', light: '#d6d1ff', cost: 35 },
  { name: 'Mango', color: '#f5bb5f', light: '#ffe0a0', cost: 60 },
  { name: 'Bubblegum', color: '#84cdd8', light: '#c0f0f0', cost: 95 },
  { name: 'Midnight', color: '#667789', light: '#b2c9d6', cost: 140 },
];
function rng(seed: number) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
export function makeLevel(index: number, seed?: number): Level {
  const random = rng(seed ?? index * 991 + 17);
  const patterns: Array<Array<Obstacle['kind']>> = [
    ['gate','gate'], ['gate','gate','gate'], ['gap','gap'], ['gate','gap','gate'],
    ['gate','gap','gate','gap'], ['gap','gate','gap','gate'], ['spikes','spikes','gate'],
    ['gap','spikes','gap','gate'], ['gate','spikes','gap','gate','gap'],
  ];
  const kinds: Obstacle['kind'][] = seed !== undefined ? Array.from({length:18}, () => (['gate','gap','spikes'] as const)[Math.floor(random()*3)]) : index < 9 ? patterns[index] : Array.from({length:5+Math.floor((index-9)/3)}, (_,i) => (['gate','gap','spikes'] as const)[(i+index)%3]);
  let x = 590;
  const obstacles: Obstacle[] = [];
  const sweets: Sweet[] = [{x:350,y:30,got:false},{x:410,y:30,got:false}];
  for (const kind of kinds) {
    const w = kind === 'gate' ? 120 + Math.floor(random()*65) : kind === 'gap' ? 90 + Math.min(50,index*3) + Math.floor(random()*10) : 48 + Math.min(35,index*2);
    obstacles.push({kind,x,w});
    if(kind === 'gate') for(let j=0;j<3;j++) sweets.push({x:x+20+j*(w-40)/2,y:13,got:false});
    else for(let j=0;j<3;j++) sweets.push({x:x-8+j*(w+16)/2,y:85+Math.sin(j*Math.PI/2)*30,got:false});
    x += w + (index < 4 ? 370 : 290) + random()*50;
  }
  return {name:seed === undefined ? NAMES[index] : 'Daily sugar rush',world:Math.floor(index/6),length:x+140,speed:225+Math.min(index,17)*2,obstacles,sweets};
}
export class Simulation {
  x=150; y=0; vy=0; charge=0; held=false; grounded=true; time=0; sweets=0; combo=0; jumps=0;
  state:'ready'|'playing'|'dead'|'won'|'paused'='ready'; events:GameEvent[]=[]; reason='';
  constructor(public level:Level){}
  get height(){return this.held && this.grounded ? 21 : 49;}
  get halfWidth(){return this.held && this.grounded ? 31 : 21;}
  input(down:boolean){
    if(this.state!=='playing')return;
    if(!down && this.held && this.grounded){this.vy=-(405+195*this.charge);this.grounded=false;this.jumps++;this.events.push({type:'jump',x:this.x,y:this.y});}
    this.held=down;
    if(!down)this.charge=0;
  }
  die(reason:string){if(this.state!=='playing')return;this.reason=reason;this.state='dead';this.held=false;this.events.push({type:'die',x:this.x,y:this.y,value:reason});}
  step(dt:number){
    if(this.state!=='playing')return;
    this.time+=dt;this.x+=this.level.speed*dt;
    if(this.held)this.charge=Math.min(1,this.charge+dt/0.58);
    const prevY=this.y;
    const pit=this.level.obstacles.some(o=>o.kind==='gap' && this.x>o.x+5 && this.x<o.x+o.w-5);
    if(!this.grounded || pit){this.grounded=false;this.vy+=1400*dt;this.y+=this.vy*dt;}
    if(this.y>=0 && !pit && prevY<=2 && this.vy>=0){
      if(this.vy>100)this.events.push({type:'land',x:this.x,y:0});
      this.y=0;this.vy=0;this.grounded=true;
    }
    if(this.y>100){this.die('Release before the edge. A longer hold makes a bigger jump.');return;}
    for(const o of this.level.obstacles){
      if(this.x+this.halfWidth-5>o.x && this.x-this.halfWidth+5<o.x+o.w){
        if(o.kind==='gate' && this.y-this.height < -32){this.die('Stay squished until your whole jelly is through.');return;}
        if(o.kind==='spikes' && this.y>-34){this.die('Those sprinkles are pointy. Hold, then release to jump!');return;}
      }
      if(!o.cleared && this.x-this.halfWidth>o.x+o.w && this.y<20){o.cleared=true;this.combo++;this.events.push({type:'clear',x:this.x,y:this.y,value:o.kind});}
    }
    for(const sweet of this.level.sweets)if(!sweet.got && Math.abs(this.x-sweet.x)<this.halfWidth+11 && Math.abs(this.y-this.height*.5+sweet.y)<this.height*.5+14){sweet.got=true;this.sweets++;this.events.push({type:'sweet',x:sweet.x,y:-sweet.y});}
    if(this.x>=this.level.length){this.state='won';this.held=false;this.events.push({type:'win',x:this.x,y:this.y});}
  }
}
