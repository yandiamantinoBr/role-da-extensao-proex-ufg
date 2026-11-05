'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AudioLines, Check, CircleDollarSign, KeyRound, ScanText, Settings2, ShieldCheck, Stethoscope, Users } from 'lucide-react';
import { DEFAULT_ASSISTANT_CONFIG, validateConfig, type AssistantConfig } from '@/lib/assistant/contracts';
import AssistantConnectionPanel from './assistant-connection-panel';
import styles from './credential-vault-panel.module.css';

type Organization = { id: string; name: string; canConfigure: boolean; legacySttProvider?: 'groq' | 'deepgram'; usageIsMine?: boolean };
type Status = { organizationId: string; canConfigure: boolean; canDelegate?: boolean; revision?: number; config?: AssistantConfig; organizations: Organization[]; candidates?: {userId:string;name:string}[]; grants?: {id:string;userId:string}[] };
type Props = { canManageKeys?: boolean; refreshKey?: number; onChanged?: () => void; renderCredentials?: (organizationId: string, configurationBusy: boolean) => ReactNode };
class AdminError extends Error { constructor(readonly status: number, message: string) { super(message); } }
async function responseValue(response: Response): Promise<Record<string, unknown>> {
  const value: unknown = await response.json();
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('A consulta chegou incompleta. Atualize os ajustes.');
  if (!response.ok) throw new AdminError(response.status, typeof (value as Record<string, unknown>).error === 'string' ? String((value as Record<string, unknown>).error) : 'Não foi possível consultar os ajustes.');
  return value as Record<string, unknown>;
}
function statusValue(value: Record<string, unknown>): Status {
  if (!Array.isArray(value.organizations) || typeof value.canConfigure !== 'boolean' || typeof value.organizationId !== 'string' || value.organizations.some(org => !org || typeof org.id !== 'string' || typeof org.name !== 'string' || typeof org.canConfigure !== 'boolean')) throw new Error('A consulta chegou incompleta. Atualize os ajustes.');
  if (value.canConfigure && (!value.organizationId || !Number.isSafeInteger(value.revision) || Number(value.revision)<0 || !value.organizations.some(org=>org.id===value.organizationId&&org.canConfigure))) throw new Error('A consulta chegou incompleta. Atualize os ajustes.');
  if (value.canConfigure) value.config=validateConfig(value.config);
  return value as Status;
}
const post = async (input: Record<string, unknown>, signal: AbortSignal) => responseValue(await fetch('/api/assistant', { method:'POST', credentials:'same-origin', cache:'no-store', redirect:'error', signal, headers:{'Content-Type':'application/json','X-Proex-Action':'1'}, body:JSON.stringify(input) }));

