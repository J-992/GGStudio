// Original, locally synthesized score. No downloads or audio permissions beyond a gesture.
export class Audio {
  ctx:AudioContext|null=null;muted=false;musicMuted=false;playing=false;world=0;boss=false;
  private musicBus:GainNode|null=null;private fxBus:GainNode|null=null;private noise:AudioBuffer|null=null;private next=0;private beat=0;private wasPlaying=false;
  unlock(){try{if(!this.ctx){this.ctx=new AudioContext();this.musicBus=this.ctx.createGain();this.fxBus=this.ctx.createGain();this.musicBus.connect(this.ctx.destination);this.fxBus.connect(this.ctx.destination);this.noise=this.ctx.createBuffer(1,this.ctx.sampleRate*.12,this.ctx.sampleRate);const data=this.noise.getChannelData(0);for(let i=0;i<data.length;i++)data[i]=(Math.random()*2-1)*(1-i/data.length);}
    if(this.ctx.state==='suspended')void this.ctx.resume().catch(()=>{});}catch{}}
  private note(f:number,start:number,d:number,volume:number,type:OscillatorType,bus:GainNode,slide=1){const ctx=this.ctx!;const o=ctx.createOscillator(),g=ctx.createGain();o.type=type;o.frequency.setValueAtTime(f,start);if(slide!==1)o.frequency.exponentialRampToValueAtTime(f*slide,start+d);g.gain.setValueAtTime(.0001,start);g.gain.linearRampToValueAtTime(volume,start+.008);g.gain.exponentialRampToValueAtTime(.0001,start+d);o.connect(g).connect(bus);o.start(start);o.stop(start+d+.01);}
  tone(f:number,d=.1,type:OscillatorType='sine',volume=.05,slide=1){if(this.muted||!this.ctx||this.ctx.state!=='running'||!this.fxBus)return;this.note(f,this.ctx.currentTime,d,volume,type,this.fxBus,slide);}
  tick(){
    if(!this.ctx||!this.musicBus||!this.fxBus)return;const t=this.ctx.currentTime;
    this.fxBus.gain.setTargetAtTime(this.muted?0:1,t,.03);this.musicBus.gain.setTargetAtTime(this.muted||this.musicMuted||!this.playing?0:.65,t,.08);
    if(!this.playing||this.muted||this.musicMuted){this.wasPlaying=false;return;}
    if(!this.wasPlaying||this.next<t-.3){this.next=t+.04;this.wasPlaying=true;}
    const step=60/(this.boss?132:110+this.world*5)/2;
    while(this.next<t+.12){this.sequence(this.next,this.beat++);this.next+=step;}
  }
  private sequence(t:number,beat:number){
    const bus=this.musicBus!,ctx=this.ctx!,midi=(n:number)=>440*Math.pow(2,(n-69)/12);
    const root=60+[0,2,5][Math.min(2,this.world)];const scale=this.boss?[0,2,3,7,10,12,14,15]:[0,2,4,7,9,12,14,16];
    const melodies=[[0,2,3,-1,4,3,2,-1,1,2,0,-1,3,4,5,-1,4,3,2,0,1,-1,2,-1,3,2,1,-1,0,-1,-1,-1],[2,-1,3,4,3,-1,0,1,2,-1,4,5,4,2,-1,0],[0,3,4,-1,5,4,3,2,1,-1,2,3,4,-1,2,-1]];
    const melody=melodies[this.world%3],degree=melody[beat%melody.length];
    const section=Math.floor(beat/32)%4;
    if(degree>=0){const f=midi(root+12+scale[degree]);this.note(f,t,.21,.035,'sine',bus);this.note(f*2,t,.09,.009,'sine',bus);if(section===3&&beat%4===0)this.note(f*.5,t,.32,.018,'triangle',bus);}
    const chordIndex=Math.floor(beat/8)%4;
    const chord=(this.boss?[0,5,8,7]:[0,5,9,7])[chordIndex];
    const third=this.boss?(chordIndex===2?4:3):(chordIndex===2?3:4);
    if(beat%4===0){this.note(midi(root-24+chord),t,.32,.065,'triangle',bus);this.note(105,t,.12,.028,'sine',bus,.32);}
    if(beat%8===0)for(const n of [0,third,7])this.note(midi(root+chord+n),t,.7,.012,'sine',bus);
    if(beat%2===1&&this.noise){const n=ctx.createBufferSource(),g=ctx.createGain(),filter=ctx.createBiquadFilter();n.buffer=this.noise;filter.type='highpass';filter.frequency.value=4800;g.gain.value=.025;n.connect(filter).connect(g).connect(bus);n.start(t);}
  }
  play(name:string,count=0){
    if(name==='jump')this.tone(230,.16,'sine',.075,2.5);
    if(name==='land')this.tone(120,.075,'sine',.04,.5);
    if(name==='sweet')this.tone(660+count%5*95,.1,'sine',.035,1.18);
    if(name==='die')this.tone(190,.3,'triangle',.06,.2);
    if(name==='hit')this.tone(150,.17,'triangle',.07,.4);
    if(name==='stomp'||name==='break')this.tone(130,.14,'triangle',.07,3);
    if(name==='spring')this.tone(140,.35,'sine',.09,5);
    if(name==='portal')this.tone(350,.5,'sine',.06,3);
    if(name==='bossHit')this.tone(90,.35,'triangle',.09,5);
    if(name==='friend'||name==='power'||name==='checkpoint'){this.tone(700,.18,'sine',.045,1.5);}
    if(name==='win'&&this.ctx&&this.fxBus&&!this.muted){[523,659,784,1047].forEach((f,i)=>this.note(f,this.ctx!.currentTime+i*.09,.24,.05,'sine',this.fxBus!));}
  }
}
