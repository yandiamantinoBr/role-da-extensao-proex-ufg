'use client';

import {useRef,useState,type FormEvent} from 'react';
import {ArrowRight,ChevronDown,Gift,History,Lock,Plus,RefreshCw,Sparkles,Star,Trash2} from 'lucide-react';
import {DEFAULT_SUPER_SUPER_PERCENT,PRIZE_TIERS,PRIZE_TIER_LIMITS,TIER_HINTS,TIER_LABELS,expected,percentLabel,tierOdds,type OptionCreateInput,type PercentSetInput,type PrizeHistoryEntry,type PrizeOption,type PrizeTier,type PrizeTiersWorkspace,type TierSetInput} from '@/lib/prize-tiers/contracts';
import styles from './prize-tiers-panel.module.css';

type Props={userId:string;campaignId:string};
type Body=Omit<TierSetInput,'operationKey'>|Omit<PercentSetInput,'operationKey'>|Omit<OptionCreateInput,'operationKey'>;
type Notice={tone:'error'|'success';text:string;refresh?:boolean};
const ENDPOINT='/api/prize-tiers';
const OUT='out';
const when=new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short',timeZone:'America/Sao_Paulo'});
const tierName=(tier:PrizeTier|null)=>tier?TIER_LABELS[tier]:'Fora desta dinâmica';
class ApiError extends Error{status:number;constructor(message:string,status:number){super(message);this.status=status;}}
async function request<T>(input:RequestInfo,init?:RequestInit):Promise<T>{
 const response=await fetch(input,{cache:'no-store',...init});let body:Record<string,unknown>={};
 try{body=await response.json();}catch{/* handled below */}
 if(!response.ok)throw new ApiError(typeof body.error==='string'?body.error:'Não foi possível concluir. Atualize e tente novamente.',response.status);
 return body as T;
}
/** "1 em 4" for 25%: the extra draw the team can run at the stand. */
function drawHint(percent:number){if(percent<=0)return 'Sem Super Super: todo resultado Super fica no nível Super.';if(percent>=100)return 'Todo resultado Super vira Super Super.';const n=100/percent;return Number.isInteger(n)?`No resultado Super, um sorteio extra visível decide: 1 chance em ${n} de virar Super Super (por exemplo, um dado de ${n} faces).`:`No resultado Super, um sorteio extra visível decide: ${percent}% de chance de virar Super Super.`;}
function historyText(entry:PrizeHistoryEntry){
 if(entry.kind==='percent')return <>Premissa do Super Super: <b>{entry.previousPercent===null?`${DEFAULT_SUPER_SUPER_PERCENT}% (padrão)`:`${entry.previousPercent}%`}</b> <ArrowRight size={13} aria-label="para"/> <b>{entry.percent}%</b></>;
 const name=<b>{entry.offerName??'Opção'}</b>;
 if(!entry.previousTier)return <>{name} entrou em <b>{tierName(entry.tier)}</b></>;
 if(!entry.tier)return <>{name} saiu da dinâmica (estava em {tierName(entry.previousTier)})</>;
 return <>{name}: {tierName(entry.previousTier)} <ArrowRight size={13} aria-label="para"/> <b>{tierName(entry.tier)}</b></>;
}

