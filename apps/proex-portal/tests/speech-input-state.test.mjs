import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

const root=new URL('../',import.meta.url),tick=()=>new Promise(resolve=>setImmediate(resolve));
const text=node=>typeof node==='string'?node:Array.isArray(node)?node.map(text).join(''):node&&typeof node==='object'?text(node.props?.children):'';
function sampleWav(){const data=new Uint8Array(32044),view=new DataView(data.buffer),ascii=(at,value)=>Array.from(value).forEach((char,index)=>view.setUint8(at+index,char.charCodeAt(0)));ascii(0,'RIFF');view.setUint32(4,data.length-8,true);ascii(8,'WAVE');ascii(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,16000,true);view.setUint32(28,32000,true);view.setUint16(32,2,true);view.setUint16(34,16,true);ascii(36,'data');view.setUint32(40,32000,true);for(let i=0;i<16000;i++)view.setInt16(44+i*2,Math.sin(i*.1)*3000,true);return data;}
function harness({denyMicrophone=false,provider,extra={}}={}){
 const slots=[],effects=[],requests=[],reviewed=[],cache=new Map(),recorders=[],props={...extra};let index=0,tree,stopped=0,mediaRequests=0,objectUrls=0;
 const hooks={useState(initial){const key=index++;if(!(key in slots))slots[key]=typeof initial==='function'?initial():initial;return[slots[key],value=>{slots[key]=typeof value==='function'?value(slots[key]):value;}];},useRef(initial){const key=index++;slots[key]??={current:initial};return slots[key];},useEffect(callback){const key=index++;if(!(key in slots)){slots[key]=true;effects.push(callback());}}};
 const jsx={jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})};
 class FakeRecorder{static isTypeSupported(){return false;}constructor(){this.mimeType='audio/wav';this.state='inactive';recorders.push(this);}start(){this.state='recording';}stop(){this.state='inactive';this.ondataavailable?.({data:new Blob([sampleWav()],{type:'audio/wav'})});this.onstop?.();}}
 function load(file){if(cache.has(file))return cache.get(file);const compiledModule={exports:{}};cache.set(file,compiledModule.exports);const require=name=>name==='react'?hooks:name==='react/jsx-runtime'?jsx:load(`${path.posix.normalize(path.posix.join(path.posix.dirname(file),name))}.ts`);const source=ts.transpileModule(readFileSync(new URL(file,root),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  vm.runInNewContext(source,{module:compiledModule,exports:compiledModule.exports,require,Error,File,Blob,FormData,AbortController,TextEncoder,TextDecoder,Uint8Array,DataView,ArrayBuffer,crypto,setTimeout,clearTimeout,URL:{createObjectURL:()=>`blob:synthetic-${++objectUrls}`,revokeObjectURL(){}},MediaRecorder:FakeRecorder,navigator:{mediaDevices:{getUserMedia:async()=>{mediaRequests++;if(denyMicrophone)throw new Error('Microfone negado no teste');return{getTracks:()=>[{stop:()=>{stopped++;}}]};}}},fetch:(url,init)=>new Promise((resolve,reject)=>{requests.push({url,init,resolve,reject});init.signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')));})});return compiledModule.exports;
 }
 const Component=load('components/portal/speech-input.tsx').default;
 function nodes(){const result=[];function visit(node){if(!node||typeof node!=='object')return;if(Array.isArray(node)){node.forEach(visit);return;}result.push(node);visit(node.props?.children);}visit(tree);return result;}
 const h={requests,reviewed,recorders,props,render(){index=0;tree=Component({projectId:'project-a',available:true,provider,...props,onReviewedText:value=>reviewed.push(value)});},find(type,predicate){const found=nodes().find(node=>node.type===type&&predicate(node));assert.ok(found,type);return found;},button(name){return h.find('button',node=>text(node).trim()===name);},text(){return text(tree);},consent(){h.find('input',node=>node.props.type==='checkbox').props.onChange({target:{checked:true}});h.render();},choose(){h.find('input',node=>node.props.type==='file').props.onChange({target:{files:[new File([sampleWav()],'synthetic.wav',{type:'audio/wav'})],value:'synthetic.wav'}});h.render();},dispose(){effects.forEach(cleanup=>cleanup?.());},get stopped(){return stopped;},get mediaRequests(){return mediaRequests;}};h.render();return h;
}

test('recording and transcription stage editable text; only explicit review fills the assistant request',async()=>{
 const h=harness();try{
  assert.equal(h.mediaRequests,0);assert.equal(h.button('Gravar áudio').props.disabled,true);h.consent();h.button('Gravar áudio').props.onClick();await tick();h.render();assert.equal(h.mediaRequests,1);assert.equal(h.requests.length,0);
  h.button('Parar gravação').props.onClick();h.render();assert.ok(h.find('audio',node=>node.props.controls));assert.equal(h.stopped,1);assert.equal(h.reviewed.length,0);
  h.button('Solicitar transcrição').props.onClick();await tick();h.render();assert.equal(h.requests.length,1);assert.equal(h.requests[0].url,'/api/assistant/speech');assert.equal(h.requests[0].init.body.get('projectId'),'project-a');assert.equal(h.requests[0].init.body.get('audio').type,'audio/wav');
  h.requests[0].resolve({ok:true,json:async()=>({transcript:'entrada de 10 canetas'})});await tick();h.render();assert.equal(h.reviewed.length,0);const textarea=h.find('textarea',()=>true);textarea.props.onChange({target:{value:'entrada de 12 canetas conferidas'}});h.render();h.button('Usar transcrição revisada no pedido').props.onClick();assert.deepEqual(h.reviewed,['entrada de 12 canetas conferidas']);assert.equal(h.requests.length,1);
 }finally{h.dispose();}
});
test('microphone rejection leaves file upload usable and provider failure preserves audio until an explicit new attempt',async()=>{
 const h=harness({denyMicrophone:true});try{
  h.consent();h.button('Gravar áudio').props.onClick();await tick();h.render();assert.match(h.text(),/Microfone negado/);assert.equal(h.requests.length,0);h.choose();h.button('Solicitar transcrição').props.onClick();await tick();const firstKey=h.requests[0].init.body.get('operationKey');h.requests[0].resolve({ok:false,json:async()=>({error:'Provedor sintético indisponível'})});await tick();h.render();assert.match(h.text(),/Provedor sintético/);assert.ok(h.find('audio',()=>true));assert.equal(h.reviewed.length,0);
  h.button('Autorizar nova tentativa paga').props.onClick();h.render();assert.equal(h.requests.length,1);h.button('Solicitar transcrição').props.onClick();await tick();assert.equal(h.requests.length,2);assert.notEqual(h.requests[1].init.body.get('operationKey'),firstKey);
 }finally{h.dispose();}
});
test('Groq consent names the provider and sends the expected provider with the audio',async()=>{
 const h=harness({provider:'groq'});
 try{
  assert.match(h.text(),/Autorizo gravar e enviar este áudio à Groq/);
  h.choose();
  assert.equal(h.button('Solicitar transcrição').props.disabled,true);
  h.consent();
  h.button('Solicitar transcrição').props.onClick();
  await tick();
  assert.equal(h.requests.length,1);
  assert.equal(h.requests[0].init.body.get('provider'),'groq');
  assert.equal(h.requests[0].init.body.get('consent'),'true');
 }finally{h.dispose();}
});
test('unmount cancels an in-flight upload and a late transcript cannot fill another project request',async()=>{
 const h=harness();h.consent();h.choose();h.button('Solicitar transcrição').props.onClick();await tick();assert.equal(h.requests.length,1);h.dispose();assert.equal(h.requests[0].init.signal.aborted,true);h.requests[0].resolve({ok:true,json:async()=>({transcript:'must not be staged'})});await tick();assert.equal(h.reviewed.length,0);
});
// Modelo de voz escolhido no catálogo: o nome na tela, o destino enviado e o teto mostrado são os do modelo escolhido.
const ROUTE={destination:'catalog:groq-whisper-turbo',routeModel:{label:'Whisper turbo (Groq)',service:'Groq',perHour:0.04,style:'groq'}};
test('without a chosen voice model the texts and the provider sent stay exactly as today',async()=>{
 const h=harness();
 try{
  assert.match(h.text(),/A Deepgram recebe o áudio somente ao solicitar transcrição, com exclusão do programa de melhoria de modelos\./);
  assert.match(h.text(),/Autorizo gravar e enviar este áudio à Deepgram para transcrição\. Evitei informações pessoais e segredos\./);
  assert.doesNotMatch(h.text(),/Custo máximo|modelo de voz/);
  h.consent();h.choose();h.button('Solicitar transcrição').props.onClick();await tick();
  assert.equal(h.requests[0].init.body.get('provider'),'deepgram');
 }finally{h.dispose();}
});
test('a chosen voice model is named in the notice and in the consent, shows its cost ceiling and is the destination sent',async()=>{
 const h=harness({extra:ROUTE});
 try{
  assert.match(h.text(),/O modelo de voz Whisper turbo \(Groq\) recebe o áudio somente ao solicitar transcrição\. O processamento segue a política de dados desse serviço\. Custo máximo por áudio: US\$\s0,0010\./);
  assert.match(h.text(),/Autorizo gravar e enviar este áudio ao modelo de voz Whisper turbo \(Groq\) para transcrição\. Evitei informações pessoais e segredos\./);
  assert.doesNotMatch(h.text(),/Deepgram/,'the default provider is not named when the audio goes elsewhere');
  h.choose();assert.equal(h.button('Solicitar transcrição').props.disabled,true);
  h.consent();h.button('Solicitar transcrição').props.onClick();await tick();
  assert.equal(h.requests.length,1);assert.equal(h.requests[0].init.body.get('provider'),'catalog:groq-whisper-turbo');assert.equal(h.requests[0].init.body.get('consent'),'true');
 }finally{h.dispose();}
});

test('voice approval changes in an open editor preserve audio and require a new check',async()=>{
 const h=harness({extra:{...ROUTE,routeModel:{...ROUTE.routeModel,approval:'version-one'}}});
 try{
  h.choose();h.consent();
  assert.equal(h.button('Solicitar transcrição').props.disabled,false);
  h.props.loadingSettings=true;
  h.render();
  assert.equal(h.find('input',node=>node.props.type==='checkbox').props.disabled,true);
  assert.equal(h.button('Solicitar transcrição').props.disabled,true);
  assert.match(h.text(),/Consultando serviço de transcrição/);
  h.props.routeModel={...ROUTE.routeModel,perHour:0.5,approval:'version-two'};
  h.props.loadingSettings=false;
  h.render();
  assert.equal(h.find('input',node=>node.props.type==='checkbox').props.checked,false);
  assert.equal(h.button('Solicitar transcrição').props.disabled,true);
  assert.ok(h.find('audio',node=>node.props.controls));
  assert.match(h.text(),/US\$\s0,0125/);
  h.consent();h.button('Solicitar transcrição').props.onClick();await tick();
  assert.equal(h.requests.length,1);
  assert.equal(h.requests[0].init.body.get('approval'),'version-two');
 }finally{h.dispose();}
});
test('a model name that does not say the service gets the service added, and the Deepgram format keeps the reviewed floor in the ceiling',()=>{
 const h=harness({extra:{destination:'catalog:synthetic-voice',routeModel:{label:'Voz sintética',service:'Serviço de teste',perHour:0.258,style:'deepgram'}}});
 try{
  assert.match(h.text(),/ao modelo de voz Voz sintética \(Serviço de teste\) para transcrição/);
  assert.match(h.text(),/Custo máximo por áudio: US\$\s0,0450\./,'90 s: max(6450, 45000)');
 }finally{h.dispose();}
});
test('when the destination changed before sending, the server text stays on screen, the state is reloaded and consent is asked again for the new destination',async()=>{
 let reloads=0;const h=harness({extra:{onDestinationChanged:()=>{reloads++;}}});
 try{
  h.consent();h.choose();h.button('Solicitar transcrição').props.onClick();await tick();
  assert.equal(h.requests[0].init.body.get('provider'),'deepgram');
  h.requests[0].resolve({ok:false,json:async()=>({error:'O serviço que transcreve o áudio mudou. Nada foi enviado. Confira o aviso, autorize e envie de novo.',code:'speech_provider_changed'})});await tick();h.render();
  assert.equal(reloads,1);assert.match(h.text(),/O serviço que transcreve o áudio mudou\. Nada foi enviado\. Confira o aviso, autorize e envie de novo\./);
  // O estado recarregado traz o destino novo: a autorização dada para o destino antigo deixa de valer.
  Object.assign(h.props,ROUTE);h.render();
  assert.match(h.text(),/O serviço que transcreve o áudio mudou/,'the server text is still visible');assert.ok(h.find('audio',()=>true),'the audio is preserved');
  assert.equal(h.find('input',node=>node.props.type==='checkbox').props.checked,false);assert.equal(h.button('Solicitar transcrição').props.disabled,true);
  assert.match(h.text(),/Autorizo gravar e enviar este áudio ao modelo de voz Whisper turbo \(Groq\)/);
  h.consent();h.button('Solicitar transcrição').props.onClick();await tick();
  assert.equal(h.requests.length,2);assert.equal(h.requests[1].init.body.get('provider'),'catalog:groq-whisper-turbo');
  h.requests[1].resolve({ok:false,json:async()=>({error:'A configuração de voz mudou durante o envio. Nada foi enviado. Envie de novo.',code:'speech_configuration_changed'})});await tick();h.render();
  assert.equal(reloads,2);assert.match(h.text(),/A configuração de voz mudou durante o envio\. Nada foi enviado\. Envie de novo\./);
 }finally{h.dispose();}
});
test('any other failure does not reload the state',async()=>{
 let reloads=0;const h=harness({extra:{...ROUTE,onDestinationChanged:()=>{reloads++;}}});
 try{
  h.consent();h.choose();h.button('Solicitar transcrição').props.onClick();await tick();
  h.requests[0].resolve({ok:false,json:async()=>({error:'Provedor sintético indisponível',code:'speech_provider'})});await tick();h.render();
  assert.equal(reloads,0);assert.match(h.text(),/Provedor sintético indisponível/);
 }finally{h.dispose();}
});
