export class Audio {
  ctx:AudioContext|null=null;muted=false;
  unlock(){try{this.ctx??=new AudioContext();if(this.ctx.state==='suspended')void this.ctx.resume().catch(()=>{});}catch{}}
  tone(f:number,d=.1,type:OscillatorType='sine',volume=.045,slide=1){if(this.muted||!this.ctx||this.ctx.state!=='running')return;const t=this.ctx.currentTime;const o=this.ctx.createOscillator(),g=this.ctx.createGain();o.type=type;o.frequency.setValueAtTime(f,t);o.frequency.exponentialRampToValueAtTime(f*slide,t+d);g.gain.setValueAtTime(.001,t);g.gain.linearRampToValueAtTime(volume,t+.008);g.gain.exponentialRampToValueAtTime(.001,t+d);o.connect(g).connect(this.ctx.destination);o.start();o.stop(t+d+.01);}
  play(name:string,count=0){if(name==='jump')this.tone(230,.18,'sine',.08,2.6);if(name==='land')this.tone(130,.08,'sine',.04,.5);if(name==='sweet')this.tone(650+count%5*110,.12,'sine',.035,1.25);if(name==='die')this.tone(160,.25,'triangle',.07,.25);if(name==='clear')this.tone(500,.07,'sine',.025,1.3);if(name==='win'){[523,659,784,1047].forEach((f,i)=>setTimeout(()=>this.tone(f,.22,'sine',.05),i*95));}}
}