export default function PrizeTiersPanel(props:Props){return <PrizeTiersBody key={`${props.userId}:${props.campaignId}`} {...props}/>;}
function PrizeTiersBody({userId,campaignId}:Props){
 const [open,setOpen]=useState(false),[data,setData]=useState<PrizeTiersWorkspace|null>(null),[loading,setLoading]=useState(false),[busy,setBusy]=useState(false);
 const [notice,setNotice]=useState<Notice|null>(null),[percent,setPercent]=useState(''),[composer,setComposer]=useState(false),[allHistory,setAllHistory]=useState(false);
 const [draft,setDraft]=useState<{name:string;tier:PrizeTier;rows:{itemId:string;quantity:string}[]}>({name:'',tier:'super',rows:[{itemId:'',quantity:'1'}]});
 const pending=useRef<{key:string;body:string}|null>(null),epoch=useRef(0);
 async function load(){
  const ticket=++epoch.current;setLoading(true);
  try{const next=await request<PrizeTiersWorkspace>(`${ENDPOINT}?campaignId=${encodeURIComponent(campaignId)}`);if(ticket!==epoch.current)return;if(next.viewerId!==userId||next.campaignId!==campaignId)throw new Error('A consulta voltou para outra pessoa ou dinâmica. Atualize a página.');setData(next);setPercent(String(next.superSuperPercent));}
  catch(cause){if(ticket===epoch.current)setNotice({tone:'error',text:cause instanceof Error?cause.message:'Não foi possível consultar os níveis.'});}
  finally{if(ticket===epoch.current)setLoading(false);}
 }
 function toggle(next:boolean){setOpen(next);if(next&&!data&&!loading)void load();}
 async function mutate(body:Body,success:string,after?:()=>void){
  if(busy)return;setBusy(true);setNotice(null);
  // A lost reply is retried with the same key; any other payload gets a new one.
  const serialized=JSON.stringify(body);if(pending.current?.body!==serialized)pending.current={key:crypto.randomUUID(),body:serialized};
  try{
   await request(ENDPOINT,{method:'POST',headers:{'Content-Type':'application/json','X-Proex-Action':'1'},body:JSON.stringify({...body,operationKey:pending.current.key})});
   pending.current=null;after?.();setNotice({tone:'success',text:success});await load();
  }catch(cause){
   const status=cause instanceof ApiError?cause.status:0;if(status&&status!==429)pending.current=null;
   setNotice({tone:'error',text:cause instanceof Error?cause.message:'Não foi possível salvar.',refresh:status===409||status===403});
  }finally{setBusy(false);}
 }
 function moveOption(option:PrizeOption,value:string){
  if(!data)return;const tier=value===OUT?null:value as PrizeTier;if(tier===option.tier)return;
  void mutate({action:'tier.set',campaignId,expectedVersion:data.version,offerId:option.offerId,tier},tier?`${option.name} agora está em ${TIER_LABELS[tier]}. Estoque e entregas não mudaram.`:`${option.name} saiu desta dinâmica. Estoque e entregas não mudaram.`);
 }
 function savePercent(event:FormEvent<HTMLFormElement>){
  event.preventDefault();if(!data)return;const value=Number(percent);
  if(!Number.isInteger(value)||value<0||value>100)return setNotice({tone:'error',text:'Use um número inteiro de 0 a 100.'});
  void mutate({action:'percent.set',campaignId,expectedVersion:data.version,superSuperPercent:value},`Salvo: ${value}% dos sorteios Super viram Super Super.`);
 }
 function createOption(event:FormEvent<HTMLFormElement>){
  event.preventDefault();if(!data)return;const name=draft.name.trim(),rows=draft.rows.filter(row=>row.itemId);
  if(!name)return setNotice({tone:'error',text:'Dê um nome à opção, como “Conjunto de 3 bótons”.'});
  if(!rows.length)return setNotice({tone:'error',text:'Escolha ao menos um material.'});
  const components=rows.map(row=>({itemId:row.itemId,quantity:Number(row.quantity)}));
  if(components.some(row=>!Number.isInteger(row.quantity)||row.quantity<1||row.quantity>PRIZE_TIER_LIMITS.quantity))return setNotice({tone:'error',text:'Cada material precisa de uma quantidade inteira de 1 a 1000.'});
  if(new Set(components.map(row=>row.itemId)).size!==components.length)return setNotice({tone:'error',text:'Um material foi escolhido duas vezes.'});
  void mutate({action:'option.create',campaignId,expectedVersion:data.version,name,tier:draft.tier,components},`${name} criada em ${TIER_LABELS[draft.tier]}.`,()=>{setDraft({name:'',tier:'super',rows:[{itemId:'',quantity:'1'}]});setComposer(false);});
 }

 const summary=<summary className={styles.summary}>
  <span className={styles.mark}><Star size={20} aria-hidden="true"/></span>
  <span className={styles.summaryText}><strong>Níveis de brinde</strong><span>Brinde, Super e Super Super: o que a pessoa pode escolher e com que chance</span></span>
  <ChevronDown size={18} className={styles.chevron} aria-hidden="true"/>
 </summary>;
 if(!open)return <details data-prize-tiers className={styles.panel} open={false} onToggle={event=>toggle(event.currentTarget.open)}>{summary}</details>;
 const odds=data?tierOdds(data.superSuperPercent,data.campaign.retryLimit):null;
 const groups:{key:PrizeTier|typeof OUT;label:string;hint:string}[]=[...PRIZE_TIERS.map(tier=>({key:tier,label:TIER_LABELS[tier],hint:TIER_HINTS[tier]})),{key:OUT,label:'Fora desta dinâmica',hint:'Brindes e kits do projeto que não entram nesta dinâmica.'}];
 const locked=busy||loading;
 return <details data-prize-tiers className={styles.panel} open onToggle={event=>{if(event.target===event.currentTarget)toggle(event.currentTarget.open);}}>
  {summary}
  <div className={styles.body} aria-busy={locked}>
   <div className={styles.live} role="status" aria-live="polite">{loading?'Carregando os níveis…':notice?.tone==='success'?notice.text:''}</div>
   {notice?.tone==='error'&&<div className={styles.alert} role="alert"><p>{notice.text}</p>{notice.refresh&&<button type="button" className={styles.secondary} onClick={()=>{setNotice(null);void load();}} disabled={locked}><RefreshCw size={16} aria-hidden="true"/>Atualizar e conferir</button>}</div>}
   {notice?.tone==='success'&&<p className={styles.success} aria-hidden="true">{notice.text}</p>}
   {loading&&!data&&<p className={styles.muted}>Carregando os níveis…</p>}
   {data&&odds&&<>
    <header className={styles.heading}>
     <p className={styles.muted}>A pessoa escolhe <strong>uma</strong> opção do nível sorteado. Mudar o nível de uma opção não mexe no estoque nem nas entregas já registradas.</p>
     <button type="button" className={styles.secondary} onClick={()=>void load()} disabled={locked} aria-label="Recarregar os níveis desta dinâmica"><RefreshCw size={16} aria-hidden="true"/>Recarregar</button>
    </header>
    {!data.canManage&&<p className={styles.readOnly}><Lock size={16} aria-hidden="true"/><span>{data.campaign.status==='closed'?'Dinâmica encerrada: os níveis ficam guardados como histórico.':'Somente consulta. Quem gerencia as dinâmicas do projeto pode mudar os níveis.'}</span></p>}

    <section className={styles.odds} aria-labelledby={`tier-odds-${campaignId}`}>
     <div className={styles.oddsHead}><h4 id={`tier-odds-${campaignId}`}><Sparkles size={17} aria-hidden="true"/>Chances por pessoa</h4>{data.percentIsDefault?<span className={styles.badge}>Padrão {DEFAULT_SUPER_SUPER_PERCENT}% · não confirmado</span>:<span className={styles.badgeOk}>Confirmado: {data.superSuperPercent}%</span>}</div>
     <dl className={styles.oddsGrid}>
      <div><dt>Brinde</dt><dd>{percentLabel(odds.brinde)}</dd><small>{expected(odds.brinde,20)} em cada 20 pessoas</small></div>
      <div><dt>Super</dt><dd>{percentLabel(odds.super)}</dd><small>{expected(odds.super,20)} em cada 20 pessoas</small></div>
      <div data-tier="super_super"><dt>Super Super</dt><dd>{percentLabel(odds.superSuper)}</dd><small>{expected(odds.superSuper,20)} em cada 20 pessoas</small></div>
      <div><dt>Sem brinde</dt><dd>{percentLabel(odds.nothing)}</dd><small>Não foi dessa vez</small></div>
     </dl>
     <p className={styles.muted}>{drawHint(data.superSuperPercent)}</p>
     <details className={styles.how}><summary>Como calculamos</summary><p>A roleta e o dado têm 6 faces: 3 Brinde, 1 Super, 1 Tente novamente e 1 Não foi. A conta considera {odds.retryLimit===1?'até 1 repetição':`até ${odds.retryLimit} repetições`} depois de “Tente novamente”{data.campaign.retryLimit===null?' (a dinâmica ainda não definiu esse limite; usamos 1)':''}. A porcentagem abaixo é uma premissa da equipe. São estimativas para separar os lotes, não promessas.</p></details>
     {data.canManage&&<form className={styles.percentForm} onSubmit={savePercent}>
      <label htmlFor={`tier-percent-${campaignId}`}>Dos sorteios Super, quantos % viram Super Super?</label>
      <div><input id={`tier-percent-${campaignId}`} type="number" inputMode="numeric" min={0} max={100} step={1} value={percent} onChange={event=>setPercent(event.target.value)} disabled={locked} aria-describedby={`tier-percent-help-${campaignId}`}/><span aria-hidden="true">%</span>
      <button type="submit" className={`${styles.primary} p-button-primary`} disabled={locked||percent===''||(!data.percentIsDefault&&Number(percent)===data.superSuperPercent)}>{data.percentIsDefault&&Number(percent)===data.superSuperPercent?`Confirmar ${data.superSuperPercent}%`:'Salvar'}</button></div>
      <small id={`tier-percent-help-${campaignId}`}>Padrão: {DEFAULT_SUPER_SUPER_PERCENT}% (1 em 4). Cada mudança fica no histórico abaixo, com nome e horário.</small>
     </form>}
    </section>

    <div className={styles.groups}>{groups.map(group=>{
     const options=data.options.filter(option=>(option.tier??OUT)===group.key);
     if(group.key===OUT&&!options.length)return null;
     return <section key={group.key} className={styles.group} data-tier={group.key} aria-labelledby={`tier-${group.key}-${campaignId}`}>
      <h4 id={`tier-${group.key}-${campaignId}`}>{group.label}<span className={styles.count}>{options.length} {options.length===1?'opção':'opções'}</span></h4>
      <p className={styles.hint}>{group.hint}</p>
      {options.length?<ul className={styles.options}>{options.map(option=><li key={option.offerId} className={styles.option}>
       <div className={styles.optionText}><strong>{option.name}</strong><span>{option.components.map(component=>`${component.quantity} × ${component.name}`).join(' + ')||'Sem materiais'}</span></div>
       {data.canManage&&<label className={styles.move}><span>Nível</span><select value={option.tier??OUT} disabled={locked} onChange={event=>moveOption(option,event.target.value)} aria-label={`Nível de ${option.name}`}>{PRIZE_TIERS.map(tier=><option key={tier} value={tier}>{TIER_LABELS[tier]}</option>)}<option value={OUT}>Fora desta dinâmica</option></select></label>}
      </li>)}</ul>:<p className={styles.empty}>Nenhuma opção neste nível.</p>}
     </section>;
    })}</div>

    {data.canManage&&<section className={styles.composer}>
     {!composer?<button type="button" className={styles.secondary} onClick={()=>setComposer(true)} disabled={locked}><Plus size={16} aria-hidden="true"/>Nova opção de brinde</button>:<form onSubmit={createOption} className={styles.composerForm}>
      <h4><Gift size={17} aria-hidden="true"/>Nova opção</h4>
      <p className={styles.muted}>Use um nome que a equipe reconheça. Um conjunto (como três bótons, um de cada cor) é uma só opção com vários materiais.</p>
      <div className={styles.fields}>
       <label>Nome da opção<input value={draft.name} maxLength={PRIZE_TIER_LIMITS.name} required onChange={event=>setDraft({...draft,name:event.target.value})} placeholder="Ex.: Conjunto de 3 bótons" disabled={locked}/></label>
       <label>Nível<select value={draft.tier} onChange={event=>setDraft({...draft,tier:event.target.value as PrizeTier})} disabled={locked}>{PRIZE_TIERS.map(tier=><option key={tier} value={tier}>{TIER_LABELS[tier]}</option>)}</select></label>
      </div>
      {draft.rows.map((row,index)=><div className={styles.componentRow} key={index}>
       <label>Material {index+1}<select value={row.itemId} required={index===0} disabled={locked} onChange={event=>setDraft({...draft,rows:draft.rows.map((current,position)=>position===index?{...current,itemId:event.target.value}:current)})}><option value="">{data.materials.length?'Escolha o material':'Nenhum brinde ativo no projeto'}</option>{data.materials.map(material=><option key={material.id} value={material.id}>{material.name}</option>)}</select></label>
       <label>Quantidade<input type="number" inputMode="numeric" min={1} max={PRIZE_TIER_LIMITS.quantity} step={1} value={row.quantity} disabled={locked} onChange={event=>setDraft({...draft,rows:draft.rows.map((current,position)=>position===index?{...current,quantity:event.target.value}:current)})}/></label>
       {draft.rows.length>1&&<button type="button" className={styles.icon} aria-label={`Remover material ${index+1}`} disabled={locked} onClick={()=>setDraft({...draft,rows:draft.rows.filter((_,position)=>position!==index)})}><Trash2 size={16} aria-hidden="true"/></button>}
      </div>)}
      <div className={styles.actions}>
       {draft.rows.length<PRIZE_TIER_LIMITS.components&&<button type="button" className={styles.quiet} onClick={()=>setDraft({...draft,rows:[...draft.rows,{itemId:'',quantity:'1'}]})} disabled={locked}><Plus size={16} aria-hidden="true"/>Outro material</button>}
       <span className={styles.spacer}/>
       <button type="button" className={styles.quiet} onClick={()=>setComposer(false)} disabled={locked}>Cancelar</button>
       <button type="submit" className={`${styles.primary} p-button-primary`} disabled={locked}>Criar opção</button>
      </div>
     </form>}
    </section>}

    <section className={styles.history} aria-labelledby={`tier-history-${campaignId}`}>
     <h4 id={`tier-history-${campaignId}`}><History size={17} aria-hidden="true"/>Histórico de mudanças</h4>
     {data.history.length?<><ol>{(allHistory?data.history:data.history.slice(0,8)).map(entry=><li key={entry.id}><p>{historyText(entry)}</p><small>{entry.actorName} · {when.format(new Date(entry.createdAt))}</small></li>)}</ol>{data.history.length>8&&<button type="button" className={styles.more} onClick={()=>setAllHistory(value=>!value)} aria-expanded={allHistory}>{allHistory?'Mostrar só as recentes':`Ver todas (${data.history.length})`}</button>}</>:<p className={styles.muted}>Ainda sem mudanças registradas nesta dinâmica.</p>}
    </section>
   </>}
  </div>
 </details>;
}
