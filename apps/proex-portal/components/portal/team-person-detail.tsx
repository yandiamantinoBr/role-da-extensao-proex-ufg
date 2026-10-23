'use client';
import {useEffect,useState,type ReactNode} from 'react';
import {ArrowUpRight,Building2,Check,ContactRound,LoaderCircle,Mail,Phone,ShieldCheck,UserRound,X} from 'lucide-react';
import {Dialog,DialogContent,DialogDescription,DialogTitle} from '@/components/ui/dialog';
import styles from './team-person.module.css';

type Member={id:string;role:string;project_id:string|null;revoked_at:string|null};
type Person={userId:string;displayName:string;email:string|null;status:string;isAnonymized:boolean;isSelf:boolean;
 unitId:string|null;unit:string;organizationalUnit:{name:string;acronym:string}|null;affiliation:string;jobTitle:string;phone:string;
 registrationType:string;registrationNumber:string;avatarUrl:string|null;members:Member[]};
type Props={userId:string;projectId?:string;projects:{id:string;name:string}[];onClose():void;onOpenOwnProfile?():void};
const AFFILIATIONS:Record<string,string>={student:'Estudante',technical:'Técnico-administrativo',faculty:'Docente',scholar:'Bolsista',intern:'Estagiário',collaborator:'Colaborador',other:'Outro vínculo'};
const ROLES:Record<string,string>={owner:'Responsável institucional',manager:'Gestor de projeto',operator:'Operador de evento',inventory:'Responsável por materiais',loans:'Responsável por empréstimos',viewer:'Leitor de relatórios'};
function DetailField({label,value,icon}:{label:string;value:string|null;icon?:ReactNode}){
 return <div className={styles.field}><dt>{icon}{label}</dt><dd className={!value?styles.unfilled:undefined}>{value||'Não informado'}</dd></div>;
}
export default function TeamPersonDetail({userId,projectId,projects,onClose,onOpenOwnProfile}:Props){
 const [person,setPerson]=useState<Person|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[brokenAvatar,setBrokenAvatar]=useState('');
 useEffect(()=>{
  const controller=new AbortController(),query=new URLSearchParams();if(projectId)query.set('projectId',projectId);
  void fetch(`/api/team/${encodeURIComponent(userId)}${query.size?`?${query}`:''}`,{credentials:'same-origin',cache:'no-store',signal:controller.signal})
   .then(async response=>{const body=await response.json().catch(()=>null) as {person?:Person;error?:string}|null;if(!response.ok)throw new Error(body?.error||'Não foi possível recuperar este perfil.');if(!body?.person||body.person.userId!==userId||typeof body.person.displayName!=='string'||!Array.isArray(body.person.members))throw new Error('Atualize a página para recuperar este perfil.');if(!controller.signal.aborted)setPerson(body.person);})
   .catch(cause=>{if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:'Não foi possível recuperar este perfil.');})
   .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
  return()=>controller.abort();
 },[userId,projectId]);
 const title=person?.displayName||'Perfil da equipe';
 const unit=person?.organizationalUnit?`${person.organizationalUnit.name}${person.organizationalUnit.acronym?` · ${person.organizationalUnit.acronym}`:''}`:null;
 const registrationLabel=person?.registrationType==='siape'?'Matrícula SIAPE':person?.registrationType==='student'?'Matrícula de estudante':'Identificação institucional';
 return <Dialog open onOpenChange={open=>{if(!open)onClose();}}><DialogContent className={styles.dialog} showCloseButton={false}>
  <div className={styles.topline}><span>PROEX · EQUIPE</span><button className={styles.close} type="button" onClick={onClose} aria-label="Fechar perfil"><X size={20}/></button></div>
  <header className={styles.hero}>
   <span className={styles.detailAvatar}><UserRound size={38} aria-hidden="true"/>{person?.avatarUrl&&brokenAvatar!==person.avatarUrl&&<img src={person.avatarUrl} alt="" width={96} height={96} onError={()=>setBrokenAvatar(person.avatarUrl||'')}/>}</span>
   <div className={styles.heroText}><div className={styles.eyebrow}>Perfil da equipe{person?.isSelf&&<span><Check size={13}/>Seu perfil</span>}</div><DialogTitle className={styles.name}>{title}</DialogTitle><DialogDescription className={styles.subtitle}>{person?.isAnonymized?'Dados da conta removidos. O histórico institucional é preservado.':person?AFFILIATIONS[person.affiliation]||person.jobTitle||'Informações institucionais opcionais':'Consulte as informações preenchidas pela pessoa.'}</DialogDescription>{person&&<span className={`p-badge ${person.status==='blocked'?'p-status-cancelled':'p-status-active'}`}>{person.isAnonymized?'Conta anonimizada':person.status==='blocked'?'Acesso bloqueado':'Conta ativa'}</span>}</div>
  </header>
  {loading&&<div className={styles.loading} role="status"><LoaderCircle size={22} className="p-spin"/>Carregando perfil…</div>}
  {error&&<div className={styles.body}><p className="p-inline-error" role="alert">{error}</p><p className="p-form-help">Feche esta janela e atualize a Equipe para verificar os acessos disponíveis.</p></div>}
  {person&&<div className={styles.body}>
   <section aria-label="Informações institucionais"><h3 className={styles.sectionTitle}><ContactRound size={18}/>Dados do perfil</h3><dl className={styles.fields}>
    <DetailField label="E-mail de cadastro" value={person.email} icon={<Mail size={15}/>}/>
    <DetailField label="Telefone de contato" value={person.phone} icon={<Phone size={15}/>}/>
    <DetailField label="Unidade institucional" value={unit} icon={<Building2 size={15}/>}/>
    <DetailField label="Unidade ou setor informado" value={person.unit}/>
    <DetailField label="Vínculo institucional" value={AFFILIATIONS[person.affiliation]||null}/>
    <DetailField label="Função ou atividade" value={person.jobTitle}/>
    <DetailField label={registrationLabel} value={person.registrationNumber}/>
   </dl></section>
   <section className={styles.memberships} aria-label="Acessos neste contexto"><h3 className={styles.sectionTitle}><ShieldCheck size={18}/>Acessos neste contexto</h3>{person.members.length?<ul>{person.members.map(member=><li key={member.id}><span><strong>{member.project_id?projects.find(project=>project.id===member.project_id)?.name||'Projeto':'Toda a organização'}</strong><small>{ROLES[member.role]||'Integrante'}</small></span><span className={`p-badge ${member.revoked_at?'p-status-revoked':'p-status-active'}`}>{member.revoked_at?'Revogado':'Ativo'}</span></li>)}</ul>:<p className="p-form-help">Sem vínculo neste contexto.</p>}</section>
   <p className={styles.note}>Os dados institucionais são preenchidos pela própria pessoa. As permissões de acesso são definidas pela gestão em cada projeto.</p>
  </div>}
  <footer className={styles.footer}><button className="p-button p-button-subtle" type="button" onClick={onClose}>Fechar perfil</button>{person?.isSelf&&!person.isAnonymized&&(onOpenOwnProfile?<button className="p-button p-button-primary" type="button" onClick={()=>{onClose();onOpenOwnProfile();}}>Editar meu perfil<ArrowUpRight size={16}/></button>:<a className="p-button p-button-primary" href="/?module=profile">Editar meu perfil<ArrowUpRight size={16}/></a>)}</footer>
 </DialogContent></Dialog>;
}
