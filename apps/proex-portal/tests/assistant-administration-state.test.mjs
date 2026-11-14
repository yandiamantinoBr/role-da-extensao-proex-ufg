import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const text=node=>typeof node==='string'?node:Array.isArray(node)?node.map(text).join(''):node&&typeof node==='object'?text(node.props?.children):'';
const defaults={enabled:false,documentEnabled:false,jevEnabled:false,sttEnabled:false,sttProvider:'legacy',usageScope:'organization',usageUserId:null,dailyCalls:20,dailyUsdMicros:1000000,dailyTokens:100000,timeoutMs:12000,dailyMs:300000,maxOutputTokens:1200,model:'deepseek-flash',jevModel:'jev-1.14.0'};
const status=(id='org-a',extra={})=>({organizationId:id,canConfigure:true,canDelegate:true,revision:3,config:{...defaults},organizations:['org-a','org-b','org-c'].map(id=>({id,name:id,canConfigure:true,legacySttProvider:'deepgram'})),candidates:[{userId:'member-a',name:'Integrante A'}],grants:[],...extra});
function harness(initialProps={}){
 let index=0,tree,props=initialProps;const slots=[],effects=[],pending=[],requests=[],callbacks=[];
 const hooks={useState(initial){const key=index++;if(!(key in slots))slots[key]=typeof initial==='function'?initial():initial;return[slots[key],value=>slots[key]=typeof value==='function'?value(slots[key]):value];},useRef(initial){const key=index++;return slots[key]??={current:initial};},useEffect(callback,deps){const key=index++,old=effects[key];if(old&&deps&&deps.every((value,i)=>Object.is(value,old.deps?.[i])))return;pending.push(()=>{old?.cleanup?.();effects[key]={deps,cleanup:callback()};});}};
 const mod={exports:{}},jsx={jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})};
 const source=ts.transpileModule(readFileSync(new URL('../components/portal/assistant-administration-panel.tsx',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 const contracts={exports:{}};vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../lib/assistant/contracts.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{module:contracts,exports:contracts.exports,require:()=>({HttpError:Error})});
 const catalog={exports:{}};vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../lib/assistant/model-catalog.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{module:catalog,exports:catalog.exports,require:()=>({HttpError:Error}),URL});
 const roleContracts={exports:{}};vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../lib/assistant/role-contracts.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{module:roleContracts,exports:roleContracts.exports,require:()=>({})});
 vm.runInNewContext(source,{module:mod,exports:mod.exports,require:name=>name==='react'?hooks:name==='react/jsx-runtime'?jsx:name==='@/lib/assistant/role-contracts'?roleContracts.exports:name.includes('contracts')?contracts.exports:name==='@/lib/assistant/model-catalog'?catalog.exports:name==='./ai-limits-link'?{AI_LIMITS_EVENT:'proex:ai-limits',takeAiLimitsRequest:()=>false}:name==='./role-sources-panel'?{default:()=>null}:{default:{}},window:{addEventListener(){},removeEventListener(){},requestAnimationFrame:()=>0,cancelAnimationFrame(){}},document:{getElementById:()=>null},Error,AbortController,fetch:(url,init)=>new Promise((resolve,reject)=>requests.push({url,init,resolve,reject}))});
 function nodes(){const out=[];function walk(node){if(Array.isArray(node)){node.forEach(walk);return;}if(!node||typeof node!=='object')return;out.push(node);walk(node.props?.children);}walk(tree);return out;}
 const h={requests,callbacks,nodes,catalog:catalog.exports,render(next=props){props=next;index=0;tree=mod.exports.default({onChanged:()=>callbacks.push('changed'),renderCredentials:id=>({type:'credential-area',props:{children:'Cofre '+id}}),...props});pending.splice(0).forEach(effect=>effect());},find(type,predicate){const found=nodes().find(node=>node.type===type&&predicate(node));assert.ok(found,type);return found;},button(label){return h.find('button',node=>text(node)===label);},select(label){return h.find('label',node=>text(node).startsWith(label)).props.children.find(child=>child?.type==='select');},text:()=>text(tree),dispose(){effects.forEach(effect=>effect?.cleanup?.());}};h.render();return h;
}
async function reply(h,index,value){h.requests[index].resolve({ok:true,json:async()=>value});await tick();h.render();}
async function ready(h,extra={}){await reply(h,0,status('',{...extra,canConfigure:false}));await reply(h,1,status('org-a',extra));}
test('administrator saves usage/provider choices only on explicit save with selected organization revision and no key values',async()=>{
 const h=harness();try{await ready(h,{canDelegate:false,config:{...defaults,sttEnabled:true}});h.select('Acesso ao uso').props.onChange({target:{value:'private'}});h.render();h.select('Provedor de transcrição').props.onChange({target:{value:'groq'}});h.render();assert.equal(h.requests.length,2);
  const enabled=h.find('label',node=>text(node).startsWith('Habilitar transcrição Groq')).props.children.find(node=>node?.type==='input');assert.equal(enabled.props.checked,false);enabled.props.onChange({target:{checked:true}});h.render();h.button('Salvar funções, acesso e limites').props.onClick();await tick();
  const body=JSON.parse(h.requests[2].init.body);assert.equal(body.action,'configure');assert.equal(body.organizationId,'org-a');assert.equal(body.expectedRevision,3);assert.equal(body.config.usageScope,'private');assert.equal(body.config.sttProvider,'groq');assert.equal(body.config.sttEnabled,true);
  for(const name of ['secret','deepseekKey','groqKey','replaceCredentials'])assert.equal(Object.hasOwn(body,name),false);
  assert.equal(h.text().includes('Quem pode configurar esta organização'),false);
 }finally{h.dispose();}
});
test('late previous-organization settings cannot redirect a save and access loss clears admin forms and credential content',async()=>{
 const h=harness();try{await ready(h);const change=h.select('Organização da IA').props.onChange;change({target:{value:'org-b'}});h.render();change({target:{value:'org-c'}});h.render();await reply(h,3,status('org-c'));await reply(h,2,status('org-b'));assert.equal(h.select('Organização da IA').props.value,'org-c');h.button('Salvar funções, acesso e limites').props.onClick();await tick();assert.equal(JSON.parse(h.requests[4].init.body).organizationId,'org-c');h.requests[4].resolve({ok:false,status:403,json:async()=>({error:'Permissão revogada'})});await tick();h.render();assert.equal(h.nodes().some(node=>node.type==='credential-area'),false);assert.equal(h.nodes().some(node=>node.type==='select'),false);assert.match(h.text(),/Permissão revogada/);
 }finally{h.dispose();}
});
test('closed administration discards late save results and an unauthorized actor gets no forms or diagnostics',async()=>{
 const h=harness();try{await ready(h);h.button('Salvar funções, acesso e limites').props.onClick();await tick();h.dispose();h.requests[2].resolve({ok:true,json:async()=>({ok:true,revision:4})});await tick();assert.deepEqual(h.callbacks,[]);}finally{h.dispose();}
 const denied=harness();try{await reply(denied,0,{organizationId:'',canConfigure:false,organizations:[{id:'org-a',name:'Org A',canConfigure:false}]});assert.equal(denied.nodes().some(node=>node.type==='select'),false);assert.equal(denied.nodes().some(node=>node.type==='credential-area'),false);assert.match(denied.text(),/não tem autorização/);}finally{denied.dispose();}
});

