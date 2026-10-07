'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {GameAudio} from '@/lib/game-audio';
import {CircleDot,Dices,Settings2,Volume2,VolumeX,Maximize,Minimize,RotateCw,Sparkles,X} from 'lucide-react';
import {Tabs,TabsList,TabsTrigger,TabsContent} from '@/components/ui/tabs';
import {Sheet,SheetContent,SheetTitle,SheetDescription,SheetClose} from '@/components/ui/sheet';
import {Slider} from '@/components/ui/slider';
import {Switch} from '@/components/ui/switch';
import {Input} from '@/components/ui/input';
import {SECTORS,KINDS,DEFAULT_CONFIG,normalizeConfig,activeWeights,randomSector,targetRotation,targetDice,type Config,type GameMode} from '@/lib/roulette';

const DETAILS={brinde:'Aê! Mostre o resultado à equipe e retire seu brinde.',super:'Uau! O super brinde é seu! Mostre o resultado à equipe.',retry:'Você tem outra chance. Pode jogar de novo!',miss:'Valeu por participar do Rolê da Extensão!'};
const GROUP_NAMES=['Brinde','Tente novamente','Não foi dessa vez','Super Brinde'];
const GROUP_EMOJI=['🎁','😎','🙃','😍'];
const KEY='role-extension-settings-v3';
type Registry={registerTool:(tool:Record<string,unknown>,options:{signal:AbortSignal})=>void|Promise<void>};
function polar(angle:number,radius:number){const a=angle*Math.PI/180;return [Math.round((300+Math.cos(a)*radius)*1000)/1000,Math.round((300+Math.sin(a)*radius)*1000)/1000];}

