export type Surface = {id:number;x:number;y:number;w:number;kind:'ground'|'ledge'|'crumble'|'spring'|'belt'|'cloud';belt?:number;motion?:number;phase?:number;triggered?:number;broken?:boolean};
export type Obstacle = {kind:'gate'|'crusher'|'spikes'|'saw'|'crate';x:number;y:number;w:number;h:number;phase?:number;motion?:number;broken?:boolean;cleared?:boolean};
export type Enemy = {kind:'slug'|'bee';x:number;y:number;origin:number;range:number;phase:number;dead?:boolean};
export type Pickup = {kind:'sweet'|'friend'|'bubble'|'chili';x:number;y:number;got?:boolean};
export type Sign = {x:number;y:number;text:string;type:'tutorial'|'chapter'|'route'};
export type Portal = {x:number;y:number;toX:number;toY:number;used?:boolean};
export type Level = {index:number;name:string;world:number;length:number;speed:number;surfaces:Surface[];obstacles:Obstacle[];enemies:Enemy[];pickups:Pickup[];signs:Sign[];portals:Portal[];checkpoints:number[];boss?:'whisk'|'oven'|'king';wind?:{x:number;w:number;lift:number}[]};
export type GameEvent = {type:'jump'|'land'|'sweet'|'friend'|'clear'|'die'|'win'|'hit'|'stomp'|'break'|'spring'|'power'|'checkpoint'|'portal'|'bossHit'|'turn';x:number;y:number;value?:string};
export type Checkpoint = {x:number;y:number;sweets:number;friends:number;got:number[]};
export const SKINS=[{name:'Strawberry',color:'#f58ba6',light:'#ffc4d1',cost:0},{name:'Matcha',color:'#a1c881',light:'#d5e9ba',cost:15},{name:'Blueberry',color:'#a5a0e2',light:'#d6d1ff',cost:35},{name:'Mango',color:'#f5bb5f',light:'#ffe0a0',cost:60},{name:'Bubblegum',color:'#84cdd8',light:'#c0f0f0',cost:95},{name:'Midnight',color:'#667789',light:'#b2c9d6',cost:140}];
export {makeLevel,NAMES,WORLDS} from './levels';
export function surfaceY(s:Surface,time:number){return s.y+(s.motion?Math.sin(time*1.6+(s.phase||0))*s.motion:0);}
export function obstacleRect(o:Obstacle,time:number){const gap=o.kind==='gate'?32:o.kind==='crusher'?32+(1+Math.sin(time*2.5+(o.phase||0)))*59:0;const y=o.y-gap+(o.kind==='saw'?Math.sin(time*2+(o.phase||0))*(o.motion||0):0);return {x:o.x,y:y-o.h,w:o.w,h:o.h};}
export class Simulation {
  x=130;y=0;vy=0;direction=1;charge=0;held=false;grounded=true;diving=false;time=0;sweets=0;friends=0;combo=0;jumps=0;health=2;invincible=0;power:'bubble'|'chili'|null=null;powerTime=0;fever=0;checkpoint:Checkpoint={x:130,y:0,sweets:0,friends:0,got:[]};
  state:'ready'|'playing'|'dead'|'won'|'paused'='ready';events:GameEvent[]=[];reason='';standing=-1;coyote=.1;jumpBuffer=0;bufferCharge=0;checkpointIndex=0;stompChain=0;lastSpring=-1;springLock=0;
  bossHP=3;bossFlash=0;bossTime=0;bossX=1180;bossY=-82;bossActive=false;bossAttack=0;bossTell=0;shots:{x:number;y:number;vx:number;kind:'wave'|'drop';life:number}[]=[];
  constructor(public level:Level,checkpoint?:Checkpoint){
    if(checkpoint){this.checkpoint=structuredClone(checkpoint);this.x=checkpoint.x;this.y=checkpoint.y;this.sweets=checkpoint.sweets;this.friends=checkpoint.friends;checkpoint.got.forEach(i=>{if(level.pickups[i])level.pickups[i].got=true;});this.checkpointIndex=level.checkpoints.filter(x=>x<=this.x).length;}
  }
  get flat(){return this.held&&(this.grounded||this.diving);}
  get height(){return this.flat?22:48;}
  get halfWidth(){return this.flat?30:21;}
  get speed(){const s=this.level.surfaces.find(s=>s.id===this.standing);return this.level.speed*(this.power==='chili'?1.25:1)+(this.grounded?s?.belt||0:0);}
  emit(type:GameEvent['type'],value?:string,x=this.x,y=this.y){this.events.push({type,x,y,value});}
  input(down:boolean){
    if(this.state!=='playing'||down===this.held)return;
    this.held=down;
    if(down){if(!this.grounded&&this.coyote<=0&&this.power!=='bubble'){this.diving=true;this.vy=Math.max(230,this.vy);}}
    else{if(this.grounded||this.coyote>0)this.jump(this.charge);else if(this.diving){this.jumpBuffer=.14;this.bufferCharge=Math.max(.45,this.charge);}this.diving=false;this.charge=0;}
  }
  jump(charge:number){this.vy=-(350+290*charge);this.grounded=false;this.standing=-1;this.coyote=0;this.jumps++;this.emit('jump');}
  hurt(reason:string){
    if(this.invincible>0||this.state!=='playing')return;
    if(this.power){this.power=null;this.powerTime=0;this.invincible=1.6;this.emit('hit','POWER SAVED YOU');return;}
    this.health--;this.combo=0;this.invincible=1.6;this.emit('hit','STILL BOUNCING');
    if(this.health<=0)this.die(reason);
  }
  die(reason:string){if(this.state!=='playing')return;this.reason=reason;this.state='dead';this.held=false;this.emit('die',reason);}
  win(){if(this.state!=='playing')return;this.state='won';this.held=false;this.emit('win');}
  step(dt:number){
    if(this.state!=='playing')return;
    this.time+=dt;this.invincible=Math.max(0,this.invincible-dt);this.fever=Math.max(0,this.fever-dt);this.springLock=Math.max(0,this.springLock-dt);this.jumpBuffer=Math.max(0,this.jumpBuffer-dt);this.bossFlash=Math.max(0,this.bossFlash-dt);
    if(this.power){this.powerTime-=dt;if(this.powerTime<=0)this.power=null;}
    if(this.held)this.charge=Math.min(1,this.charge+dt/.5);
    const standing=this.level.surfaces.find(s=>s.id===this.standing);
    if(this.grounded&&standing&&!standing.broken)this.y=surfaceY(standing,this.time);
    const prevY=this.y;this.x+=this.speed*this.direction*dt;
    if(this.level.boss&&this.x>720)this.bossActive=true;
    if(this.bossActive){if(this.x>1620){this.x=1620;this.direction=-1;this.emit('turn');}if(this.x<690){this.x=690;this.direction=1;this.emit('turn');}}
    const support=this.level.surfaces.find(s=>!s.broken&&this.x>=s.x&&this.x<=s.x+s.w&&Math.abs(this.y-surfaceY(s,this.time))<3);
    if(this.grounded&&!support){this.grounded=false;this.standing=-1;this.coyote=.095;}
    if(!this.grounded){
      this.coyote=Math.max(0,this.coyote-dt);let gravity=this.power==='bubble'&&this.held?280:1450;
      if(this.diving)gravity=2900;const wind=this.level.wind?.find(w=>this.x>w.x&&this.x<w.x+w.w);if(wind)gravity-=wind.lift;
      this.vy+=gravity*dt;if(this.power==='bubble'&&this.held)this.vy=Math.min(this.vy,75);
      this.vy=Math.max(-950,Math.min(1000,this.vy));this.y+=this.vy*dt;
    }
    const landings=this.level.surfaces.filter(s=>!s.broken&&this.x+12>s.x&&this.x-12<s.x+s.w&&prevY<=surfaceY(s,this.time)+5&&this.y>=surfaceY(s,this.time)&&this.vy>=0).sort((a,b)=>surfaceY(a,this.time)-surfaceY(b,this.time));
    const floor=landings[0]||(this.grounded?support:undefined);
    if(floor){
      const impact=this.vy;this.y=surfaceY(floor,this.time);
      if(floor.kind==='crumble'&&this.diving&&impact>300){floor.broken=true;this.emit('break','CRUST CRUSHED');this.vy=300;}
      else if(floor.kind==='spring'&&(this.springLock<=0||this.lastSpring!==floor.id)){
        this.vy=this.diving?-1000:-850;this.grounded=false;this.diving=false;this.standing=-1;this.lastSpring=floor.id;this.springLock=.2;this.emit('spring',impact>600?'SUPER BOING!':'BOING!');
      }else{
        if(!this.grounded&&impact>100){this.emit('land');this.stompChain=0;}
        this.vy=0;this.grounded=true;this.diving=false;this.standing=floor.id;this.coyote=.095;
        if(floor.kind==='crumble'&&floor.triggered===undefined)floor.triggered=this.time;
        if(this.jumpBuffer>0){this.jump(this.bufferCharge);this.jumpBuffer=0;}
      }
    }
    for(const s of this.level.surfaces)if(s.triggered!==undefined&&!s.broken&&this.time-s.triggered>.58){s.broken=true;this.emit('break',undefined,s.x+s.w/2,s.y);if(this.standing===s.id){this.grounded=false;this.standing=-1;}}
    if(this.y>210){this.die('A little earlier on the release. You can jump just after leaving an edge.');return;}
    for(const o of this.level.obstacles){
      if(o.broken)continue;const r=obstacleRect(o,this.time);
      const overlap=this.x+this.halfWidth-5>r.x&&this.x-this.halfWidth+5<r.x+r.w&&this.y>r.y+4&&this.y-this.height<r.y+r.h-3;
      if(overlap){if(o.kind==='crate'&&(this.power==='chili'||this.diving)){o.broken=true;this.emit('break','CRUNCH!');this.sweets+=3;}else if(this.power!=='chili')this.hurt(o.kind==='gate'||o.kind==='crusher'?'Stay small until you are all the way through.':'Try a different jump height, or take the upper route.');}
      if(!o.cleared&&this.direction>0&&this.x-this.halfWidth>o.x+o.w){o.cleared=true;this.combo++;if(this.combo%3===0)this.emit('clear');}
    }
    for(const enemy of this.level.enemies){
      if(enemy.dead)continue;enemy.x=enemy.origin+Math.sin(this.time*1.6+enemy.phase)*enemy.range;const ey=enemy.y+(enemy.kind==='bee'?Math.sin(this.time*3+enemy.phase)*12:0);
      if(Math.abs(this.x-enemy.x)<this.halfWidth+20&&this.y>ey-32&&this.y-this.height<ey){
        if(this.power==='chili'||(this.vy>0&&prevY<=ey-20)){enemy.dead=true;this.stompChain++;this.sweets+=2;this.emit('stomp',this.stompChain>1?`${this.stompChain}× BOUNCE!`:'BOOP!',enemy.x,ey);if(this.power!=='chili'){this.vy=this.diving?-730:-540;this.grounded=false;this.diving=false;this.standing=-1;}}
        else this.hurt('Bounce on their heads, or squish beneath the flying ones.');
      }
    }
    for(const p of this.level.pickups){
      if(p.got)continue;const magnet=this.fever>0&&p.kind==='sweet'?110:0;
      if(Math.abs(this.x-p.x)<this.halfWidth+14+magnet&&Math.abs(this.y-this.height*.5-p.y)<this.height*.5+16+magnet){
        p.got=true;
        if(p.kind==='sweet'){this.sweets++;this.combo++;this.emit('sweet',undefined,p.x,p.y);if(this.combo>0&&this.combo%18===0){this.fever=5;this.emit('power','SWEET MAGNET!');}}
        else if(p.kind==='friend'){this.friends++;this.health=Math.min(3,this.health+1);this.emit('friend','A FRIEND FOR THE ROAD!',p.x,p.y);}
        else{this.power=p.kind;this.powerTime=7;this.emit('power',p.kind==='bubble'?'BUBBLE JELLY!':'HOT STUFF!',p.x,p.y);}
      }
    }
    for(const p of this.level.portals)if(!p.used&&Math.abs(this.x-p.x)<28&&Math.abs(this.y-28-p.y)<48){p.used=true;this.x=p.toX;this.y=p.toY;this.vy=-200;this.grounded=false;this.standing=-1;this.emit('portal','SECRET SHORTCUT!');}
    const cp=this.level.checkpoints[this.checkpointIndex];if(cp!==undefined&&this.x>=cp&&this.grounded){this.checkpointIndex++;this.health=Math.max(2,this.health);this.checkpoint={x:this.x,y:this.y,sweets:this.sweets,friends:this.friends,got:this.level.pickups.flatMap((p,i)=>p.got?[i]:[])};this.emit('checkpoint','FRESH START SAVED');}
    if(this.bossActive)this.updateBoss(dt,prevY);if(!this.level.boss&&this.x>=this.level.length)this.win();
  }
  updateBoss(dt:number,prevY:number){
    this.bossTime+=dt;this.bossX=1150+Math.sin(this.bossTime*.7)*155;this.bossY=-82;
    this.bossAttack+=dt;const interval=this.level.boss==='king'?1.85:2.5;this.bossTell=this.bossAttack>interval-.7?1:0;
    if(this.bossAttack>interval){this.bossAttack=0;const high=Math.floor(this.bossTime/interval)%3===2;this.shots.push({x:this.bossX,y:high?-48:-6,vx:(this.x<this.bossX?-1:1)*(high?240:190),kind:high?'drop':'wave',life:6});}
    for(let i=this.shots.length-1;i>=0;i--){const shot=this.shots[i];shot.x+=shot.vx*dt;shot.life-=dt;if(shot.life<0){this.shots.splice(i,1);continue;}if(Math.abs(shot.x-this.x)<26&&this.y>shot.y-22&&this.y-this.height<shot.y+6){this.hurt('Hop the low doughballs. Squish beneath the high ones.');this.shots.splice(i,1);}}
    if(Math.abs(this.x-this.bossX)<67&&this.y>this.bossY&&this.y-this.height<this.bossY+75){
      if(this.vy>0&&prevY<this.bossY+13&&this.bossFlash===0){this.bossHP--;this.bossFlash=1.3;this.vy=-740;this.grounded=false;this.diving=false;this.standing=-1;this.health=Math.min(3,this.health+1);this.emit('bossHit',this.bossHP===0?'YOU DID IT!':`${this.bossHP} TO GO!`,this.bossX,this.bossY);if(this.bossHP<=0){this.sweets+=15;this.win();}}
      else if(this.bossFlash===0)this.hurt('Its soft spot is on top. Give it a big bounce!');
    }
  }
}
