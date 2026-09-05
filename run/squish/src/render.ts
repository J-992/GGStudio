import { Simulation, SKINS, surfaceY, obstacleRect } from './game';
const INK='#293d35';
type Particle={x:number;y:number;vx:number;vy:number;life:number;max:number;color:string;size:number};
export class Renderer {
  cameraY=0;snapCamera=true;
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
    const c=this.ctx,w=this.width,h=this.height,dpr=this.canvas.width/innerWidth;
    c.setTransform(this.scale*dpr,0,0,this.scale*dpr,0,0);
    const palettes=[['#d7efdf','#accdb4','#f7f1dc'],['#f1ded6','#d4aaa7','#f6e8d3'],['#dfe6f7','#bdc4e2','#fff2df']];
    const palette=palettes[Math.min(2,sim.level.world)];
    c.fillStyle=palette[0];c.fillRect(0,0,w,h);
    const targetX=Math.max(0,sim.x-w*(sim.direction===1?.26:.7));
    const targetY=Math.max(0,-sim.y-145);
    if(this.snapCamera){this.camera=targetX;this.cameraY=targetY;this.snapCamera=false;}
    else{this.camera+=(targetX-this.camera)*(1-Math.exp(-dt*9));this.cameraY+=(targetY-this.cameraY)*(1-Math.exp(-dt*4));}
    const g=this.ground+this.cameraY;
    c.fillStyle='#293d3508';for(let y=12;y<h;y+=30)for(let x=12;x<w;x+=30)c.fillRect(x,y,1.2,1.2);
    for(let i=-1;i<9;i++){const x=i*235-((this.camera*.15)%235);const y=this.ground-225+Math.sin(i*2.3)*70+this.cameraY*.15;this.ellipse(x,y,49,13,'#ffffff65');this.ellipse(x-12,y-10,22,17,'#ffffff65');}
    c.fillStyle=palette[1];c.globalAlpha=.55;c.beginPath();c.moveTo(0,h);
    for(let x=0;x<=w+20;x+=20)c.lineTo(x,this.ground+this.cameraY*.3-70-Math.sin((x+this.camera*.25)*.008)*42-Math.sin((x+this.camera*.2)*.019)*18);
    c.lineTo(w,h);c.fill();c.globalAlpha=1;
    for(let i=-1;i<8;i++){
      const x=i*230-((this.camera*.3)%230)+80,y=this.ground-65+this.cameraY*.25;
      if(sim.level.world===0){this.rr(x,y,8,70,4,'#95b89b','');this.ellipse(x+4,y-5,26,36,'#abc9a4');this.ellipse(x-2,y-17,15,20,'#c3dab4');}
      else if(sim.level.world===1){this.rr(x,y-85,65,160,14,'#cfada946','');this.rr(x+18,y-123,23,42,5,'#ba949044','');for(let j=0;j<3;j++)this.rr(x+12,y-65+j*42,40,19,5,'#fff1d936','');}
      else{this.ellipse(x,y-75,65,15,'#ffffff60');this.ellipse(x-15,y-86,32,22,'#ffffff60');this.star(x+48,y-130,5,'#fff7d9',this.clock*.1);}
    }
    if(intro){this.introScene(w,this.ground,palette[2]);return;}
    c.save();if(!this.reduced)c.translate(Math.sin(this.clock*80)*this.shake,Math.cos(this.clock*70)*this.shake*.6);
    for(const wind of sim.level.wind||[]){
      const x=wind.x-this.camera;if(x>w||x+wind.w<0)continue;
      c.fillStyle='#ffffff22';c.fillRect(x,g-440,wind.w,440);
      c.strokeStyle='#f8ffff77';c.lineWidth=2;
      for(let j=0;j<16;j++){const xx=x+18+(j*47)%wind.w,yy=g-((this.clock*110+j*39)%390);c.beginPath();c.moveTo(xx,yy);c.quadraticCurveTo(xx+12,yy-15,xx,yy-35);c.stroke();}
      this.rr(x+wind.w/2-27,g+3,54,18,6,'#abc9bc');this.text('≋',x+wind.w/2,g+17,22);
    }
    for(const s of [...sim.level.surfaces].sort((a,b)=>(a.kind==='ground'?0:1)-(b.kind==='ground'?0:1))){
      if(s.broken)continue;const x=s.x-this.camera,y=g+surfaceY(s,sim.time);
      if(x+s.w<-30||x>w+30||y>h+100)continue;
      if(s.kind==='ground'){const left=Math.max(-20,x),right=Math.min(w+20,x+s.w);this.groundPiece(left,y,right-left,h,palette[2]);continue;}
      if(s.kind==='spring'){
        this.rr(x+10,y-3,s.w-20,15,5,'#d7a164');
        c.strokeStyle=INK;c.lineWidth=2;c.beginPath();c.moveTo(x+15,y-4);for(let j=0;j<5;j++)c.lineTo(x+15+(j%2?s.w-30:0),y-4-j*4);c.stroke();
        this.rr(x-3,y-15,s.w+6,15,9,'#f495ac');this.ellipse(x+s.w*.3,y-10,7,3,'#ffd9db');continue;
      }
      if(s.kind==='belt'){
        this.rr(x,y,s.w,24,11,'#80998d');c.save();c.beginPath();c.rect(x+5,y+4,s.w-10,16);c.clip();
        for(let j=-20;j<s.w+20;j+=30)this.text(s.belt!>0?'›':'‹',x+j+(sim.time*(s.belt||0)*.5)%30,y+18,20,'#e5edcf');
        c.restore();continue;
      }
      const crumble=s.kind==='crumble';
      const wobble=crumble&&s.triggered!==undefined&&!this.reduced?Math.sin(this.clock*60)*2:0;
      this.rr(x+wobble,y,s.w,crumble?25:32,crumble?7:12,crumble?'#dcae79':s.kind==='cloud'?'#faf7f0':'#b5cda6');
      this.rr(x+wobble+2,y+2,s.w-4,8,4,crumble?'#f4d69f':s.kind==='cloud'?'#ffffff':'#d6e5b8','');
      if(crumble){c.strokeStyle='#996b47';c.lineWidth=1.5;for(let j=24;j<s.w;j+=43){c.beginPath();c.moveTo(x+j,y+9);c.lineTo(x+j-5,y+17);c.lineTo(x+j+3,y+24);c.stroke();}}
      else if(s.kind==='cloud'){for(let j=14;j<s.w-10;j+=30)this.ellipse(x+j,y+26,16,10,'#faf7f0');}
      else for(let j=17;j<s.w;j+=33)this.ellipse(x+j,y+20,2,2,'#86a47b');
      if(s.motion){c.strokeStyle='#293d3520';c.setLineDash([3,5]);c.beginPath();c.moveTo(x+s.w/2,y-38);c.lineTo(x+s.w/2,y+64);c.stroke();c.setLineDash([]);}
    }
    for(const o of sim.level.obstacles){
      if(o.broken)continue;const r=obstacleRect(o,sim.time),x=r.x-this.camera,y=g+r.y;
      if(x+r.w<-50||x>w+50)continue;
      if(o.kind==='gate'||o.kind==='crusher'){
        this.rr(x+r.w*.5-7,y-60,14,67,5,'#9bad94');
        this.rr(x-4,y,r.w+8,r.h,13,o.kind==='crusher'?'#dba0a1':'#edb366');
        this.rr(x-4,y+r.h-22,r.w+8,22,7,o.kind==='crusher'?'#efbdba':'#f4c984');
        c.save();c.beginPath();c.rect(x,y+r.h-21,r.w,19);c.clip();c.strokeStyle='#865d4538';c.lineWidth=7;
        for(let j=-10;j<r.w+20;j+=22){c.beginPath();c.moveTo(x+j,y+r.h-23);c.lineTo(x+j+15,y+r.h);c.stroke();}c.restore();
        this.ellipse(x+r.w*.36,y+r.h*.36,3.5,4.5,INK);this.ellipse(x+r.w*.64,y+r.h*.36,3.5,4.5,INK);
        c.strokeStyle=INK;c.lineWidth=2;c.beginPath();c.moveTo(x+r.w*.45,y+r.h*.54);c.lineTo(x+r.w*.55,y+r.h*.54);c.stroke();
      }else if(o.kind==='spikes'){
        const n=Math.ceil(r.w/22);for(let j=0;j<n;j++){const xx=x+j*r.w/n;c.beginPath();c.moveTo(xx,y+r.h);c.lineTo(xx+r.w/n/2,y);c.lineTo(xx+r.w/n,y+r.h);c.closePath();c.fillStyle='#dd859a';c.fill();c.strokeStyle=INK;c.lineWidth=2.5;c.stroke();}
      }else if(o.kind==='crate'){
        this.rr(x,y,r.w,r.h,7,'#d3a27c');this.rr(x+6,y+6,r.w-12,r.h-12,3,'#edc69a',INK,1.5);
        c.strokeStyle='#9e6c4e';c.lineWidth=3;c.beginPath();c.moveTo(x+9,y+9);c.lineTo(x+r.w-9,y+r.h-9);c.moveTo(x+r.w-9,y+9);c.lineTo(x+9,y+r.h-9);c.stroke();
      }else this.star(x+r.w/2,y+r.h/2,r.w/2,'#b6a9ba',sim.time*3);
    }
    for(const enemy of sim.level.enemies){
      if(enemy.dead)continue;const x=enemy.x-this.camera,y=g+enemy.y+(enemy.kind==='bee'?Math.sin(sim.time*3+enemy.phase)*12:0);
      if(x<-40||x>w+40)continue;
      if(enemy.kind==='bee'){this.ellipse(x-9,y-32,13,9,'#ffffffb0');this.ellipse(x+9,y-32,13,9,'#ffffffb0');this.rr(x-21,y-29,42,28,13,'#efc367');c.strokeStyle='#9c753d';c.lineWidth=5;c.beginPath();c.moveTo(x-6,y-27);c.lineTo(x-6,y-4);c.stroke();}
      else{this.rr(x-23,y-30,46,29,13,'#bb9bca');this.ellipse(x-10,y-24,7,3,'#dac3e4');for(let j=-16;j<22;j+=13)this.ellipse(x+j,y,5,3,INK);}
      this.ellipse(x+7,y-19,3,4,INK);this.ellipse(x+16,y-19,3,4,INK);this.text('⌢',x+13,y-5,12);
    }
    for(const p of sim.level.pickups){
      if(p.got)continue;const x=p.x-this.camera,y=g+p.y+Math.sin(this.clock*3+p.x)*3;if(x<-40||x>w+40)continue;
      if(p.kind==='sweet')this.star(x,y,8,'#f3c56a',this.clock*.4);
      else if(p.kind==='friend'){const skin=this.skin;this.skin=1;this.ellipse(x,y+15,18,4,'#293d3518');this.blob(x,y+10,29,29,'happy',Math.sin(this.clock*2)*.1);this.skin=skin;this.star(x,y-32,5,'#fff4b8');}
      else{this.ellipse(x,y,24,24,'#fffcdfaa');this.ellipse(x,y,20,20,p.kind==='bubble'?'#b6e3efa0':'#f4a89b');if(p.kind==='bubble'){this.ellipse(x-6,y-6,6,4,'#ffffff');c.strokeStyle='#639ab0';c.lineWidth=2;c.beginPath();c.arc(x,y,19,0,Math.PI*2);c.stroke();}else{c.fillStyle='#e87962';c.beginPath();c.moveTo(x+3,y-10);c.quadraticCurveTo(x+23,y+8,x-14,y+14);c.quadraticCurveTo(x+1,y+5,x-5,y-8);c.fill();c.strokeStyle='#598954';c.lineWidth=3;c.beginPath();c.moveTo(x,y-8);c.quadraticCurveTo(x-5,y-18,x+5,y-16);c.stroke();}}
    }
    for(const p of sim.level.portals){const x=p.x-this.camera,y=g+p.y;if(x<-50||x>w+50)continue;c.save();c.translate(x,y);c.rotate(Math.sin(this.clock)*.08);c.strokeStyle='#a59bcf';c.lineWidth=8;c.beginPath();c.ellipse(0,0,23,43,0,0,Math.PI*2);c.stroke();c.strokeStyle='#eee3ff';c.lineWidth=3;c.stroke();this.star(0,0,12,'#e2d1f3',this.clock);c.restore();}
    for(const cp of sim.level.checkpoints){const x=cp-this.camera;if(x<-40||x>w+40)continue;c.strokeStyle='#7e9c84';c.lineWidth=4;c.beginPath();c.moveTo(x,g);c.lineTo(x,g-75);c.stroke();this.rr(x,g-76,38,26,4,sim.checkpoint.x>=cp?'#91c99c':'#fff4cf');this.text('✦',x+19,g-57,15);}
    if(sim.level.boss)this.drawBoss(sim,g);
    else{
      const x=sim.level.length-this.camera;
      if(x<w+100){this.rr(x-12,g-135,82,135,39,'#a1c5ab');this.rr(x,g-124,58,124,29,'#fcf5df');this.text('↗',x+29,g-47,36);this.star(x+29,g-164,15,'#f3c169',this.clock*.3);}
    }
    if(sim.level.index<2)for(const s of sim.level.signs){const x=s.x-this.camera;if(x>-100&&x<w+100)this.text(s.text,x,g+s.y,15,'#678874');}
    const px=sim.x-this.camera,py=g+sim.y;
    if(sim.fever>0||sim.power==='chili')for(let i=1;i<=6;i++){c.globalAlpha=(1-i/7)*.2;this.ellipse(px-i*14*sim.direction,py-16,21-i,17-i,sim.power==='chili'?'#f0a65d':'#f4d16c');}c.globalAlpha=1;
    if(sim.grounded)this.ellipse(px,py+5,27+sim.charge*8,6,'#293d351c');
    let bw=sim.flat?66:45,bh=sim.flat?22:50;bw+=this.impact*17;bh-=this.impact*12;if(!sim.grounded&&!sim.diving){bw-=5;bh+=7;}
    if(sim.power==='bubble'){this.ellipse(px,py-23,38,43,'#bdeaf347');c.strokeStyle='#75b5ccaa';c.lineWidth=2;c.beginPath();c.ellipse(px,py-23,38,43,0,0,Math.PI*2);c.stroke();this.ellipse(px-21,py-44,7,11,'#ffffff80');}
    if(sim.invincible>0&&Math.sin(this.clock*36)>0)c.globalAlpha=.45;
    this.blob(px,py,bw,bh,sim.state==='dead'?'dead':sim.flat?'squish':!sim.grounded?'air':'happy',!sim.grounded?Math.max(-.2,Math.min(.2,sim.vy*.0003))*sim.direction:0);c.globalAlpha=1;
    if(sim.held&&sim.grounded){this.rr(px-25,py+15,50,5,3,'#293d3525','');if(sim.charge>0)this.rr(px-25,py+15,50*sim.charge,5,3,sim.charge===1?'#ed7594':'#f0b768','');}
    if(sim.diving){c.strokeStyle='#f8ffedaa';c.lineWidth=3;for(let j=-1;j<=1;j++){c.beginPath();c.moveTo(px+j*14,py-50);c.lineTo(px+j*14,py-85);c.stroke();}}
    for(let i=0;i<Math.min(3,sim.friends);i++){const old=this.skin;this.skin=(i+1)%SKINS.length;this.blob(px-(43+i*27)*sim.direction,py+Math.sin(this.clock*7-i)*4,18,19,'happy');this.skin=old;}
    for(let i=this.particles.length-1;i>=0;i--){const p=this.particles[i];p.life-=dt;p.x+=p.vx*dt;p.y+=p.vy*dt;p.vy+=500*dt;if(p.life<=0){this.particles.splice(i,1);continue;}c.globalAlpha=p.life/p.max;this.ellipse(p.x-this.camera,g+p.y,p.size,p.size,p.color);}c.globalAlpha=1;c.restore();
  }
  drawBoss(sim:Simulation,g:number){
    const c=this.ctx,x=sim.bossX-this.camera,y=g+sim.bossY;
    if(x<-200||x>this.width+200)return;
    const oven=sim.level.boss==='oven',king=sim.level.boss==='king';
    c.save();if(sim.bossFlash>0)c.globalAlpha=.5+Math.sin(this.clock*30)*.3;
    // All three machines expose the same gold bounce switch; their silhouettes differ.
    if(oven){
      this.rr(x-67,y+9,134,68,13,'#c2878b');this.rr(x-49,y+29,98,39,8,'#644f55');this.ellipse(x,y+54,28,9,sim.bossTell?'#f3c56a':'#dd9370');this.ellipse(x-46,y+80,16,10,INK);this.ellipse(x+46,y+80,16,10,INK);
    }else{
      this.rr(x-66,y+9,132,64,28,king?'#aaa0cf':'#e3b66e');
      c.strokeStyle=INK;c.lineWidth=4;for(const dx of [-42,42]){c.beginPath();c.moveTo(x+dx,y+60);c.lineTo(x+dx+Math.sin(this.clock*7)*8,y+82);c.stroke();}
      if(king){c.fillStyle='#efd17b';c.beginPath();c.moveTo(x-31,y-5);c.lineTo(x-36,y-34);c.lineTo(x-13,y-19);c.lineTo(x,y-44);c.lineTo(x+14,y-19);c.lineTo(x+36,y-34);c.lineTo(x+31,y-5);c.closePath();c.fill();c.strokeStyle=INK;c.lineWidth=2;c.stroke();}
      else{c.strokeStyle='#859783';c.lineWidth=3;for(let j=-1;j<=1;j++){c.beginPath();c.ellipse(x+j*13,y+44,13,28,0,0,Math.PI*2);c.stroke();}}
    }
    this.rr(x-51,y-3,102,14,7,sim.bossFlash>0?'#fff9e4':'#f6d985');this.star(x,y-14,9,'#fff5c8',this.clock);
    this.ellipse(x-29,y+28,6,7,INK);this.ellipse(x+29,y+28,6,7,INK);
    c.strokeStyle=INK;c.lineWidth=3;c.beginPath();c.moveTo(x-39,y+12);c.lineTo(x-20,y+18);c.moveTo(x+39,y+12);c.lineTo(x+20,y+18);c.stroke();
    if(sim.bossTell){this.ellipse(x,y+49,12,10,'#80504e');this.text('!',x+85,y+15,27,'#b65767');}
    c.restore();
    if(sim.hotPhase){const xx=sim.hotX-this.camera;this.rr(xx-70,g-4,140,8,4,sim.hotPhase===1?'#e8ac6255':'#e58c64','');if(sim.hotPhase===2)for(let j=0;j<8;j++)this.ellipse(xx-60+j*17,g-10-Math.sin(this.clock*15+j)*5,7,14,'#efa85a');}
    for(const shot of sim.shots){const xx=shot.x-this.camera,yy=g+shot.y;
      if(shot.kind==='fall'){this.ellipse(xx,g,25,4,'#bc6b752e');this.star(xx,yy-8,18,'#d9acce',sim.time*3);}
      else{this.ellipse(xx,yy-8,16,13,shot.kind==='wave'?'#d9a778':'#dbaaac');this.ellipse(xx-4,yy-13,5,3,'#f4d6b2');}
    }
    for(const edge of [675,1635]){const xx=edge-this.camera;this.rr(xx-5,g-60,10,60,5,'#a0b996');this.text(edge<1000?'↪':'↩',xx,g-78,25,'#627a69');}
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