export default function Home(){
 const [mode,setMode]=useState<GameMode>('wheel'),[config,setConfig]=useState<Config>(DEFAULT_CONFIG),[settings,setSettings]=useState(false);
 const [spinning,setSpinning]=useState(false),[result,setResult]=useState<number|null>(null),[progress,setProgress]=useState(0),[remaining,setRemaining]=useState(0),[celebration,setCelebration]=useState(0),[error,setError]=useState('');
 const [rotation,setRotation]=useState(0),[diceAngles,setDiceAngles]=useState({x:0,y:0}),[fullscreen,setFullscreen]=useState(false),[canFullscreen,setCanFullscreen]=useState(false),[ready,setReady]=useState(false);
 const wheelRef=useRef<HTMLDivElement>(null),diceRef=useRef<HTMLDivElement>(null);
 const configRef=useRef(config),modeRef=useRef(mode),resultRef=useRef(result),lock=useRef(false),wheelAngle=useRef(0),diceAngle=useRef({x:0,y:0}),audio=useRef<GameAudio|null>(null);
 const animations=useRef<Animation[]>([]),timeouts=useRef<ReturnType<typeof setTimeout>[]>([]),interval=useRef<ReturnType<typeof setInterval>|null>(null),pending=useRef<((value:unknown)=>void)|null>(null),mounted=useRef(true);
 configRef.current=config;modeRef.current=mode;resultRef.current=result;
 const clearDraw=useCallback(()=>{audio.current?.stop();timeouts.current.forEach(clearTimeout);timeouts.current=[];if(interval.current)clearInterval(interval.current);interval.current=null;animations.current.forEach(a=>a.cancel());animations.current=[];},[]);
 const draw=useCallback(():Promise<unknown>=>{
  if(lock.current)return Promise.reject(new Error('Aguarde o sorteio terminar.'));
  const opts=configRef.current,game=modeRef.current;
  let index:number;
  try{index=randomSector(activeWeights(opts));}catch(e){const message=e instanceof Error?e.message:'Não foi possível iniciar. Tente novamente.';setError(message);return Promise.reject(new Error(message));}
  const element=game==='wheel'?wheelRef.current:diceRef.current;
  if(!element){setError('A dinâmica está carregando. Tente novamente.');return Promise.reject(new Error('Dinâmica indisponível'));}
  clearDraw();lock.current=true;setError('');setResult(null);resultRef.current=null;setCelebration(0);setSpinning(true);setProgress(0);
  // A requested draw always follows its configured duration; reduce decorative effects separately.
  const seconds=game==='wheel'?opts.wheelSeconds:opts.diceSeconds,ms=seconds*1000;
  setRemaining(seconds);
  audio.current??=new GameAudio();audio.current.unlock(opts.sound,opts.soundVolume);audio.current.setVisible(!document.hidden);
  const start=performance.now();let target:string;let frames:Keyframe[];
  if(game==='wheel'){
   const from=wheelAngle.current,to=targetRotation(from,index,seconds),delta=to-from;
   target=`rotate(${to}deg)`;
   frames=[{transform:`rotate(${from}deg)`,offset:0,easing:'cubic-bezier(.55,0,.8,.6)'},{transform:`rotate(${from+delta*.12}deg)`,offset:.18,easing:'linear'},{transform:`rotate(${from+delta*.8}deg)`,offset:.65,easing:'cubic-bezier(.08,.5,.12,1)'},{transform:target,offset:1}];
   wheelAngle.current=to;
  }else{
   const from=diceAngle.current,to=targetDice(from,index);target=`rotateX(${to.x}deg) rotateY(${to.y}deg) rotateZ(0deg)`;
   frames=[{transform:`rotateX(${from.x}deg) rotateY(${from.y}deg) rotateZ(0deg)`,offset:0,easing:'ease-in'},{transform:`rotateX(${from.x+500}deg) rotateY(${from.y+660}deg) rotateZ(18deg)`,offset:.25,easing:'linear'},{transform:`rotateX(${to.x-160}deg) rotateY(${to.y-180}deg) rotateZ(-12deg)`,offset:.72,easing:'ease-out'},{transform:`rotateX(${to.x+12}deg) rotateY(${to.y-8}deg) rotateZ(3deg)`,offset:.92,easing:'ease-out'},{transform:target,offset:1}];
   diceAngle.current=to;
  }
  return new Promise(resolve=>{
   pending.current=resolve;let done=false;
   const finish=()=>{
    if(done||!mounted.current)return;done=true;
    element.style.transition='none';element.style.transform=target;
    clearDraw();if(game==='wheel')setRotation(wheelAngle.current);else setDiceAngles({...diceAngle.current});
    lock.current=false;setProgress(100);setRemaining(0);setResult(index);resultRef.current=index;setSpinning(false);
    const won=SECTORS[index].kind==='brinde'||SECTORS[index].kind==='super';
    if(won&&opts.confetti){setCelebration(Date.now());timeouts.current.push(setTimeout(()=>setCelebration(0),4000));}
    audio.current?.result(SECTORS[index].kind,game);
    resolve({mode:game,face:index+1,result:SECTORS[index].label});pending.current=null;
   };
   let visualAnimation:Animation|null=null,soundFrames=frames;
   const fallback=()=>{element.style.transition=`transform ${ms}ms cubic-bezier(.2,.1,.1,1)`;element.getBoundingClientRect();element.style.transform=target;soundFrames=[{...frames[0],offset:0,easing:'cubic-bezier(.2,.1,.1,1)'},{...frames[frames.length-1],offset:1}];};
   if(typeof element.animate==='function'){
    try{visualAnimation=element.animate(frames,{duration:ms,fill:'forwards',easing:'linear'});animations.current.push(visualAnimation);visualAnimation.onfinish=finish;}catch{fallback();}
   }else{fallback();}
   audio.current?.follow(game,soundFrames,seconds,()=>typeof visualAnimation?.currentTime==='number'?visualAnimation.currentTime/1000:(performance.now()-start)/1000);
   timeouts.current.push(setTimeout(finish,ms+80));
   interval.current=setInterval(()=>{const elapsed=performance.now()-start;setProgress(Math.min(99,elapsed/ms*100));setRemaining(Math.max(0,Math.ceil((ms-elapsed)/1000)));},150);
  });
 },[clearDraw]);
 const drawRef=useRef(draw);drawRef.current=draw;
 useEffect(()=>{
  mounted.current=true;try{const saved=localStorage.getItem(KEY);if(saved)setConfig(normalizeConfig(JSON.parse(saved)));}catch{/* Device preferences are optional. */}setReady(true);
  setCanFullscreen(Boolean(document.documentElement.requestFullscreen));
  const fs=()=>setFullscreen(Boolean(document.fullscreenElement));
  const key=(e:KeyboardEvent)=>{if(e.code!=='Space'||e.repeat||e.altKey||e.ctrlKey||e.metaKey||(e.target as HTMLElement)?.closest('button,a,input,textarea,select,[role=dialog],[contenteditable]'))return;e.preventDefault();void drawRef.current().catch(()=>{});};
  const visibility=()=>{audio.current?.setVisible(!document.hidden);if(!document.hidden)audio.current?.unlock(configRef.current.sound,configRef.current.soundVolume);};
  document.addEventListener('fullscreenchange',fs);document.addEventListener('keydown',key);document.addEventListener('visibilitychange',visibility);
  const registry=(document as Document&{modelContext?:Registry}).modelContext,life=new AbortController();
  if(registry?.registerTool){try{
   void Promise.resolve(registry.registerTool({name:'draw_extension_prize',description:'Sorteia na dinâmica selecionada (roleta ou dado), usando as chances visíveis. Retorna o resultado somente após a animação.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:false},execute:(input:unknown)=>{if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length)return Promise.reject(new Error('Envie um objeto vazio.'));return drawRef.current();}},{signal:life.signal})).catch(()=>{});
   void Promise.resolve(registry.registerTool({name:'get_extension_draw_state',description:'Lê a dinâmica, o resultado e as configurações atuais do sorteio.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:false},execute:(input:unknown)=>{if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length)throw new Error('Envie um objeto vazio.');return {mode:modeRef.current,spinning:lock.current,result:resultRef.current===null?null:SECTORS[resultRef.current].label,settings:configRef.current};}},{signal:life.signal})).catch(()=>{});
  }catch{/* Optional browser registry. */}}
  return()=>{mounted.current=false;clearDraw();pending.current?.({cancelled:true});lock.current=false;audio.current?.dispose();life.abort();document.removeEventListener('fullscreenchange',fs);document.removeEventListener('keydown',key);document.removeEventListener('visibilitychange',visibility);};
 },[clearDraw]);
 useEffect(()=>{if(ready){try{localStorage.setItem(KEY,JSON.stringify(config));}catch{/* Device preference. */}}},[config,ready]);
 function changeMode(value:string){if(lock.current)return;setMode(value as GameMode);setResult(null);resultRef.current=null;setProgress(0);setCelebration(0);setError('');}
 function update(patch:Partial<Config>){const next=normalizeConfig({...configRef.current,...patch});configRef.current=next;if(patch.sound!==undefined||patch.soundVolume!==undefined){audio.current??=new GameAudio();audio.current.unlock(next.sound,next.soundVolume);}setConfig(next);}
 async function toggleFullscreen(){try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{setError('O navegador não permitiu abrir em tela cheia.');}}
 const weights=activeWeights(config),total=weights.reduce((a,b)=>a+b,0),face=result===null?null:SECTORS[result];
 const play=()=>{void draw().catch(()=>{});};
 return <main className="game-shell">
  <header className="topbar"><a className="brand-lockup" href="https://proex.ufg.br/" target="_blank" rel="noreferrer" aria-label="Conheça a PROEX UFG"><img className="proex-logo" src="brand/proex.png" width="560" height="295" alt="PROEX — Pró-Reitoria de Extensão"/><span className="brand-divider"/><img className="ufg-logo" src="brand/ufg-white.png" width="652" height="335" alt="Universidade Federal de Goiás"/></a><div className="toolbar"><button className="icon-button" onClick={()=>update({sound:!config.sound})} title={config.sound?'Desativar som':'Ativar som'} aria-label={config.sound?'Desativar som':'Ativar som'} aria-pressed={config.sound}>{config.sound?<Volume2/>:<VolumeX/>}</button>{canFullscreen&&<button className="icon-button" onClick={toggleFullscreen} aria-label={fullscreen?'Sair da tela cheia':'Tela cheia'} title="Tela cheia">{fullscreen?<Minimize/>:<Maximize/>}</button>}<button className="settings-button" onClick={()=>setSettings(true)} aria-label="Configurar sorteio"><Settings2/><span>Configurar</span></button></div></header>
  <div className="game-heading"><span className="event-eyebrow">PROEX UFG APRESENTA</span><h1>Rolê da <em>Extensão</em><span aria-hidden="true"> 😎</span></h1></div>
  <Tabs value={mode} onValueChange={changeMode} className="game-tabs"><TabsList className="mode-switch" aria-label="Escolha a dinâmica"><TabsTrigger value="wheel" disabled={spinning}><CircleDot/>Roleta</TabsTrigger><TabsTrigger value="dice" disabled={spinning}><Dices/>Super Dado</TabsTrigger></TabsList>
   <div className="game-layout">
    <div className={`stage-panel ${spinning?'is-spinning':''}`}>
     <TabsContent value="wheel" className="stage-content"><div className="wheel-stage"><div className="wheel-backdrop"/><div className="wheel-lights" aria-hidden="true">{Array.from({length:24},(_,i)=><i key={i} style={{transform:`rotate(${i*15}deg) translateY(calc(var(--wheel-size) * -.455))`}}/>)}</div><div className="wheel-pointer" aria-hidden="true">▼</div><div className="wheel-rotor" ref={wheelRef} style={{transform:`rotate(${rotation}deg)`}}><svg viewBox="0 0 600 600" className="wheel" role="img" aria-label="Seis setores: três Brindes, Tente novamente, Super Brinde e Não foi dessa vez">{SECTORS.map((s,i)=>{const a=polar(-120+i*60,280),b=polar(-60+i*60,280);return <g key={s.id}><path d={`M300 300 L${a[0]} ${a[1]} A280 280 0 0 1 ${b[0]} ${b[1]} Z`} fill={s.color} stroke="#fff" strokeWidth="3"/><g transform={`rotate(${i*60} 300 300)`} fill={s.ink} textAnchor="middle"><text x="300" y="102" className="sector-emoji">{s.emoji}</text><text x="300" y={s.lines.length>1?139:161} className={`sector-label ${s.lines.length>1?'sector-multiline':''} ${s.kind==='super'?'sector-super':''}`}>{s.lines.map((line,j)=><tspan x="300" key={line} dy={j?32:0}>{line}</tspan>)}</text></g></g>;})}<circle cx="300" cy="300" r="283" fill="none" stroke="#fff" strokeWidth="12"/></svg></div><button className="wheel-hub" disabled={spinning||!total} onClick={play} aria-label="Girar roleta"><span aria-hidden="true">🎁</span><small>GIRA!</small></button></div><p className="stage-caption">{spinning?'Torcida liberada! 🤞':'Toque no botão ou no centro da roleta.'}</p></TabsContent>
     <TabsContent value="dice" className="stage-content"><button className={`dice-play ${spinning?'tumbling':''}`} onClick={play} disabled={spinning||!total} aria-label="Lançar Super Dado"><div className="dice-scene"><div className="dice-camera"><div className="dice-cube" ref={diceRef} style={{transform:`rotateX(${diceAngles.x}deg) rotateY(${diceAngles.y}deg) rotateZ(0deg)`}}>{SECTORS.map((s,i)=><div className={`dice-face face-${i}`} key={s.id} style={{background:s.color,color:s.ink}}><span className="face-number">{i+1}/6</span><span className="face-emoji" aria-hidden="true">{s.emoji}</span><strong>{s.lines.map((line,j)=><span key={line}>{j>0&&<br/>}{line}</span>)}</strong><span className="face-brand">ROLÊ DA EXTENSÃO</span></div>)}</div></div></div><span className="dice-shadow"/></button><p className="stage-caption">{spinning?'Rolando… qual face vai sair? 🎲':'Toque no dado e veja qual face fica na frente.'}</p></TabsContent>
    </div>
    <section className="control-panel" aria-label="Controles e resultado"><div className={`result-card ${face?`result-${face.kind}`:''}`} role="status" aria-live="polite" aria-atomic="true" data-result={face?.kind??(spinning?'spinning':'ready')} data-face={result===null?'':result+1}><span className={`result-emoji ${spinning?'anticipating':''}`} aria-hidden="true">{spinning?'🤞':face?.emoji??'🍀'}</span><span className="result-kicker">{spinning?'SEGURA A EMOÇÃO!':face?'SEU RESULTADO':'BORA PARTICIPAR?'}</span><h2>{spinning?(mode==='wheel'?'A roleta tá girando!':'O dado tá rolando!'):face?.label??'A sorte tá no rolê.'}</h2><p>{spinning?'Torça aí. A surpresa já vem!':face?DETAILS[face.kind]:mode==='wheel'?'Um giro para descobrir sua surpresa.':'Seis faces, um resultado. Lance o dado!'}</p>{spinning&&<div className="draw-progress"><div className="progress-track"><span style={{transform:`scaleX(${progress/100})`}}/></div><span>{remaining>0?`${remaining} s`:'Revelando…'}</span></div>}</div><button className="play-button" onClick={play} disabled={spinning||!total}><span aria-hidden="true">{mode==='wheel'?'🎡':'🎲'}</span>{spinning?'SORTEANDO…':face?.kind==='retry'?'TENTAR NOVAMENTE':mode==='wheel'?'GIRAR ROLETA':'LANÇAR O DADO'}</button><div className="control-meta"><span>⏱ {mode==='wheel'?config.wheelSeconds:config.diceSeconds} segundos</span><button onClick={()=>setSettings(true)}>Ajustar</button></div>{error&&<p className="error-message" role="alert">{error}</p>}{!total&&<p className="error-message" role="alert">Configure ao menos uma chance maior que zero.</p>}<p className="keyboard-hint">No computador, aperte <kbd>espaço</kbd> para jogar.</p></section>
   </div>
  </Tabs>
  <footer className="game-footer"><div className="odds-heading"><span>{config.customOdds?'CHANCES PERSONALIZADAS':'6 FACES · CHANCES IGUAIS'}</span><small>{config.customOdds?'Os percentuais abaixo valem para as duas dinâmicas.':'3 Brindes + 1 de cada outro resultado'}</small></div><ul className="odds-list">{GROUP_NAMES.map((label,i)=><li key={label}><span aria-hidden="true">{GROUP_EMOJI[i]}</span><div><strong>{label}</strong><span>{total?new Intl.NumberFormat('pt-BR',{maximumFractionDigits:2}).format(weights[i]/total*100):'0'}%</span></div></li>)}</ul><a href="https://proex.ufg.br/" target="_blank" rel="noreferrer">Conheça a PROEX UFG</a></footer>
  <Sheet open={settings} onOpenChange={setSettings}><SheetContent className="settings-sheet" showCloseButton={false}><div className="settings-header"><div><SheetTitle>Do seu jeito ⚙️</SheetTitle><SheetDescription>Os ajustes ficam salvos neste aparelho.</SheetDescription></div><SheetClose className="sheet-close" aria-label="Fechar configurações"><X/></SheetClose></div><div className="settings-scroll">{spinning&&<p className="settings-notice">Aguarde o sorteio terminar para mudar os ajustes.</p>}<fieldset disabled={spinning}><legend>Tempo da animação</legend><div className="setting"><label htmlFor="wheel-duration">🎡 Roleta <strong>{config.wheelSeconds} s</strong></label><Slider id="wheel-duration" aria-label="Duração da roleta em segundos" min={3} max={30} step={1} value={[config.wheelSeconds]} onValueChange={v=>update({wheelSeconds:v[0]})} disabled={spinning}/><div className="range-labels"><span>3 s</span><span>30 s</span></div></div><div className="setting"><label htmlFor="dice-duration">🎲 Super Dado <strong>{config.diceSeconds} s</strong></label><Slider id="dice-duration" aria-label="Duração do dado em segundos" min={2} max={20} step={1} value={[config.diceSeconds]} onValueChange={v=>update({diceSeconds:v[0]})} disabled={spinning}/><div className="range-labels"><span>2 s</span><span>20 s</span></div></div></fieldset><fieldset disabled={spinning}><legend>Clima do rolê</legend><div className="toggle-setting"><div><label htmlFor="sound-setting">🔊 Efeitos sonoros</label><p>Cliques da roleta, impactos do dado e comemoração.</p></div><Switch id="sound-setting" checked={config.sound} onCheckedChange={v=>update({sound:v})} disabled={spinning}/></div><div className="setting"><label htmlFor="sound-volume">Volume dos efeitos <strong>{config.soundVolume}%</strong></label><Slider id="sound-volume" aria-label="Volume dos efeitos sonoros" min={0} max={100} step={5} value={[config.soundVolume]} onValueChange={v=>update({soundVolume:v[0]})} disabled={spinning||!config.sound}/><div className="range-labels"><span>Silencioso</span><span>100%</span></div></div><div className="toggle-setting"><div><label htmlFor="confetti-setting">🎉 Chuva de confetes</label><p>Comemore os brindes e o super brinde.</p></div><Switch id="confetti-setting" checked={config.confetti} onCheckedChange={v=>update({confetti:v})} disabled={spinning}/></div></fieldset><fieldset disabled={spinning}><legend>Chances do sorteio</legend><div className="toggle-setting"><div><label htmlFor="custom-odds">Personalizar chances</label><p>Os percentuais ativos ficam visíveis para todos.</p></div><Switch id="custom-odds" checked={config.customOdds} onCheckedChange={v=>update({customOdds:v})} disabled={spinning}/></div>{config.customOdds?<div className="weight-settings"><p>Defina um peso de 0 a 100. Peso zero tira esse resultado do sorteio. A roleta mantém os seis setores; as chances passam a seguir os percentuais exibidos.</p>{GROUP_NAMES.map((label,i)=><div className="weight-row" key={label}><label htmlFor={`weight-${i}`}>{GROUP_EMOJI[i]} {label}</label><Input id={`weight-${i}`} type="number" min={0} max={100} step={1} value={config.weights[i]} disabled={spinning} onChange={e=>{const weights=[...config.weights];weights[i]=Number(e.target.value);update({weights});}}/></div>)}</div>:<p className="settings-help">Padrão: cada face tem 1/6 de chance. São três faces de Brinde e uma de cada outro resultado.</p>}</fieldset><p className="settings-help">Os giros seguem o tempo escolhido. Com a chuva de confetes ativada, Brinde e Super Brinde ganham comemoração.</p><button className="reset-button" disabled={spinning} onClick={()=>update({...DEFAULT_CONFIG,weights:[3,1,1,1]})}>Restaurar configuração original</button></div><div className="settings-bottom"><SheetClose className="apply-button">Pronto, bora jogar!</SheetClose></div></SheetContent></Sheet>
  {celebration>0&&<div key={celebration} className="confetti" aria-hidden="true">{Array.from({length:face?.kind==='super'?72:42},(_,i)=><i key={i} className="confetti-particle" style={{left:`${(i*37)%100}%`,background:['#FFAA3D','#77DCE5','#ED55BE','#FFDB5C','#FFFFFF'][i%5],animationDelay:`${i%9*.06}s`,width:`${7+i%5}px`}}/>)}</div>}
 </main>;
}