test('a concurrent credential refresh cannot leave configuration permanently busy or accept incomplete defaults',async()=>{
 const h=harness();try{await ready(h);h.button('Salvar funções, acesso e limites').props.onClick();await tick();h.render({refreshKey:1});await reply(h,3,status('org-a',{revision:4}));h.requests[2].resolve({ok:false,status:409,json:async()=>({error:'Configuração mudou'})});await tick();h.render({refreshKey:1});assert.equal(h.button('Salvar funções, acesso e limites').props.disabled,false);assert.match(h.text(),/Configuração mudou/);}finally{h.dispose();}
 const invalid=harness();try{await reply(invalid,0,status('org-a',{config:undefined}));assert.equal(invalid.nodes().some(node=>node.type==='credential-area'),false);assert.equal(invalid.nodes().some(node=>node.type==='select'),false);}finally{invalid.dispose();}
});

test('owner areas shorten the flow without fetching diagnostics or exposing credential content to a delegated configurator',async()=>{
 const h=harness({canManageKeys:true});try{await ready(h);assert.equal(h.nodes().some(node=>node.type==='credential-area'),true);assert.equal(h.nodes().some(node=>node.type==='select'&&node.props.value==='organization'),false);h.button('Funções e acesso').props.onClick();h.render({canManageKeys:true});assert.equal(h.nodes().some(node=>node.type==='credential-area'),false);assert.ok(h.button('Salvar funções, acesso e limites'));assert.deepEqual(h.requests.slice(2).map(request=>request.url),['/api/assistant/catalog?organizationId=org-a'],'switching areas reads only the model list: no provider call, no diagnostics');assert.equal(h.requests[2].init.method,undefined);}finally{h.dispose();}
});