export default function AssistantAdministrationPanel({ canManageKeys=false, refreshKey = 0, onChanged, renderCredentials }: Props) {
  const [selection,setSelection] = useState(''), [data,setData] = useState<{scope:string;status:Status}|null>(null), [refresh,setRefresh] = useState(0);
  const [config,setConfig] = useState<AssistantConfig>(DEFAULT_ASSISTANT_CONFIG), [busy,setBusy] = useState(false), [failure,setFailure] = useState(''), [notice,setNotice] = useState(''), [delegateId,setDelegateId] = useState(''), [view,setView] = useState<'keys'|'functions'|'diagnostics'>(canManageKeys?'keys':'functions');
  const active = useRef(true), epoch = useRef(0), mutationEpoch=useRef(0), mutation = useRef<AbortController|null>(null), message = useRef<HTMLParagraphElement>(null);
  const status = data?.scope === selection ? data.status : null;
  useEffect(() => { active.current=true; return () => { active.current=false; mutation.current?.abort(); }; }, []);
  useEffect(() => {
    const request = ++epoch.current, controller = new AbortController();
    void fetch('/api/assistant'+(selection?'?organizationId='+encodeURIComponent(selection):''), {cache:'no-store',credentials:'same-origin',signal:controller.signal,redirect:'error'})
      .then(responseValue).then(value => {
        if (!active.current || controller.signal.aborted || request!==epoch.current) return;
        const next = statusValue(value), configurable = next.organizations.filter(org=>org.canConfigure);
        if (!selection && configurable.length) { setSelection(configurable[0].id); return; }
        setData({scope:selection,status:next}); setConfig(next.config??DEFAULT_ASSISTANT_CONFIG); setFailure('');
      }).catch(error => { if (active.current&&!controller.signal.aborted&&request===epoch.current) { setData(null); setDelegateId(''); setFailure(error instanceof Error?error.message:'Não foi possível consultar os ajustes.'); } });
    return () => controller.abort();
  }, [selection,refresh,refreshKey]);
  useEffect(() => { if (notice||failure) message.current?.focus(); }, [notice,failure]);
  function selectOrganization(value: string) { mutation.current?.abort(); ++epoch.current; ++mutationEpoch.current; setSelection(value); setData(null); setFailure(''); setNotice(''); setDelegateId(''); setBusy(false); }
  async function save(action: 'configure'|'grant.create'|'grant.revoke', grantId?: string) {
    if (busy || !status?.canConfigure || !status.organizationId || status.organizationId!==selection) return;
    const request=++mutationEpoch.current, controller=new AbortController(); mutation.current?.abort(); mutation.current=controller;
    setBusy(true); setFailure(''); setNotice('');
    try {
      await post({action,organizationId:selection,...(action==='configure'?{config,expectedRevision:status.revision??0}:grantId?{grantId}:{userId:delegateId})},controller.signal);
      if (!active.current||controller.signal.aborted||request!==mutationEpoch.current) return;
      setNotice(action==='configure'?'Funções, acesso e limites salvos. Nenhuma chamada de IA foi iniciada.':action==='grant.create'?'Permissão de configuração concedida. Isso não libera cadastro de chaves.':'Permissão de configuração revogada.'); setDelegateId(''); setData(null); setRefresh(value=>value+1); onChanged?.();
    } catch(error) {
      if (!active.current||controller.signal.aborted||request!==mutationEpoch.current) return;
      if (error instanceof AdminError&&(error.status===401||error.status===403)) { setData(null); setDelegateId(''); }
      setFailure(error instanceof Error?error.message:'Não foi possível salvar os ajustes.');
    } finally { if (active.current&&!controller.signal.aborted&&request===mutationEpoch.current) setBusy(false); }
  }
  const organizations=status?.organizations.filter(org=>org.canConfigure)??[];
  const provider=config.sttProvider==='groq'||config.sttProvider==='deepgram'?config.sttProvider:status?.organizations.find(org=>org.id===selection)?.legacySttProvider??'deepgram';
  return <div className={styles.panel}>
    <div className={styles.heading}><span className="p-icon-tile"><Settings2 size={21} aria-hidden="true"/></span><div><h3>Central de inteligência artificial</h3><p>{canManageKeys?'Cadastre uma chave, escolha quem pode usar e habilite apenas o necessário.':'Ajuste o uso, as funções e os limites autorizados. O cadastro de chaves fica com a administração geral.'}</p></div></div>
    {(failure||notice)&&<p ref={message} tabIndex={-1} role={failure?'alert':'status'} className={failure?'p-inline-error':styles.note}>{failure||notice}</p>}
    {!status&&!failure&&<p role="status">Consultando suas permissões e os ajustes…</p>}
    {failure&&<button type="button" className="p-button p-button-subtle" disabled={busy} onClick={()=>{setFailure('');setRefresh(value=>value+1);}}>Atualizar ajustes</button>}
    {status&&!organizations.length&&<p className={styles.note}>Você não tem autorização para administrar IA. Peça ao responsável da organização uma permissão nominal de configuração.</p>}
    {!!organizations.length&&<label className="p-field"><span>Organização dos ajustes de IA</span><select value={selection} disabled={busy} onChange={event=>selectOrganization(event.target.value)}>{organizations.map(org=><option key={org.id} value={org.id}>{org.name}</option>)}</select></label>}
    {status?.canConfigure&&status.organizationId===selection&&<>
      <div className={styles.views} role="group" aria-label="Áreas da central de IA">
        {canManageKeys&&<button type="button" disabled={busy} aria-pressed={view==='keys'} onClick={()=>setView('keys')}><KeyRound size={18} aria-hidden="true"/>Chaves</button>}
        <button type="button" disabled={busy} aria-pressed={view==='functions'} onClick={()=>setView('functions')}><Settings2 size={18} aria-hidden="true"/>Funções e acesso</button>
        <button type="button" disabled={busy} aria-pressed={view==='diagnostics'} onClick={()=>setView('diagnostics')}><Stethoscope size={18} aria-hidden="true"/>Diagnóstico</button>
      </div>
      {view==='keys'&&canManageKeys&&<>{renderCredentials?.(selection,busy)}<button type="button" className="p-button p-button-subtle" disabled={busy} onClick={()=>setView('functions')}>Continuar: funções e acesso</button><details className={styles.configuration}><summary>Outros provedores e modelos</summary><p>Anthropic, Gemini, NVIDIA e endereços personalizados ainda não têm adaptadores de operação neste portal. Cada integração precisa de modelo e endereço permitidos, limite de custo, contrato de resposta, permissões e testes próprios antes de receber uma chave. Não há cadastro genérico que prometa funcionar com qualquer API.</p></details></>}
      {view==='functions'&&<>
      <section className={styles.configuration} aria-labelledby="ai-usage-title"><div className={styles.heading}><ShieldCheck size={21} aria-hidden="true"/><div><h4 id="ai-usage-title">Quem pode usar a IA</h4><p>É uma política única para todas as funções e modelos desta organização. Alterar aqui afeta os demais integrantes. As permissões de cada projeto continuam valendo.</p></div></div>
        <label className="p-field"><span>Acesso ao uso</span><select disabled={busy} value={config.usageScope??'organization'} onChange={event=>setConfig({...config,usageScope:event.target.value as AssistantConfig['usageScope']})}><option value="private">Só eu</option><option value="organization">Organização</option></select></label>
        <p className="p-form-help">“Só eu” vincula o uso à sua conta ao salvar. “Organização” libera para integrantes com permissão na atividade. Não dá acesso a outros projetos, ao cofre ou à planilha mestre.</p>
        {config.usageScope==='private'&&status.organizations.find(org=>org.id===selection)?.usageIsMine===false&&<p className={styles.note}>O uso está privado para outra conta. Se salvar a opção “Só eu”, ele passa a ficar vinculado à sua conta.</p>}
      </section>
      <section className={styles.configuration} aria-labelledby="ai-functions-title"><div className={styles.heading}><ScanText size={21} aria-hidden="true"/><div><h4 id="ai-functions-title">Funções e modelos revisados</h4><p>Uma chave disponível não liga nenhuma função automaticamente.</p></div></div>
        <label className="p-field"><span>Provedor de texto e documentos</span><select disabled={busy} value={config.textProvider} onChange={event=>setConfig({...config,textProvider:event.target.value as AssistantConfig['textProvider'],enabled:false,documentEnabled:false})}><option value="deepseek">DeepSeek · Flash</option><option value="openai">OpenAI · GPT-5.6 Luna</option></select></label>
        <label className="p-field"><span>Modelo de texto permitido nesta versão</span><input readOnly value={config.textProvider==='openai'?config.openaiModel:config.model}/></label>
        <p className="p-form-help">Trocar o provedor desmarca as duas funções para nova confirmação. O portal usa somente a chave do provedor escolhido, sem troca automática. {config.textProvider==='openai'?'OpenAI: preço de referência de US$ 0,20 por milhão de tokens de entrada e US$ 1,20 de saída; a reserva preventiva considera US$ 0,25 na entrada. O modelo é um alias e pode mudar no provedor.':'DeepSeek: permanece o contrato Flash já revisado.'}</p>
        <label className={styles.confirm}><input type="checkbox" disabled={busy} checked={config.enabled} onChange={event=>setConfig({...config,enabled:event.target.checked})}/><span><strong>Pedidos de operações · {config.textProvider==='openai'?'OpenAI':'DeepSeek Flash'}</strong><small>Prepara consultas e propostas; uma pessoa confere antes de aplicar.</small></span></label>
        <label className={styles.confirm}><input type="checkbox" disabled={busy} checked={config.documentEnabled} onChange={event=>setConfig({...config,documentEnabled:event.target.checked})}/><span><strong>Interpretação de documentos</strong><small>{config.textProvider==='openai'?'OpenAI':'DeepSeek'} extrai campos autorizados; cada documento precisa de consentimento e revisão.</small></span></label>
        <label className={styles.confirm}><input type="checkbox" disabled={busy} checked={config.jevEnabled} onChange={event=>setConfig({...config,jevEnabled:event.target.checked})}/><span><strong>Conferência e triagem · JEV 1.14.0</strong><small>TypeSafe sugere decisões dentro do contrato. Em caso de dúvida, a decisão fica manual.</small></span></label>
        <div className={styles.voice}><div className={styles.heading}><AudioLines size={20} aria-hidden="true"/><h4>Transcrição de áudio</h4></div><label className="p-field"><span>Provedor de transcrição</span><select disabled={busy} value={config.sttProvider??'legacy'} onChange={event=>setConfig({...config,sttProvider:event.target.value as AssistantConfig['sttProvider'],sttEnabled:false})}><option value="legacy">Manter configuração anterior</option><option value="groq">Groq · Whisper Large V3 Turbo</option><option value="deepgram">Deepgram · Nova-3</option></select></label>
          <label className={styles.confirm}><input type="checkbox" disabled={busy} checked={config.sttEnabled} onChange={event=>setConfig({...config,sttEnabled:event.target.checked})}/><span>Habilitar transcrição {provider==='groq'?'Groq':'Deepgram'} em português</span></label><p className="p-form-help">Trocar o provedor desmarca a função para nova confirmação. O texto transcrito só é usado depois de revisado. {provider==='groq'?'Reserva estimada de US$ 0,04 por hora, com mínimo de 10 segundos por envio. A faixa gratuita depende da conta Groq.':'O custo e a autorização de transcrição dependem da conta Deepgram.'}</p>
        </div>
      </section>
      <details className={styles.configuration}><summary><CircleDollarSign size={20} aria-hidden="true"/>Limites e cotas · até US$ {config.dailyUsdMicros/1_000_000}/dia</summary><p>Os limites são compartilhados pela organização. As reservas bloqueiam novas chamadas ao atingir o teto. Falhas também consomem a reserva preventiva.</p><div className={styles.limitGrid}>
        <label className="p-field"><span>Teto diário em dólares (US$)</span><input disabled={busy} type="number" min="0.001" max="10" step="0.001" value={config.dailyUsdMicros/1_000_000} onChange={event=>setConfig({...config,dailyUsdMicros:Math.round(Number(event.target.value)*1_000_000)})}/></label>
        <label className="p-field"><span>Chamadas por dia</span><input disabled={busy} type="number" min="1" max="100" step="1" value={config.dailyCalls} onChange={event=>setConfig({...config,dailyCalls:Number(event.target.value)})}/></label>
        <label className="p-field"><span>Tokens por dia</span><input disabled={busy} type="number" min="1000" max="1000000" step="1" value={config.dailyTokens} onChange={event=>setConfig({...config,dailyTokens:Number(event.target.value)})}/></label>
        <label className="p-field"><span>Prazo por chamada em segundos</span><input disabled={busy} type="number" min="1" max="20" step="1" value={config.timeoutMs/1000} onChange={event=>setConfig({...config,timeoutMs:Number(event.target.value)*1000})}/></label>
      </div></details><div className={styles.actions}><button type="button" disabled={busy} className="p-button p-button-primary" onClick={()=>void save('configure')}><Check size={18} aria-hidden="true"/>{busy?'Salvando…':'Salvar funções, acesso e limites'}</button></div>
      {status.canDelegate&&<details className={styles.configuration}><summary><Users size={19} aria-hidden="true"/>Quem pode configurar esta organização</summary><p className="p-form-help">A permissão é nominal, não vem do nome da equipe TI. Ela permite ajustar funções, acesso, limites e diagnóstico; não permite cadastrar ou recuperar chaves.</p><label className="p-field"><span>Integrante autorizado</span><select disabled={busy} value={delegateId} onChange={event=>setDelegateId(event.target.value)}><option value="">Escolha uma pessoa da organização</option>{status.candidates?.map(person=><option key={person.userId} value={person.userId}>{person.name}</option>)}</select></label><button type="button" disabled={busy||!delegateId} className="p-button p-button-subtle" onClick={()=>void save('grant.create')}>Permitir configuração de IA</button><ul className={styles.list}>{status.grants?.map(grant=><li className={styles.delegate} key={grant.id}><span>{status.candidates?.find(person=>person.userId===grant.userId)?.name??'Integrante autorizado'}</span><button type="button" className="p-button p-button-subtle" disabled={busy} onClick={()=>void save('grant.revoke',grant.id)}>Revogar permissão</button></li>)}</ul></details>}
      </>}
      {view==='diagnostics'&&(Number(status.revision)>0?<AssistantConnectionPanel key={`${selection}:${status.revision}`} orgId={selection} revision={status.revision!}/>:<p className={styles.note} role="status">Salve as funções e as credenciais antes de consultar os diagnósticos.</p>)}
    </>}
  </div>;
}
