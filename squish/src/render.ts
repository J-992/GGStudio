import { Simulation, SKINS } from './game';
const INK='#293d35';
type Particle={x:number;y:number;vx:number;vy:number;life:number;max:number;color:string;size:number};
export class Renderer {
  ctx:CanvasRenderingContext2D; width=960;height=540;scale=1;ground=420;camera=0;clock=0;impact=0;shake=0;particles:Particle[]=[];skin=0;reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
  constructor(public canvas:HTMLCanvasElement){this.ctx=canvas.getContext('2d')!;this.resize();}
  resize(){const w=innerWidth,h=innerHeight;this.scale=Math.min(w/960,h/540);if(w/h<1.1)this.scale=w/540;this.width=w/this.scale;this.height=h/this.scale;this.ground=this.height*.77;const dpr=Math.min(devicePixelRatio||1,2);this.canvas.width=Math.round(w*dpr);this.canvas.height=Math.round(h*dpr);}
  burst(x:number,y:number,color:string,count=12){if(this.reduced)count=Math.min(4,count);for(let i=0;i<count;i++){let life=.4+Math.random()*.6;this.particles.push({x,y,vx:(Math.random()-.5)*260,vy:-Math.random()*230-30,life,max:life,color,size:3+Math.random()*5});}}
  rr(x:number,y:number,w:number,h:number,r:number,fill:string,stroke=INK,line=2.5){const c=this.ctx;c.beginPath();c.roundRect(x,y,w,h,r);c.fillStyle=fill;c.fill();if(stroke){c.strokeStyle=stroke;c.lineWidth=line;c.stroke();}}
  ellipse(x:number,y:number,rx:number,ry:number,color:string){const c=this.ctx;c.beginPath();c.ellipse(x,y,Math.max(.1,rx),Math.max(.1,ry),0,0,Math.PI*2);c.fillStyle=color;c.fill();}
  text(t:string,x:number,y:number,size:number,color=INK,align:CanvasTextAlign='center',weight=800){const c=this.ctx;c.font=`${weight} ${size}px ui-rounded, "Arial Rounded MT Bold", Arial, sans-serif`;c.fillStyle=color;c.textAlign=align;c.fillText(t,x,y);}
  star(x:number,y:number,r:number,color='#f2ba58',rotation=0){const c=this.ctx;c.save();c.translate(x,y);c.rotate(rotation);c.beginPath();for(let i=0;i<8;i++){let a=i*Math.PI/4;let rr=i%2?r*.4:r;i?c.lineTo(Math.cos(a)*rr,Math.sin(a)*rr):c.moveTo(Math.cos(a)*rr,Math.sin(a)*rr);}c.closePath();c.fillStyle=color;c.fill();c.strokeStyle=INK;c.lineWidth=1.5;c.stroke();c.restore();}
  blob(x:number,y:number,w:number,h:number,emotion='happy',tilt=0){
    const c=this.ctx;const skin=SKINS[this.skin];c.save();c.translate(x,y);c.rotate(tilt);
    c.beginPath();c.moveTo(-w*.5,-h*.22);c.bezierCurveTo(-w*.6,-h*.8,-w*.3,-h*1.03,0,-h);c.bezierCurveTo(w*.35,-h*1.02,w*.57,-h*.77,w*.5,-h*.23);c.quadraticCurveTo(w*.5,0,w*.3,0);c.quadraticCurveTo(0,h*.045,-w*.3,0);c.quadraticCurveTo(-w*.5,0,-w*.5,-h*.22);c.fillStyle=skin.color;c.fill();c.lineWidth=2.8;c.strokeStyle=INK;c.stroke();
    this.ellipse(-w*.18,-h*.75,w*.13,h*.075,skin.light);this.ellipse(-w*.34,-h*.57,w*.042,h*.042,skin.light);
    const eyeY=-h*.48,eyeX=w*.16;
    if(emotion==='dead'){for(const ex of [-eyeX,eyeX]){c.beginPath();c.moveTo(ex-3,eyeY-3);c.lineTo(ex+3,eyeY+3);c.moveTo(ex+3,eyeY-3);c.lineTo(ex-3,eyeY+3);c.stroke();}}
    else if(emotion==='squish'){for(const ex of [-eyeX,eyeX]){c.beginPath();c.moveTo(ex-3,eyeY-2);c.lineTo(ex+2,eyeY);c.lineTo(ex-3,eyeY+2);c.lineWidth=2;c.stroke();}}
    else{for(const ex of [-eyeX,eyeX]){this.ellipse(ex,eyeY,w*.04,h*.075,INK);this.ellipse(ex+.6,eyeY-1,w*.012,h*.021,'#fff');}}
    this.ellipse(-w*.28,eyeY+h*.15,w*.075,h*.045,'#e7708e');this.ellipse(w*.28,eyeY+h*.15,w*.075,h*.045,'#e7708e');
    if(emotion==='air')this.ellipse(0,eyeY+h*.18,w*.045,h*.065,INK);
    else{c.beginPath();c.arc(0,eyeY+h*.11,w*.07,0,Math.PI);c.lineWidth=1.8;c.stroke();}c.restore();
  }
  draw(sim:Simulation,dt:number,intro:boolean){
    this.clock+=dt;this.impact=Math.max(0,this.impact-dt*5);this.shake=Math.max(0,this.shake-dt*25);
    const c=this.ctx,w=this.width,h=this.height,g=this.ground;const dpr=this.canvas.width/innerWidth;
    c.setTransform(this.scale*dpr,0,0,this.scale*dpr,0,0);
    const palettes=[['#d7efdf','#b8d8bd','#f7f1dc'],['#eee1ee','#d6c3dd','#f8eede'],['#dbe9f1','#b8d0dd','#f8eedc']];
    const palette=palettes[Math.min(2,sim.level.world)];c.fillStyle=palette[0];c.fillRect(0,0,w,h);
    this.camera=intro?0:Math.max(0,sim.x-w*.25);
    // Quiet paper texture: a fixed, inexpensive dot field.
    c.fillStyle='#293d3509';for(let y=16;y<h;y+=28)for(let x=16;x<w;x+=28){c.fillRect(x,y,1.5,1.5);}
    // Clouds and distant candy hills move at separate speeds.
    for(let i=-1;i<8;i++){let x=i*260-((this.camera*.16)%260);let y=g-205+Math.sin(i*2.3)*55;this.ellipse(x,y,44,14,'#ffffff58');this.ellipse(x-14,y-9,20,16,'#ffffff58');}
    c.fillStyle=palette[1];c.globalAlpha=.55;c.beginPath();c.moveTo(0,g);for(let x=0;x<=w+20;x+=20)c.lineTo(x,g-65-Math.sin((x+this.camera*.25)*.008)*35-Math.sin((x+this.camera*.2)*.019)*16);c.lineTo(w,g);c.closePath();c.fill();c.globalAlpha=1;
    for(let i=-1;i<8;i++){const x=i*230-((this.camera*.3)%230)+80;const y=g-50;this.rr(x,y,8,50,4,'#95b89b','',0);this.ellipse(x+4,y-5,24,32,'#aac9a3');this.ellipse(x-2,y-13,14,17,'#bed7af');}
    if(intro){this.introScene(w,g,palette[2]);return;}
    c.save();if(!this.reduced)c.translate(Math.sin(this.clock*80)*this.shake,Math.cos(this.clock*70)*this.shake*.6);
    // Solid ground is segmented around actual collision gaps.
    let start=this.camera-100;
    for(const pit of sim.level.obstacles.filter(o=>o.kind==='gap')){if(pit.x+pit.w<start)continue;this.groundPiece(start-this.camera,g,pit.x-start,h,palette[2]);start=pit.x+pit.w;}
    this.groundPiece(start-this.camera,g,this.camera+w+100-start,h,palette[2]);
    for(const o of sim.level.obstacles){let x=o.x-this.camera;if(x+o.w<-80||x>w+80)continue;
      if(o.kind==='gate'){
        this.rr(x+o.w*.5-8,g-185,16,90,5,'#9bad94');
        this.rr(x-5,g-138,o.w+10,103,13,'#edb366');
        this.rr(x-5,g-60,o.w+10,25,7,'#f4c984');
        c.save();c.beginPath();c.rect(x,g-58,o.w,20);c.clip();c.strokeStyle='#a9794945';c.lineWidth=8;for(let j=-10;j<o.w+20;j+=22){c.beginPath();c.moveTo(x+j,g-60);c.lineTo(x+j+15,g-35);c.stroke();}c.restore();
        this.ellipse(x+o.w*.36,g-101,3.5,4.5,INK);this.ellipse(x+o.w*.64,g-101,3.5,4.5,INK);c.beginPath();c.moveTo(x+o.w*.45,g-84);c.lineTo(x+o.w*.55,g-84);c.lineWidth=2;c.strokeStyle=INK;c.stroke();
        this.text('HOLD ↓',x+o.w/2,g-154,12,'#58755f');
      } else if(o.kind==='spikes'){
        const n=Math.ceil(o.w/22);for(let j=0;j<n;j++){let xx=x+j*o.w/n;c.beginPath();c.moveTo(xx,g);c.lineTo(xx+o.w/n/2,g-33);c.quadraticCurveTo(xx+o.w/n*.65,g-36,xx+o.w/n,g);c.closePath();c.fillStyle='#dd859a';c.fill();c.strokeStyle=INK;c.lineWidth=2.5;c.stroke();}this.text('HOP ↗',x+o.w/2,g-67,11,'#986078');
      } else{
        this.text('↗',x-25,g-15,25,'#769d85');
        for(let j=0;j<3;j++)this.ellipse(x+o.w/2+Math.sin(this.clock*2+j)*o.w*.2,g+42+j*21,12-j*2,3,'#85b29e30');
      }
    }
    // Sweets form an arc that teaches the trajectory without a text panel.
    for(const s of sim.level.sweets)if(!s.got && s.x-this.camera>-30 && s.x-this.camera<w+30){this.star(s.x-this.camera,g-s.y+Math.sin(this.clock*3+s.x)*3,9,'#f2c466',this.clock*.5);}
    const finish=sim.level.length-this.camera;
    if(finish<w+100){this.rr(finish-10,g-149,85,149,40,'#a1c5ab');this.rr(finish+2,g-137,61,137,30,'#fcf5df');this.text('EXIT',finish+33,g-95,13);this.text('↗',finish+33,g-49,32);this.star(finish+33,g-175,16,'#f3c169',this.clock*.3);}
    const px=sim.x-this.camera;const py=g+sim.y;const bounce=this.impact;
    this.ellipse(px,g+5,27+Math.min(10,sim.charge*10),6,'#293d351c');
    const squash=sim.held && sim.grounded;
    let bw=squash?66:45, bh=squash?22:50;
    bw+=bounce*17;bh-=bounce*12;
    if(!sim.grounded){bw-=5;bh+=7;}
    const wiggle=squash?Math.sin(this.clock*50)*sim.charge*1.2:0;
    this.blob(px+wiggle,py,bw,bh,sim.state==='dead'?'dead':squash?'squish':!sim.grounded?'air':'happy',!sim.grounded?Math.max(-.18,Math.min(.18,sim.vy*.0003)):0);
    if(squash){this.rr(px-26,py+16,52,6,3,'#293d3525','');if(sim.charge>0)this.rr(px-26,py+16,52*sim.charge,6,3,sim.charge===1?'#ed7594':'#f0b768','');if(sim.charge===1)this.text('READY!',px,py-40,10,'#a2526a');}
    for(let i=this.particles.length-1;i>=0;i--){let p=this.particles[i];p.life-=dt;p.x+=p.vx*dt;p.y+=p.vy*dt;p.vy+=500*dt;if(p.life<=0){this.particles.splice(i,1);continue;}c.globalAlpha=p.life/p.max;this.ellipse(p.x-this.camera,g+p.y,p.size,p.size,p.color);}c.globalAlpha=1;c.restore();
  }
  groundPiece(x:number,y:number,w:number,h:number,color:string){if(w<=0)return;const c=this.ctx;c.fillStyle=color;c.fillRect(x,y,w,h-y);c.strokeStyle=INK;c.lineWidth=3;c.beginPath();c.moveTo(x,y);c.lineTo(x+w,y);c.stroke();c.fillStyle='#c4be9d40';c.fillRect(x,y+9,w,6);for(let i=0;i<w;i+=42){this.ellipse(x+i+13,y+35,2,1.4,'#b6b28d50');}}
  introScene(w:number,g:number,color:string){
    this.groundPiece(0,g,w,this.height,color);
    const portrait=w<700;const x=portrait?w*.74:w*.71;const size=portrait?1:1.5;
    const c=this.ctx;c.save();c.translate(x,g);c.scale(size,size);
    this.ellipse(0,5,65,10,'#293d351c');
    const b=this.reduced?0:Math.sin(this.clock*2.6);
    this.blob(0,-7-Math.max(0,b)*22,107-b*10,115+b*10,'happy',Math.sin(this.clock*1.3)*.06);
    this.star(-87,-112,14,'#f3c366',this.clock*.3);this.star(84,-164,10,'#faf7dc',-this.clock*.2);this.star(110,-60,7,'#f3c366',this.clock*.5);
    this.text('very soft.',60,-225,13,'#678874');this.text('very determined.',78,-207,13,'#678874');
    c.strokeStyle='#678874';c.lineWidth=1.5;c.beginPath();c.moveTo(70,-196);c.quadraticCurveTo(85,-173,58,-156);c.lineTo(62,-166);c.moveTo(58,-156);c.lineTo(69,-157);c.stroke();
    c.restore();
    // A tiny companion and discarded candy wrapper bring scale to the scene.
    if(!portrait){const old=this.skin;this.skin=1;this.blob(w*.88,g,39,31,'squish');this.skin=old;this.text('you got this!',w*.88,g-46,11,'#678874');}
    for(let i=0;i<7;i++){const xx=w*.49+i*66;this.ellipse(xx,g+40+Math.sin(i)*15,3,1.5,'#b2ab8b80');}
  }
}