test('explicit OpenAI selection clears both text functions without starting inference or altering speech and usage choices',async()=>{
 const h=harness();try{
  await ready(h,{config:{...defaults,enabled:true,documentEnabled:true,sttProvider:'groq',sttEnabled:true,usageScope:'private',usageUserId:'member-a'}});
  h.select('Serviço de IA para operações e documentos').props.onChange({target:{value:'openai'}});h.render();
  assert.match(h.text(),/Pedidos de operações · OpenAI/);
  const functions=h.nodes().filter(node=>node.type==='label'&&['Pedidos de operações','Interpretação de documentos'].some(label=>text(node).startsWith(label)));
  assert.equal(functions.length,2);for(const node of functions)assert.equal(node.props.children.find(child=>child?.type==='input').props.checked,false);
  assert.equal(h.requests.length,2);h.button('Salvar funções, acesso e limites').props.onClick();await tick();
  const config=JSON.parse(h.requests[2].init.body).config;
  assert.equal(config.textProvider,'openai');assert.equal(config.openaiModel,'gpt-5.6-luna');assert.equal(config.enabled,false);assert.equal(config.documentEnabled,false);
  assert.equal(config.usageScope,'private');assert.equal(config.sttEnabled,true);assert.equal(config.sttProvider,'groq');
 }finally{h.dispose();}
});

