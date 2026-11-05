'use client';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Check, Copy, KeyRound, Link2, LoaderCircle, Plus, ShieldCheck, Unplug } from 'lucide-react';
import styles from './mcp-connections-panel.module.css';

type Token = { id: string; label: string; scopes: string[]; projectIds: string[]; expiresAt: string; revokedAt: string | null; createdAt: string };
type Data = { projects: { id: string; name: string }[]; tokens: Token[] };
const labels: Record<string, string> = { 'project.summary': 'Resumo do projeto', 'tasks.read': 'Demandas (consulta)' };
const date = (value: string) => new Date(value).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
async function responseValue(response: Response): Promise<Record<string, unknown>> {
  let value: unknown; try { value = await response.json(); } catch { throw new Error('Resposta de conexão inválida. Atualize a página.'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Resposta de conexão inválida. Atualize a página.');
  const result = value as Record<string, unknown>;
  if (!response.ok) throw Object.assign(new Error(typeof result.error === 'string' ? result.error : 'Não foi possível atualizar a conexão.'), { code: result.code, status: response.status });
  return result;
}
function connectionData(value: Record<string, unknown>): Data {
  if (!Array.isArray(value.projects) || !Array.isArray(value.tokens) || value.tokens.length > 100 || value.projects.some(project => !project || typeof project.id !== 'string' || typeof project.name !== 'string') || value.tokens.some(token => !token || typeof token.id !== 'string' || typeof token.label !== 'string' || !Array.isArray(token.scopes) || token.scopes.some((scope: unknown) => typeof scope !== 'string' || !labels[scope]) || !Array.isArray(token.projectIds) || token.projectIds.some((id: unknown) => typeof id !== 'string') || !Number.isFinite(Date.parse(token.expiresAt)) || !Number.isFinite(Date.parse(token.createdAt)) || !(token.revokedAt === null || typeof token.revokedAt === 'string'))) throw new Error('Resposta de conexão inválida. Atualize a página.');
  return value as Data;
}
export default function McpConnectionsPanel() {
  const [opened, setOpened] = useState(false), [data, setData] = useState<Data | null>(null), [failure, setFailure] = useState(''), [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false), [issued, setIssued] = useState<{ id: string; token: string; expiresAt: string } | null>(null), [copied, setCopied] = useState(false), [revoking, setRevoking] = useState<Token | null>(null);
  const [clock, setClock] = useState(() => Date.now());
  const [selectedProjects, setSelectedProjects] = useState<string[]>([]), [selectedScopes, setSelectedScopes] = useState<string[]>(['project.summary']);
  const requestId = useRef<string | null>(null), receipt = useRef<HTMLInputElement>(null), group = useRef<HTMLDetailsElement>(null), confirmation = useRef<HTMLDivElement>(null), failureRef = useRef<HTMLParagraphElement>(null);
  const mounted = useRef(false), open = useRef(false), generation = useRef(0), readSequence = useRef(0), copySequence = useRef(0);
  const reads = useRef(new Set<AbortController>()), mutation = useRef<symbol | null>(null);
  const current = useCallback((epoch: number) => mounted.current && open.current && group.current?.open !== false && generation.current === epoch, []);
  const abortReads = useCallback(() => { readSequence.current++; for (const controller of reads.current) controller.abort(); reads.current.clear(); }, []);
  const clearSensitive = useCallback(() => { copySequence.current++; setIssued(null); setData(null); setCopied(false); setRevoking(null); setNotice(''); setSelectedProjects([]); setSelectedScopes(['project.summary']); }, []);
  const failed = useCallback((error: unknown, epoch: number) => {
    if (!current(epoch)) return;
    if (error && typeof error === 'object' && 'status' in error && (error.status === 401 || error.status === 403)) clearSensitive();
    setFailure(error instanceof Error ? error.message : 'Não foi possível atualizar suas conexões.');
  }, [clearSensitive, current]);
  const reload = useCallback(async (epoch: number = generation.current) => {
    if (!current(epoch)) return;
    const sequence = ++readSequence.current, controller = new AbortController(); reads.current.add(controller);
    try {
      const value = connectionData(await responseValue(await fetch('/api/mcp/tokens', { cache: 'no-store', signal: controller.signal })));
      if (current(epoch) && sequence === readSequence.current) setData(value);
    } catch (error) { if (!controller.signal.aborted && current(epoch) && sequence === readSequence.current) { failed(error, epoch); throw error; } }
    finally { reads.current.delete(controller); }
  }, [current, failed]);
  const stop = useCallback(() => { mounted.current = false; generation.current++; open.current = false; abortReads(); }, [abortReads]);
  function toggle(next: boolean) {
    if (open.current === next) { setOpened(next); return; }
    generation.current++; open.current = next; abortReads(); setOpened(next);
    if (!next) { clearSensitive(); setFailure(''); }
  }
  useEffect(() => { mounted.current = true; open.current = Boolean(group.current?.open); return stop; }, [stop]);
  useEffect(() => { if (window.location.hash === '#mcp-connections' && group.current) { group.current.open = true; group.current.querySelector('summary')?.focus({ preventScroll: true }); group.current.scrollIntoView({ block: 'start' }); } }, []);
  useEffect(() => { if (!opened) return; const timer = window.setInterval(() => setClock(Date.now()), 60000); return () => window.clearInterval(timer); }, [opened]);
  useEffect(() => { if (revoking) confirmation.current?.focus(); }, [revoking]);
  useEffect(() => { if (failure) failureRef.current?.focus(); }, [failure]);
  useEffect(() => {
    if (!opened) return;
    const epoch = generation.current, timer = window.setTimeout(() => { void reload(epoch).catch(() => {}); }, 0);
    return () => { window.clearTimeout(timer); abortReads(); };
  }, [opened, reload, abortReads]);
  useEffect(() => { if (issued) { receipt.current?.focus(); receipt.current?.select(); } }, [issued]);
  async function post(input: Record<string, unknown>) {
    const response = await fetch('/api/mcp/tokens', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Proex-Action': '1' }, body: JSON.stringify(input) });
    return responseValue(response);
  }
  function settled(epoch: number, operation: symbol) {
    if (!mounted.current || mutation.current !== operation) return;
    mutation.current = null; setBusy(false);
    // A late POST may have reached the server. Refresh only current metadata;
    // never transfer its one-time secret or feedback to a newer opening.
    if (open.current && epoch !== generation.current) void reload().catch(() => {});
  }
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy || mutation.current || !current(generation.current)) return;
    const form = event.currentTarget, values = new FormData(form), projectIds = values.getAll('projectId'), scopes = values.getAll('scope');
    if (!projectIds.length || !scopes.length) { setFailure('Escolha pelo menos um projeto e um tipo de consulta.'); return; }
    const epoch = generation.current, operation = Symbol('create'); mutation.current = operation; copySequence.current++;
    setBusy(true); setFailure(''); setNotice(''); setIssued(null); setCopied(false); requestId.current ??= crypto.randomUUID();
    try {
      const value = await post({ action: 'create', label: values.get('label'), projectIds, scopes, days: Number(values.get('days')), requestId: requestId.current });
      if (typeof value.id !== 'string' || typeof value.token !== 'string' || !/^pxm_[\w-]{43}$/.test(value.token) || typeof value.expiresAt !== 'string' || !Number.isFinite(Date.parse(value.expiresAt))) throw new Error('A resposta não confirmou uma credencial válida. Consulte suas conexões e revogue a tentativa.');
      requestId.current = null;
      if (!current(epoch)) return;
      setIssued({ id: value.id, token: value.token, expiresAt: value.expiresAt }); form.reset(); setSelectedProjects([]); setSelectedScopes(['project.summary']); await reload(epoch);
    } catch (error) {
      if (!current(epoch)) return;
      if (error && typeof error === 'object' && 'code' in error && error.code === 'mcp_token_created') { requestId.current = null; await reload(epoch).catch(() => {}); }
      failed(error, epoch);
    } finally { settled(epoch, operation); }
  }
  async function revoke() {
    if (!revoking || busy || mutation.current || !current(generation.current)) return;
    const epoch = generation.current, operation = Symbol('revoke'); mutation.current = operation; setBusy(true); setFailure('');
    try { await post({ action: 'revoke', id: revoking.id }); if (!current(epoch)) return; if (issued?.id === revoking.id) setIssued(null); setRevoking(null); setNotice('Conexão revogada. Novas consultas serão recusadas.'); await reload(epoch); }
    catch (error) { failed(error, epoch); }
    finally { settled(epoch, operation); }
  }
  function copyIssued() {
    if (!issued || !current(generation.current)) return;
    const epoch = generation.current, sequence = ++copySequence.current;
    void (navigator.clipboard?.writeText(issued.token) ?? Promise.reject()).then(() => { if (current(epoch) && sequence === copySequence.current) setCopied(true); }).catch(() => {
      if (!current(epoch) || sequence !== copySequence.current) return;
      receipt.current?.focus(); receipt.current?.select(); setFailure('Use copiar no campo da credencial. O navegador recusou a cópia automática.');
    });
  }
  return <details ref={group} className={`p-card ${styles.panel}`} id="mcp-connections" onToggle={event => toggle(event.currentTarget.open)}>
    <summary className={styles.summary} onClick={() => { if (group.current?.open) toggle(false); }}><Link2 size={20} aria-hidden="true"/><span><strong>Conectar uma IA ao meu trabalho</strong><small>Consultas pessoais por MCP, com prazo e projetos escolhidos.</small></span></summary>
    {opened && <div className={styles.body}>
      <p className={styles.note}><ShieldCheck size={18} aria-hidden="true"/><span>Essa conexão consulta somente os resumos e demandas selecionados. Não altera estoque, envia avisos ou usa chaves de modelos. Seu acesso atual continua sendo conferido em cada consulta.</span></p>
      {failure && <p ref={failureRef} tabIndex={-1} className="p-inline-error" role="alert">{failure}</p>}{notice && <p role="status" className={styles.note}><Check size={16} aria-hidden="true"/>{notice}</p>}
      {failure && !data && <button type="button" className="p-button p-button-subtle" onClick={() => { setFailure(''); void reload().catch(() => {}); }}>Tentar novamente</button>}
      {!data ? <p role="status"><LoaderCircle size={16} aria-hidden="true"/>Consultando suas conexões…</p> : <>
        {issued && <div className={styles.receipt}><h3><KeyRound size={19} aria-hidden="true"/>Credencial criada</h3><p>Copie agora. Ela aparece somente nesta janela e vence em {date(issued.expiresAt)}. Cole no campo Authorization do cliente MCP de sua confiança.</p>
          <label className="p-field"><span>Sua credencial pessoal MCP</span><input ref={receipt} readOnly type="password" autoComplete="off" data-no-draft="true" value={issued.token}/></label>
          <div className={styles.actions}><button type="button" className="p-button p-button-primary" onClick={copyIssued}><Copy size={16} aria-hidden="true"/>{copied ? 'Copiada' : 'Copiar credencial'}</button><button type="button" className="p-button p-button-subtle" onClick={() => setIssued(null)}>Ocultar credencial</button></div>
        </div>}
        <form onSubmit={create} className={styles.form} autoComplete="off"><h3>Nova conexão pessoal</h3><fieldset disabled={busy || !data.projects.length}>
          <div className={styles.grid}><label className="p-field"><span>Nome da conexão</span><input name="label" required maxLength={80} placeholder="Ex.: Claude · demandas do CONPEEX"/></label><label className="p-field"><span>Validade</span><select name="days" defaultValue="7"><option value="1">1 dia</option><option value="7">7 dias</option><option value="30">30 dias</option></select></label></div>
          <fieldset className={styles.choices}><legend>Quais consultas autorizar</legend>{Object.entries(labels).map(([scope, label]) => <label key={scope}><input type="checkbox" name="scope" value={scope} checked={selectedScopes.includes(scope)} onChange={event => setSelectedScopes(current => event.target.checked ? [...current, scope] : current.filter(value => value !== scope))}/>{label}</label>)}</fieldset>
          <fieldset className={styles.choices}><legend>Projetos que esta IA poderá consultar (até 20)</legend><div className={styles.projects}>{data.projects.map(project => <label key={project.id}><input type="checkbox" name="projectId" value={project.id} checked={selectedProjects.includes(project.id)} disabled={selectedProjects.length >= 20 && !selectedProjects.includes(project.id)} onChange={event => setSelectedProjects(current => event.target.checked ? [...current, project.id] : current.filter(value => value !== project.id))}/><span>{project.name}</span></label>)}</div>{!data.projects.length && <p>Nenhum projeto permitido para uma conexão.</p>}</fieldset>
          {(!selectedProjects.length || !selectedScopes.length) && <p className={styles.muted} id="mcp-selection-help">Escolha ao menos um projeto e um tipo de consulta para gerar a credencial.</p>}
          <button className="p-button p-button-primary" type="submit" disabled={!selectedProjects.length || !selectedScopes.length} aria-describedby={!selectedProjects.length || !selectedScopes.length ? 'mcp-selection-help' : undefined}><Plus size={16} aria-hidden="true"/>{busy ? 'Preparando…' : 'Gerar credencial pessoal'}</button>
        </fieldset></form>
        <section className={styles.setup}><h3>Endereço e compatibilidade</h3><label className="p-field"><span>URL do servidor MCP</span><input readOnly value={`${typeof window === 'undefined' ? '' : window.location.origin}/api/mcp`} aria-label="URL do servidor MCP"/></label><p>MCP HTTP <strong>2026-07-28</strong>, com Authorization: Bearer SUA_CREDENCIAL. Configure os metadados e cabeçalhos obrigatórios dessa versão no cliente. Este piloto não oferece OAuth ou login automático; clientes que usam apenas versões antigas ainda precisam de adaptação.</p><a className="p-text-link" href="https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http" target="_blank" rel="noopener noreferrer">Contrato oficial do transporte</a></section>
        <section><h3>Minhas conexões</h3><ul className={styles.list}>{data.tokens.map(token => { const active = !token.revokedAt && Date.parse(token.expiresAt) > clock; return <li key={token.id}><div><strong>{token.label}</strong><span>{token.projectIds.length === 1 ? '1 projeto' : `${token.projectIds.length} projetos`} · {token.scopes.map(scope => labels[scope]).join(' · ')}</span><small>{token.revokedAt ? 'Revogada' : active ? `Válida até ${date(token.expiresAt)}` : 'Expirada'}</small></div>{active && <button type="button" className="p-button p-button-subtle" disabled={busy} onClick={() => setRevoking(token)}><Unplug size={16} aria-hidden="true"/>Revogar</button>}</li>; })}</ul>{!data.tokens.length && <p className={styles.muted}>Você ainda não criou conexões pessoais.</p>}</section>
        {revoking && <div ref={confirmation} tabIndex={-1} className={styles.confirm} role="group" aria-label="Confirmar revogação"><p>Revogar <strong>{revoking.label}</strong>? O cliente precisará de uma nova credencial para consultar o portal.</p><div className={styles.actions}><button type="button" disabled={busy} className="p-button p-button-primary" onClick={() => void revoke()}>Confirmar revogação</button><button type="button" disabled={busy} className="p-button p-button-subtle" onClick={() => setRevoking(null)}>Cancelar</button></div></div>}
      </>}
    </div>}
  </details>;
}
