'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Check, ChevronDown, Copy, ExternalLink, Eye, EyeOff, FileSpreadsheet, KeyRound, Link2, LoaderCircle, RefreshCw, ShieldCheck, Unplug, X } from 'lucide-react';
import styles from './project-sheets-panel.module.css';

type SheetTab = { gid: number | string; url: string };
type Connection = { id: string; projectId: string; spreadsheetId: string; spreadsheetUrl: string; label: string; enabled: boolean; includeTasks: boolean; version: number; tabsVersion: number; tabs: Record<string, SheetTab>; updatedAt?: string };
type Credential = { id: string; label: string; scope: string; connection_version: number; created_at: string; expires_at: string; revoked_at: string | null; last_used_at: string | null };
type Snapshot = { projectId: string; canManage: boolean; connection: Connection | null; tokens: Credential[]; scriptUrl: string; notice?: string };
type Props = { projectId: string; projectName?: string };
const tabLabels: Record<string, string> = { projects: 'Projeto', material_categories: 'Categorias', items: 'Materiais', stock_movements: 'Movimentações', activity_groups: 'Grupos de atividades', loans: 'Empréstimos', campaigns: 'Dinâmicas', project_schedule_items: 'Cronograma', followup_tasks: 'Demandas' };
const sheetIdShape = /^[A-Za-z0-9_-]{20,200}$/;
export function projectSheetId(value: string) {
 const raw = value.trim(); if (sheetIdShape.test(raw)) return raw;
 try { const url = new URL(raw); if (url.protocol !== 'https:' || url.hostname !== 'docs.google.com' || url.username || url.password) return ''; const match = /^\/spreadsheets\/d\/([A-Za-z0-9_-]{20,200})(?:\/|$)/.exec(url.pathname); return match?.[1] ?? ''; } catch { return ''; }
}
function safeSheetUrl(raw: unknown, spreadsheetId: string) {
 if (typeof raw !== 'string' || projectSheetId(raw) !== spreadsheetId) return '';
 try { return new URL(raw).href; } catch { return ''; }
}
function dateLabel(value: string | null | undefined) { if (!value) return 'Ainda não usada'; const date = new Date(value); return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }).format(date) : 'Data indisponível'; }
function snapshot(value: unknown, projectId: string): Snapshot {
 if (!value || typeof value !== 'object') throw new Error('A resposta da planilha está incompleta. Atualize para tentar de novo.');
 const row = value as Snapshot;
 if (row.projectId !== projectId || typeof row.canManage !== 'boolean' || !Array.isArray(row.tokens) || row.connection !== null && (!row.connection || row.connection.projectId !== projectId || !sheetIdShape.test(row.connection.spreadsheetId) || !Number.isInteger(row.connection.version) || typeof row.connection.label !== 'string' || typeof row.connection.enabled !== 'boolean' || !row.connection.tabs || typeof row.connection.tabs !== 'object' || Array.isArray(row.connection.tabs))) throw new Error('A resposta não corresponde à planilha deste projeto.');
 return row;
}
async function request(url: string, input?: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
 const response = await fetch(url, { cache: 'no-store', signal, ...(input ? { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Proex-Action': '1' }, body: JSON.stringify(input) } : {}) });
 let body: unknown; try { body = await response.json(); } catch { throw new Error('A resposta da planilha veio incompleta. Tente novamente.'); }
 if (!response.ok) throw new Error(body && typeof body === 'object' && 'error' in body && typeof body.error === 'string' ? body.error : 'Não foi possível consultar a planilha deste projeto.');
 return body;
}

/** A project link is a separate document; a filtered master sheet is never offered here. */
export default function ProjectSheetsPanel({ projectId, projectName = 'Projeto' }: Props) {
 const [stored, setStored] = useState<{projectId: string; value: Snapshot} | null>(null);
 const [reload, setReload] = useState(0), [failure, setFailure] = useState<{projectId: string; text: string} | null>(null);
 const [working, setWorking] = useState<{projectId: string; action: string} | null>(null);
 const [feedback, setFeedback] = useState<{projectId: string; text: string} | null>(null);
 const [secret, setSecret] = useState<{projectId: string; value: string; expiresAt: string} | null>(null);
 const [reveal, setReveal] = useState(false), [confirmRevoke, setConfirmRevoke] = useState('');
 const generation = useRef(0), management = useRef<HTMLDetailsElement>(null), secretInput = useRef<HTMLInputElement>(null);
 const endpoint = `/api/projects/${encodeURIComponent(projectId)}/sheets`;
 useEffect(() => {
  const controller = new AbortController(), current = ++generation.current;
  const timer = window.setTimeout(() => { setSecret(null); setReveal(false); setConfirmRevoke(''); setFailure(null); setWorking(null); setFeedback(null); void request(endpoint, undefined, controller.signal).then(value => {
   if (!controller.signal.aborted && current === generation.current) setStored({ projectId, value: snapshot(value, projectId) });
  }).catch(error => { if (!controller.signal.aborted && current === generation.current) { setStored(null); setFailure({ projectId, text: error instanceof Error ? error.message : 'Não foi possível consultar a planilha.' }); } }); }, 0);
  return () => { window.clearTimeout(timer); controller.abort(); generation.current = current + 1; };
 }, [endpoint, projectId, reload]);
 const data = stored?.projectId === projectId ? stored.value : null;
 const connection = data?.connection;
 const busy = working?.projectId === projectId;
 const currentSecret = secret?.projectId === projectId && data?.canManage ? secret : null;
 const currentFailure = failure?.projectId === projectId ? failure.text : '';
 const currentFeedback = feedback?.projectId === projectId ? feedback.text : '';
 const clearSecret = () => { setSecret(null); setReveal(false); };
 async function action(kind: string, input: Record<string, unknown>, accept: (value: unknown) => void) {
  if (busy || !data?.canManage) return;
  const current = generation.current;
  setWorking({ projectId, action: kind }); setFailure(null); setFeedback(null);
  try { const value = await request(endpoint, input); if (current === generation.current) accept(value); }
  catch (error) { if (current === generation.current) setFailure({ projectId, text: error instanceof Error ? error.message : 'Não foi possível salvar a conexão.' }); }
  finally { if (current === generation.current) setWorking(null); }
 }
 async function configure(event: FormEvent<HTMLFormElement>) {
  event.preventDefault(); const form = new FormData(event.currentTarget), spreadsheetId = projectSheetId(String(form.get('spreadsheet') ?? ''));
  if (!spreadsheetId) { setFailure({ projectId, text: 'Cole o link de uma planilha do Google Sheets ou seu identificador.' }); return; }
  clearSecret();
  await action('configure', { action: 'configure', spreadsheetId, label: String(form.get('label') ?? '').trim(), expectedVersion: connection?.version ?? 0, enabled: form.get('enabled') === 'on', includeTasks: form.get('includeTasks') === 'on' }, value => { setStored({ projectId, value: snapshot(value, projectId) }); setFeedback({ projectId, text: 'Vínculo salvo. Instale ou atualize o conector nesta planilha para sincronizar.' }); });
 }
 async function createCredential(event: FormEvent<HTMLFormElement>) {
  event.preventDefault(); if (!connection) return; clearSecret();
  const form = new FormData(event.currentTarget);
  await action('credential', { action: 'token.create', scope: String(form.get('scope')), label: String(form.get('credentialLabel') ?? '').trim(), expectedVersion: connection.version }, value => {
   const row = value as { id?: string; token?: string; expiresAt?: string; connectionVersion?: number };
   if (!row || typeof row.id !== 'string' || typeof row.token !== 'string' || !/^pxp_[A-Za-z0-9_-]{20,300}$/.test(row.token) || typeof row.expiresAt !== 'string' || !Number.isFinite(Date.parse(row.expiresAt)) || row.connectionVersion !== connection.version) throw new Error('A chave recebida está incompleta. Consulte as conexões antes de tentar novamente.');
   if (!management.current?.open) { setFeedback({ projectId, text: 'A chave foi criada e descartada desta tela porque a seção foi fechada. Consulte a lista para revogar esta conexão, se necessário.' }); return; }
   setSecret({ projectId, value: row.token, expiresAt: row.expiresAt });
   setFeedback({ projectId, text: 'Chave criada. Copie agora e cole somente no conector desta planilha.' });
  });
 }
 async function revoke(id: string) {
  clearSecret();
  await action('revoke', { action: 'token.revoke', id }, value => {
   const row = value as {id?: string; revokedAt?: string}; if (row?.id !== id || typeof row.revokedAt !== 'string') throw new Error('Não foi possível confirmar a revogação. Atualize a lista.');
   setStored(current => current?.projectId === projectId ? { ...current, value: { ...current.value, tokens: current.value.tokens.map(token => token.id === id ? { ...token, revoked_at: row.revokedAt! } : token) } } : current);
   setConfirmRevoke(''); setFeedback({ projectId, text: 'Chave revogada. Esta conexão não poderá mais usá-la.' });
  });
 }
 async function copySecret() {
  if (!currentSecret) return;
  try { await navigator.clipboard.writeText(currentSecret.value); setFeedback({ projectId, text: 'Chave copiada. Cole no conector desta planilha.' }); }
  catch { secretInput.current?.focus(); secretInput.current?.select(); setFeedback({ projectId, text: 'A cópia automática foi bloqueada. A chave está selecionada para você copiar.' }); }
 }
 const tokens = data?.canManage ? data.tokens.filter(token => token && typeof token.id === 'string' && typeof token.label === 'string' && ['read', 'materials'].includes(token.scope)) : [];
 const links = connection ? Object.entries(connection.tabs).flatMap(([key, tab]) => { const href = safeSheetUrl(tab?.url, connection.spreadsheetId); return href && tabLabels[key] && (key !== 'followup_tasks' || connection.includeTasks) ? [{ key, label: tabLabels[key], href }] : []; }) : [];
 return <section id="project-sheets-live" className={`p-card ${styles.panel}`} aria-label="Planilha sincronizada do projeto">
  <div className={styles.heading}><div><h3><FileSpreadsheet size={19} aria-hidden="true"/>Planilha do projeto</h3><p>Abra no Google Sheets para consultar e editar com o acesso da sua conta Google.</p></div><button type="button" className="p-icon-button" aria-label="Atualizar vínculo da planilha" disabled={busy} onClick={() => { clearSecret(); setStored(null); setReload(value => value + 1); }}><RefreshCw size={17} aria-hidden="true"/></button></div>
  {currentFailure && <p className="p-inline-error" role="alert">{currentFailure}</p>}
  {!data && !currentFailure && <p className={styles.notice} role="status"><LoaderCircle size={16} className="p-spin" aria-hidden="true"/>Consultando a planilha deste projeto…</p>}
  {data && <>
   {connection ? <div className={styles.connection}><div className={styles.connectionTitle}><FileSpreadsheet size={23} aria-hidden="true"/><div><strong>{connection.label || projectName}</strong><small>{connection.enabled ? 'Conexão habilitada' : 'Conexão pausada'}{connection.updatedAt ? ` · vínculo atualizado em ${dateLabel(connection.updatedAt)}` : ''}</small></div>{safeSheetUrl(connection.spreadsheetUrl, connection.spreadsheetId) && <a className="p-button p-button-subtle" href={safeSheetUrl(connection.spreadsheetUrl, connection.spreadsheetId)} target="_blank" rel="noopener noreferrer">Abrir planilha <ExternalLink size={15} aria-hidden="true"/></a>}</div>
    {links.length > 0 ? <nav className={styles.tabLinks} aria-label="Abas da planilha deste projeto">{links.map(link => <a key={link.key} href={link.href} target="_blank" rel="noopener noreferrer">{link.label}<ExternalLink size={13} aria-hidden="true"/></a>)}</nav> : <p className={styles.notice}>Os atalhos de Materiais, Demandas e outras abas aparecerão após a primeira atualização pelo conector.</p>}
    <p className={styles.notice}>Esta é uma planilha específica do projeto. O acesso no Google depende do compartilhamento feito no Drive.</p>
   </div> : <p className={styles.empty}><Link2 size={18} aria-hidden="true"/>Nenhuma conexão de sincronização configurada para este projeto.{data.canManage ? ' Vincule abaixo uma planilha para a equipe.' : ' Peça ao responsável pelo projeto para vincular uma.'}</p>}
   {data.canManage && <details ref={management} className={styles.manage} onToggle={event => { if (!event.currentTarget.open) { clearSecret(); setConfirmRevoke(''); } }}><summary><ShieldCheck size={16} aria-hidden="true"/>Gerenciar conexão com o Sheets<ChevronDown size={16} aria-hidden="true"/></summary><div className={styles.managementBody}>
    <form key={`${projectId}:${connection?.version ?? 0}`} onSubmit={configure} className={styles.form}><h4>1. Vincular uma planilha</h4><p className={styles.notice}>Use uma planilha dedicada a este projeto. O portal não cria nem compartilha o documento no Google.</p><fieldset disabled={busy}><label className="p-field"><span>Link ou identificador da planilha</span><input name="spreadsheet" defaultValue={connection?.spreadsheetUrl ?? ''} required maxLength={600} placeholder="https://docs.google.com/spreadsheets/d/…"/></label><label className="p-field"><span>Nome para a equipe</span><input name="label" defaultValue={connection?.label ?? projectName} required maxLength={120}/></label><label className={styles.checkbox}><input name="enabled" type="checkbox" defaultChecked={connection?.enabled ?? true}/>Habilitar o conector</label><label className={styles.checkbox}><input name="includeTasks" type="checkbox" defaultChecked={connection?.includeTasks ?? false}/><span>Incluir resumo das demandas neste arquivo<small>Todos com acesso ao arquivo no Google poderão ler os títulos, prioridades, estados e prazos de todas as demandas deste projeto. Corpos, responsáveis e contatos não são enviados.</small></span></label>{connection && <p className={styles.notice}>Salvar o vínculo revoga as chaves anteriores e reinicia os atalhos. Gere uma nova chave e atualize o conector.</p>}<button type="submit" className="p-button p-button-primary">{busy && working?.action === 'configure' ? <LoaderCircle size={16} className="p-spin"/> : <Link2 size={16}/>}Salvar vínculo</button></fieldset></form>
    {connection && <><form className={styles.form} onSubmit={createCredential}><h4>2. Autorizar o conector deste projeto</h4><p className={styles.notice}>A chave vale por 30 dias e aparece uma única vez. Não dá acesso à planilha mestre.</p><fieldset disabled={busy || !connection.enabled}><label className="p-field"><span>Nome desta conexão</span><input name="credentialLabel" maxLength={120} required placeholder="Ex.: conector da equipe"/></label><label className="p-field"><span>Permissão no portal</span><select name="scope" defaultValue="read"><option value="read">Consultar dados deste projeto</option><option value="materials">Consultar, cadastrar e editar materiais deste projeto</option></select></label><button type="submit" className="p-button p-button-subtle"><KeyRound size={16} aria-hidden="true"/>{busy && working?.action === 'credential' ? 'Criando…' : 'Criar chave por 30 dias'}</button></fieldset></form>
     {currentSecret && <div className={styles.secret} role="region" aria-label="Chave criada uma única vez"><div className={styles.secretHeading}><strong>Copie a chave agora</strong><button type="button" className="p-icon-button" aria-label="Descartar chave desta tela" onClick={clearSecret}><X size={16}/></button></div><p>Válida até {dateLabel(currentSecret.expiresAt)}. Ao fechar esta seção ou trocar de projeto, ela sai desta tela.</p><label className="p-field"><span>Chave restrita ao projeto</span><input ref={secretInput} type={reveal ? 'text' : 'password'} autoComplete="off" readOnly value={currentSecret.value}/></label><div className={styles.actions}><button type="button" className="p-button p-button-subtle" onClick={copySecret}><Copy size={16}/>{'Copiar chave'}</button><button type="button" className="p-button p-button-subtle" aria-pressed={reveal} onClick={() => setReveal(value => !value)}>{reveal ? <EyeOff size={16}/> : <Eye size={16}/>}{reveal ? 'Ocultar' : 'Mostrar'}</button></div></div>}
     <div className={styles.form}><h4>3. Instalar no Google Sheets</h4><ol className={styles.steps}><li>Abra a planilha vinculada e acesse <strong>Extensões → Apps Script</strong>.</li><li><a href="/integracoes/proex-projeto-planilha.gs" target="_blank" rel="noopener noreferrer">Abra o código do conector <ExternalLink size={13}/></a>, copie para o editor e siga as instruções no início do arquivo.</li><li>Configure o endereço do portal e a chave que você criou. Execute e autorize com a conta que pode editar a planilha.</li><li>Após a primeira atualização, confira os atalhos acima e o resultado de cadastro/edição nos dois ambientes.</li></ol><p className={styles.notice}>O script precisa ser instalado e autorizado no Google. Vincular o endereço aqui, sozinho, não inicia uma sincronização.</p></div>
     <div className={styles.form}><div className={styles.heading}><h4>Chaves emitidas</h4><button type="button" className="p-text-link" disabled={busy} onClick={() => { clearSecret(); setReload(value => value + 1); }}>Atualizar lista</button></div>{tokens.length ? <ul className={styles.credentials}>{tokens.map(token => <li key={token.id}><div><strong>{token.label}</strong><small>{token.scope === 'materials' ? 'Consulta e edição de materiais' : 'Somente consulta'} · {token.revoked_at ? 'Revogada' : `Expira em ${dateLabel(token.expires_at)}`}</small><small>Último uso: {dateLabel(token.last_used_at)}</small></div>{!token.revoked_at && (confirmRevoke === token.id ? <div className={styles.revokeConfirm}><span>Interromper esta conexão?</span><button type="button" className="p-button p-button-subtle" disabled={busy} onClick={() => setConfirmRevoke('')}>Cancelar</button><button type="button" className="p-button p-button-subtle" disabled={busy} onClick={() => void revoke(token.id)}>Confirmar revogação</button></div> : <button type="button" className="p-button p-button-subtle" disabled={busy} onClick={() => setConfirmRevoke(token.id)}><Unplug size={15}/>Revogar</button>)}</li>)}</ul> : <p className={styles.notice}>Nenhuma chave listada. Atualize a lista após criar uma.</p>}</div>
    </>}
   </div></details>}
  </>}
  {currentFeedback && <p className={styles.feedback} role="status"><Check size={16} aria-hidden="true"/>{currentFeedback}</p>}
 </section>;
}