// Modelo por tarefa: três seletores só para a administração geral, com a mesma regra de lista que o servidor aplica.
const TASK_LABELS=['Modelo para ler documentos','Modelo para conferir e triar','Modelo para transcrever voz'];
const optionsOf=select=>{const out=[];(function walk(node){if(Array.isArray(node)){node.forEach(walk);return;}if(node&&typeof node==='object'&&node.type==='option')out.push({value:node.props.value,label:text(node),...(node.props.disabled?{disabled:true}:{})});})(select.props.children);return out;};
const STANDARD=['Padrão do portal (DeepSeek)','Padrão do portal (JEV, da TypeSafe)','Padrão do portal (Deepgram)'];
const catalogReply=(h,change=models=>models,keyed=['groq','openai'])=>{const base=h.catalog.defaultCatalog('2026-01-01T00:00:00.000Z');return{organizationId:'org-a',stamp:'synthetic',catalog:{...base,models:change(base.models),providers:base.providers.map(provider=>({...provider,hasKey:keyed.includes(provider.id)}))}};};
test('general administration chooses a model per task: the list loads when the functions area opens, the standard is named, keyless models cannot be chosen and the save sends the three keys',async()=>{
 const h=harness({canManageKeys:true});try{
  await ready(h,{config:{...defaults,speechModel:'groq-whisper-turbo'}});h.button('Funções e acesso').props.onClick();h.render();
  // Abrir a parte de funções já lê a lista: uma leitura serve os três seletores.
  assert.equal(h.requests.length,3);assert.equal(h.requests[2].url,'/api/assistant/catalog?organizationId=org-a');
  h.render();
  for(const label of TASK_LABELS){assert.deepEqual(optionsOf(h.select(label)).map(option=>option.label),['Carregando modelos…']);assert.equal(h.select(label).props.disabled,true);}
  assert.equal(h.select(TASK_LABELS[2]).props.value,'groq-whisper-turbo','the saved choice is kept while the list loads');
  assert.equal(h.text().includes('groq-whisper-turbo'),false,'the raw code is never shown');
  assert.match(h.text(),/As opções vêm da aba Modelos\. Se o modelo estiver indisponível antes do envio, a confirmação mostra o modelo padrão\./);
  assert.match(h.text(),/O áudio vai só para o serviço nomeado no aviso de gravação\./);
  assert.doesNotMatch(h.text(),/padrão de hoje|Padrão de hoje/);
  h.select(TASK_LABELS[0]).props.onFocus();h.select(TASK_LABELS[2]).props.onPointerDown();assert.equal(h.requests.length,3,'opening a selector does not read the list again');
  await reply(h,2,catalogReply(h,models=>{const flash=models.find(model=>model.id==='deepseek-flash');return[...models,{...flash,id:'synthetic-test-only',label:'Sintético de teste',testOnly:true},{...flash,id:'synthetic-off',label:'Sintético desligado',enabled:false},{...flash,id:'synthetic-no-price',label:'Sintético sem preço',price:{...flash.price,outputPerM:0}}];}));
  const documents=optionsOf(h.select(TASK_LABELS[0])),decisions=optionsOf(h.select(TASK_LABELS[1])),voices=optionsOf(h.select(TASK_LABELS[2]));
  // A primeira opção diz qual é o padrão; o modelo da lista que é o próprio padrão não aparece de novo.
  assert.deepEqual([documents[0],decisions[0],voices[0]],STANDARD.map(label=>({value:'',label})));
  assert.deepEqual(documents.map(option=>option.value),['','openai-gpt-5-6-luna','openai-gpt-6-luna','openai-gpt-6-1-terra','anthropic-claude-haiku-5-5'],'test-only, disabled and unpriced models stay out, and so does the standard itself (DeepSeek Flash)');
  assert.deepEqual(decisions.map(option=>option.value),['','perplexity-decider-v1-2','nace-drex-max-v1-1'],'the JEV is the standard, not a second option');
  assert.deepEqual(voices,[{value:'',label:STANDARD[2]},{value:'groq-whisper-turbo',label:'Whisper turbo (Groq)'}],'Deepgram Nova-3 is the standard here; the saved choice shows its name');
  for(const label of TASK_LABELS)assert.equal(h.select(label).props.disabled,false);
  // Sem chave: opção desabilitada, com o motivo.
  assert.deepEqual(documents.slice(1),[{value:'openai-gpt-5-6-luna',label:'GPT-5.6 Luna (OpenAI)'},{value:'openai-gpt-6-luna',label:'GPT-6 Luna (OpenAI)'},{value:'openai-gpt-6-1-terra',label:'GPT-6.1 Terra (OpenAI)'},{value:'anthropic-claude-haiku-5-5',label:'Claude Haiku 5.5 (Anthropic) (falta a chave)',disabled:true}]);
  assert.deepEqual(decisions.slice(1).map(option=>[option.label.endsWith(' (falta a chave)'),option.disabled]),[[true,true],[true,true]]);
  assert.doesNotMatch(h.text(),/Nenhum modelo da aba Modelos|Não foi possível carregar a lista de modelos/);
  // Trocar o serviço de texto na tela troca o padrão nomeado e o modelo escondido.
  h.select('Serviço de IA para operações e documentos').props.onChange({target:{value:'openai'}});h.render();
  assert.deepEqual(optionsOf(h.select(TASK_LABELS[0])).map(option=>option.value),['','deepseek-flash','openai-gpt-6-luna','openai-gpt-6-1-terra','anthropic-claude-haiku-5-5']);
  assert.equal(optionsOf(h.select(TASK_LABELS[0]))[0].label,'Padrão do portal (OpenAI)');
  h.select('Serviço de IA para operações e documentos').props.onChange({target:{value:'deepseek'}});h.render();
  h.select('Provedor de transcrição').props.onChange({target:{value:'groq'}});h.render();
  assert.equal(optionsOf(h.select(TASK_LABELS[2]))[0].label,'Padrão do portal (Groq)');
  assert.deepEqual(optionsOf(h.select(TASK_LABELS[2])).map(option=>option.value),['','groq-whisper-turbo','deepgram-nova-3'],'the saved model stays listed even when it is the standard');
  h.select('Provedor de transcrição').props.onChange({target:{value:'legacy'}});h.render();
  // As caixas dizem o nome do modelo escolhido, e a voz não cita Groq nem preço fixo.
  h.select(TASK_LABELS[0]).props.onChange({target:{value:'openai-gpt-6-luna'}});h.select(TASK_LABELS[1]);h.render();
  assert.equal(h.select(TASK_LABELS[0]).props.value,'openai-gpt-6-luna');assert.equal(h.requests.length,3,'choosing does not save or call a provider');
  assert.ok(h.text().includes('GPT-6 Luna (OpenAI) extrai campos autorizados. Cada documento precisa de autorização e revisão.'));
  assert.ok(h.text().includes('TypeSafe sugere decisões dentro do contrato. Em caso de dúvida, a decisão fica manual.'),'no decision model chosen: the usual words');
  assert.ok(h.find('label',node=>text(node)==='Habilitar transcrição de voz em português'));
  assert.ok(h.text().includes('O custo segue o preço por hora do modelo escolhido abaixo. Quem grava vê o custo máximo antes de enviar.'));
  assert.doesNotMatch(h.text(),/Habilitar transcrição (Groq|Deepgram)|US\$ 0,04 por hora|conta Deepgram|Modelo definido pela administração geral/);
  h.button('Salvar funções, acesso e limites').props.onClick();await tick();
  const body=JSON.parse(h.requests[3].init.body);assert.equal(body.action,'configure');
  assert.deepEqual([body.config.documentModel,body.config.decisionModel,body.config.speechModel],['openai-gpt-6-luna','','groq-whisper-turbo']);
  h.requests[3].resolve({ok:false,status:400,json:async()=>({error:'Falta a chave do serviço deste modelo. Cole a chave na aba Chaves e escolha o modelo de novo.',code:'assistant_credentials'})});await tick();h.render();
  assert.match(h.text(),/Falta a chave do serviço deste modelo\. Cole a chave na aba Chaves e escolha o modelo de novo\./,'the server text is shown like the other errors');
  assert.equal(h.select(TASK_LABELS[0]).props.value,'openai-gpt-6-luna','the choice is kept for a new attempt');
 }finally{h.dispose();}
});
test('model list: a failed read says so and can be repeated, a saved model outside the list never shows its code and an empty list explains why',async()=>{
 const h=harness({canManageKeys:true});try{
  await ready(h,{config:{...defaults,documentModel:'modelo-antigo'}});h.button('Funções e acesso').props.onClick();h.render();
  h.requests[2].resolve({ok:false,status:500,json:async()=>({error:'Erro sintético.'})});await tick();h.render();
  assert.match(h.text(),/Não foi possível carregar a lista de modelos\./);
  const retry=()=>h.nodes().filter(node=>node.type==='button'&&text(node)==='Tentar de novo');
  assert.equal(retry().length,2,'under the document and decision selectors and under the voice selector');
  for(const button of retry())assert.match(button.props.className,/p-button p-button-subtle/);
  assert.deepEqual(optionsOf(h.select(TASK_LABELS[0])),[{value:'',label:STANDARD[0]},{value:'modelo-antigo',label:'Modelo escolhido'}]);
  assert.deepEqual(optionsOf(h.select(TASK_LABELS[1])),[{value:'',label:STANDARD[1]}]);
  assert.equal(h.text().includes('modelo-antigo'),false);
  assert.ok(h.text().includes('O modelo escolhido extrai campos autorizados'),'without the name the usual wording stays');
  // Tentar de novo repete a leitura; uma segunda falha volta a avisar.
  retry()[0].props.onClick();h.render();
  assert.equal(h.requests.length,4);assert.equal(h.requests[3].url,'/api/assistant/catalog?organizationId=org-a');
  assert.deepEqual(optionsOf(h.select(TASK_LABELS[0])).map(option=>option.label),['Carregando modelos…']);assert.equal(retry().length,0);
  h.requests[3].reject(new Error('synthetic network failure'));await tick();h.render();
  assert.equal(retry().length,2);
  retry()[1].props.onClick();h.render();
  // Lista lida, sem nenhum modelo de decisão além do padrão: o seletor explica o que falta; o modelo salvo que saiu da lista não mostra o código.
  await reply(h,4,catalogReply(h,models=>models.filter(model=>!['perplexity-decider-v1-2','nace-drex-max-v1-1'].includes(model.id))));
  assert.equal(retry().length,0);assert.doesNotMatch(h.text(),/Não foi possível carregar a lista de modelos/);
  assert.deepEqual(optionsOf(h.select(TASK_LABELS[0])).slice(0,2),[{value:'',label:STANDARD[0]},{value:'modelo-antigo',label:'Modelo fora da lista (escolha outro)'}]);
  assert.equal(h.text().includes('modelo-antigo'),false);
  assert.deepEqual(optionsOf(h.select(TASK_LABELS[1])),[{value:'',label:STANDARD[1]}]);
  assert.ok(h.text().includes('Nenhum modelo da aba Modelos serve para esta tarefa ainda. Para aparecer aqui, o modelo precisa estar ligado, ter preço e servir para decisão.'));
  assert.equal(h.text().includes('servir para documento.'),false);assert.equal(h.text().includes('servir para voz para texto.'),false);
  h.dispose();
  // Sem nenhum modelo de voz ou de documento além do padrão, cada seletor explica com o nome do campo da aba Modelos.
  const empty=harness({canManageKeys:true});
  try{
   await ready(empty);empty.button('Funções e acesso').props.onClick();empty.render();
   await reply(empty,2,catalogReply(empty,models=>models.filter(model=>['deepseek-flash','typesafe-jev-1-14','deepgram-nova-3'].includes(model.id))));
   for(const field of ['documento','decisão','voz para texto'])assert.ok(empty.text().includes(`Para aparecer aqui, o modelo precisa estar ligado, ter preço e servir para ${field}.`),field);
  }finally{empty.dispose();}
 }finally{h.dispose();}
});
test('whoever is not the general administration neither sees the task selectors nor sends the three keys',async()=>{
 const h=harness();try{
  await ready(h,{canDelegate:false,config:{...defaults,documentModel:'openai-gpt-6-luna',speechModel:'groq-whisper-turbo'}});
  for(const label of TASK_LABELS)assert.equal(h.nodes().some(node=>node.type==='label'&&text(node).startsWith(label)),false);
  assert.doesNotMatch(h.text(),/Padrão do portal|Padrão de hoje|aviso de gravação|aba Modelos|Modelo definido pela administração geral|Tentar de novo/);
  assert.equal(h.text().includes('openai-gpt-6-luna'),false);assert.equal(h.text().includes('groq-whisper-turbo'),false);
  h.select('Provedor de transcrição').props.onChange({target:{value:'groq'}});h.render();h.button('Salvar funções, acesso e limites').props.onClick();await tick();
  assert.equal(h.requests.length,3,'no catalog read');const body=JSON.parse(h.requests[2].init.body);
  for(const key of ['documentModel','decisionModel','speechModel'])assert.equal(Object.hasOwn(body.config,key),false,key);
  assert.equal(body.config.sttProvider,'groq');assert.equal(body.config.dailyCalls,20);
 }finally{h.dispose();}
});
test('whoever is not the general administration reads which model the general administration chose, when the portal knows its name',async()=>{
 const h=harness();try{
  const organizations=['org-a','org-b','org-c'].map(id=>({id,name:id,canConfigure:true,legacySttProvider:'deepgram',...(id==='org-a'?{documentRouteName:'GPT-6 Luna (OpenAI)',decisionRouteName:'Decider v1.2 (Perplexity)',sttRouteModel:{label:'Whisper turbo (Groq)',service:'Groq',perHour:0.04,style:'groq'}}:{})}));
  await ready(h,{canDelegate:false,organizations,config:{...defaults,documentEnabled:true,jevEnabled:true,sttEnabled:true,documentModel:'openai-gpt-6-luna',decisionModel:'perplexity-decider-v1-2',speechModel:'groq-whisper-turbo'}});
  const lines=h.nodes().filter(node=>node.type==='p'&&text(node).startsWith('Modelo definido pela administração geral: ')).map(text);
  assert.deepEqual(lines,['Modelo definido pela administração geral: GPT-6 Luna (OpenAI).','Modelo definido pela administração geral: Decider v1.2 (Perplexity).','Modelo definido pela administração geral: Whisper turbo (Groq).']);
  assert.ok(h.text().includes('GPT-6 Luna (OpenAI) extrai campos autorizados'));
  assert.ok(h.text().includes('Decider v1.2 (Perplexity) sugere decisões dentro do contrato.'));
  assert.ok(h.find('label',node=>text(node)==='Habilitar transcrição de voz em português'));
  for(const label of TASK_LABELS)assert.equal(h.nodes().some(node=>node.type==='label'&&text(node).startsWith(label)),false,'read-only: no selector');
  assert.equal(h.requests.length,2,'no catalog read');
  for(const code of ['openai-gpt-6-luna','perplexity-decider-v1-2','groq-whisper-turbo'])assert.equal(h.text().includes(code),false,code);
 }finally{h.dispose();}
});
test('with the three choices empty the general administration saves the same configuration as before',async()=>{
 const h=harness({canManageKeys:true});try{
  await ready(h);h.button('Funções e acesso').props.onClick();h.render();
  for(const label of TASK_LABELS)assert.equal(h.select(label).props.value,'');
  // Textos de sempre nas caixas e na voz: nada cita modelo escolhido.
  assert.ok(h.text().includes('DeepSeek extrai campos autorizados. Cada documento precisa de autorização e revisão.'));
  assert.ok(h.text().includes('TypeSafe sugere decisões dentro do contrato. Em caso de dúvida, a decisão fica manual.'));
  assert.ok(h.find('label',node=>text(node)==='Habilitar transcrição Deepgram em português'));
  assert.ok(h.text().includes('O custo e a autorização de transcrição dependem da conta Deepgram.'));
  h.button('Salvar funções, acesso e limites').props.onClick();await tick();
  assert.deepEqual(h.requests.slice(2).map(request=>request.url),['/api/assistant/catalog?organizationId=org-a','/api/assistant'],'one list read and the save');
  const body=JSON.parse(h.requests[3].init.body);
  assert.deepEqual([body.config.documentModel,body.config.decisionModel,body.config.speechModel],['','','']);
 }finally{h.dispose();}
});
