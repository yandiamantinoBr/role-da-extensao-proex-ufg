export type Outcome = 'brinde' | 'retry' | 'miss' | 'super';
export type GameMode = 'wheel' | 'dice';
export type Config = { wheelSeconds:number; diceSeconds:number; sound:boolean; soundVolume:number; confetti:boolean; customOdds:boolean; weights:number[] };
export const DEFAULT_CONFIG:Config = {wheelSeconds:12,diceSeconds:6,sound:true,soundVolume:60,confetti:true,customOdds:false,weights:[3,1,1,1]};
export const KINDS:Outcome[] = ['brinde','retry','miss','super'];
export const SECTORS = [
 {id:'brinde-1',kind:'brinde' as Outcome,label:'Brinde',lines:['Brinde'],color:'#FFAA3D',ink:'#3B1753',emoji:'😁'},
 {id:'tente-novamente',kind:'retry' as Outcome,label:'Tente novamente',lines:['Tente','novamente'],color:'#F5F0FC',ink:'#642582',emoji:'😎'},
 {id:'brinde-2',kind:'brinde' as Outcome,label:'Brinde',lines:['Brinde'],color:'#77DCE5',ink:'#263B5C',emoji:'😄'},
 {id:'super-brinde',kind:'super' as Outcome,label:'Super Brinde',lines:['SUPER','BRINDE'],color:'#8E35BD',ink:'#FFFFFF',emoji:'😍'},
 {id:'nao-foi-dessa-vez',kind:'miss' as Outcome,label:'Não foi dessa vez',lines:['Não foi','dessa vez'],color:'#5C6C89',ink:'#FFFFFF',emoji:'🙃'},
 {id:'brinde-3',kind:'brinde' as Outcome,label:'Brinde',lines:['Brinde'],color:'#ED55BE',ink:'#411342',emoji:'🥳'},
];
export function normalizeConfig(value:unknown):Config {
 const x=value&&typeof value==='object'?value as Partial<Config>:{};
 const num=(v:unknown,d:number,min:number,max:number)=>typeof v==='number'&&Number.isFinite(v)?Math.max(min,Math.min(max,Math.round(v))):d;
 return {wheelSeconds:num(x.wheelSeconds,12,3,30),diceSeconds:num(x.diceSeconds,6,2,20),sound:typeof x.sound==='boolean'?x.sound:true,soundVolume:num(x.soundVolume,60,0,100),confetti:typeof x.confetti==='boolean'?x.confetti:true,customOdds:typeof x.customOdds==='boolean'?x.customOdds:false,weights:KINDS.map((_,i)=>num(x.weights?.[i],DEFAULT_CONFIG.weights[i],0,100))};
}
export function activeWeights(config:Config):number[] {return config.customOdds?config.weights:[3,1,1,1];}
export function randomInt(max:number,random:Pick<Crypto,'getRandomValues'>=globalThis.crypto):number {
 if(!Number.isInteger(max)||max<1||max>1000000)throw new Error('Chances inválidas.');
 if(!random?.getRandomValues)throw new Error('Este navegador não oferece sorteio seguro. Abra no Chrome ou Safari atualizado.');
 const a=new Uint32Array(1),limit=Math.floor(2**32/max)*max;
 do{random.getRandomValues(a);}while(a[0]>=limit);
 return a[0]%max;
}
export function randomSector(weights:number[]=[3,1,1,1],random:Pick<Crypto,'getRandomValues'>=globalThis.crypto):number {
 if(weights.length!==4||weights.some(x=>!Number.isInteger(x)||x<0||x>100))throw new Error('Chances inválidas.');
 const total=weights.reduce((a,b)=>a+b,0);if(!total)throw new Error('Escolha ao menos uma chance maior que zero.');
 let ticket=randomInt(total,random),group=0;
 while(ticket>=weights[group]){ticket-=weights[group];group++;}
 const faces=SECTORS.map((face,i)=>({face,i})).filter(x=>x.face.kind===KINDS[group]);
 return faces[faces.length===1?0:randomInt(faces.length,random)].i;
}
export function targetRotation(current:number,index:number,seconds=12):number {
 if(!Number.isInteger(index)||index<0||index>=6)throw new Error('Face inválida');
 const normalized=((current%360)+360)%360,destination=(360-index*60)%360;
 return current+360*Math.max(6,Math.round(seconds*1.65))+(destination-normalized+360)%360;
}
export const DICE_ORIENTATIONS = [{x:0,y:0},{x:0,y:-90},{x:0,y:-180},{x:0,y:90},{x:-90,y:0},{x:90,y:0}];
export function targetDice(current:{x:number;y:number},index:number):{x:number;y:number} {
 const face=DICE_ORIENTATIONS[index];if(!face)throw new Error('Face inválida');
 return {x:Math.ceil(current.x/360)*360+1080+face.x,y:Math.ceil(current.y/360)*360+1440+face.y};
}
