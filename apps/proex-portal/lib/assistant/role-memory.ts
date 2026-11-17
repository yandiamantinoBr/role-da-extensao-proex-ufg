/**
 * Rolê: memória da conversa, usada pela tela e pelo servidor (sem dependência de servidor).
 * O servidor não guarda nada: a memória é a própria conversa que a tela envia. Cada resposta do Rolê
 * leva uma linha compacta do que foi consultado: só o nome da consulta, quantos resultados e os projetos
 * (nunca título de demanda, material ou página), para a pergunta seguinte ("e os atrasados?") funcionar.
 * A linha vem do cliente: o servidor confere o formato e descarta o que não casar.
 */
import { safeRequest } from './contracts';
import { ROLE_MAX_HISTORY, ROLE_MAX_HISTORY_CHARS, type RoleSource, type RoleTurn } from './role-contracts';

/** Nome de cada consulta como a pessoa entende. Nome interno de ferramenta nunca aparece na conversa. */
export const ROLE_TOOL_LABELS: Record<string, string> = {
  buscar_no_portal: 'Busca no portal', consultar_movimentacoes: 'Movimentações de estoque', consultar_demandas: 'Demandas', consultar_agenda: 'Agenda',
  consultar_fontes_oficiais: 'Fontes oficiais', abrir_link_oficial: 'Página oficial', preparar_rascunho_demanda: 'Rascunho de demanda', consultar_guia: 'Guia da PROEX',
  consultar_projetos: 'Projetos', filtrar_demandas: 'Demandas filtradas', minha_agenda: 'Minha agenda',
  consultar_estoque: 'Estoque', consultar_niveis_dinamica: 'Níveis da dinâmica', consultar_emprestimos: 'Empréstimos', consultar_responsaveis: 'Quem cuida',
  registros_recentes: 'Registros', consultar_equipes: 'Equipes', consultar_organograma: 'Organograma', resumir_relatorio_projeto: 'Relatório do projeto', consultar_gestao: 'Gestão',
  abrir_tela: 'Abrir tela',
};
/** Teto da linha de memória: cabe folgada no limite de 4.000 caracteres por mensagem. */
export const ROLE_MEMORY_CHARS = 360;
export const ROLE_MEMORY_PREFIX = '[Consultas desta resposta:';
const PROJECTS_PER_PART = 3;

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const LABEL = `(?:${[...new Set(Object.values(ROLE_TOOL_LABELS))].map(escape).join('|')})`;
const PROJECT = '[^\\[\\]():,;\\n]{1,40}';
const PART = `${LABEL} \\((?:\\d{1,4} resultados?|indisponível)(?:: ${PROJECT}(?:, ${PROJECT}){0,${PROJECTS_PER_PART - 1}})?\\)`;
const LINE = new RegExp(`^${escape(ROLE_MEMORY_PREFIX)} ${PART}(?:, ${PART}){0,11}\\]$`);

/** Nome de projeto pronto para a linha: sem colchetes, parênteses, vírgulas nem quebra; até 40 caracteres. */
const projectName = (value: string) => value.replace(/[[\]():,;\n]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40).trim();
/** A linha casa exatamente o formato que o servidor gera? */
export function roleMemoryValid(line: string): boolean { return line.length <= ROLE_MEMORY_CHARS && LINE.test(line); }
/** A linha diz que alguma consulta trouxe resultado (conteúdo lido de fora, para os avisos de rascunho e botão)? */
export function roleMemoryHasRows(line: string): boolean { return roleMemoryValid(line) && /\([1-9]\d{0,3} resultados?/.test(line); }

/** Projetos citados nas fontes de uma consulta (o parâmetro project dos links internos). */
export function sourceProjectIds(sources: readonly RoleSource[]): string[] {
  const ids = new Set<string>();
  for (const source of sources) {
    if (!source.href.startsWith('/?')) continue;
    const id = new URLSearchParams(source.href.slice(2)).get('project');
    if (id) ids.add(id);
  }
  return [...ids];
}

export type RoleMemoryPart = { name: string; rows: number; projects?: readonly string[] };
function line(parts: { label: string; rows: number; projects: string[] }[]): string {
  const text = (list: typeof parts) => `${ROLE_MEMORY_PREFIX} ${list.map(part => `${part.label} (${part.rows < 0 ? 'indisponível' : part.rows === 1 ? '1 resultado' : `${Math.min(part.rows, 9999)} resultados`}${part.projects.length ? `: ${part.projects.join(', ')}` : ''})`).join(', ')}]`;
  // Longa demais: primeiro saem os projetos, depois as últimas consultas; a linha sempre fica no formato.
  let list = parts.slice(0, 12);
  if (text(list).length > ROLE_MEMORY_CHARS) list = list.map(part => ({ ...part, projects: part.projects.slice(0, 1) }));
  while (list.length > 1 && text(list).length > ROLE_MEMORY_CHARS) list = list.slice(0, -1);
  return text(list).length <= ROLE_MEMORY_CHARS ? text(list) : '';
}

/** Resumo de uma resposta com consultas: nome da consulta, quantos resultados e os projetos (nomes já visíveis para a pessoa). */
export function roleTurnMemory(tools: readonly RoleMemoryPart[]): string {
  const merged = new Map<string, { label: string; rows: number; projects: string[] }>();
  for (const tool of tools) {
    const label = ROLE_TOOL_LABELS[tool.name];
    if (!label) continue;
    const entry = merged.get(label) ?? { label, rows: -1, projects: [] };
    if (tool.rows >= 0) entry.rows = Math.max(0, entry.rows) + tool.rows;
    for (const name of (tool.projects ?? []).map(projectName).filter(Boolean)) if (!entry.projects.includes(name) && entry.projects.length < PROJECTS_PER_PART) entry.projects.push(name);
    merged.set(label, entry);
  }
  return merged.size ? line([...merged.values()]) : '';
}

/** Resumo de uma resposta direta do portal (fontes oficiais): só quantos itens, nunca títulos nem o texto longo. */
export function officialTurnMemory(count: number): string {
  return count > 0 ? line([{ label: 'Fontes oficiais', rows: count, projects: [] }]) : '';
}

/**
 * Linha de memória recebida do cliente: vale só a que casa o formato, como linha própria; qualquer outra
 * ocorrência do prefixo sai do texto. `rows` diz se sobrou uma linha válida com resultado.
 */
export function roleMemorySanitize(content: string): { content: string; rows: boolean } {
  let rows = false;
  const lines = content.split('\n').flatMap(text => {
    if (!text.includes(ROLE_MEMORY_PREFIX)) return [text];
    const trimmed = text.trim();
    if (roleMemoryValid(trimmed)) { rows ||= roleMemoryHasRows(trimmed); return [trimmed]; }
    const before = text.slice(0, text.indexOf(ROLE_MEMORY_PREFIX)).trimEnd();
    return before ? [before] : [];
  });
  return { content: lines.join('\n').trim(), rows };
}

export type RoleHistoryMessage = { role: 'user' | 'assistant'; content: string; memory?: string; official?: true; video?: true; isolated?: true; noAi?: true };
/**
 * Histórico que vai ao servidor: a resposta leva a linha de memória ao fim; a resposta direta (fontes oficiais)
 * entra só pela linha de memória; vídeo, documento e a busca explícita em fontes oficiais (que promete não ir
 * para a IA) ficam fora. Mesma limpeza do servidor, para o custo previsto bater; numa conversa longa saem as
 * mensagens mais antigas.
 */
export function roleHistoryTurns(messages: readonly RoleHistoryMessage[]): RoleTurn[] {
  const turns: RoleTurn[] = messages.filter(message => !message.video && !message.isolated && !message.noAi).flatMap(message => {
    const memory = message.role === 'assistant' && message.memory && roleMemoryValid(message.memory) ? message.memory : '';
    const text = message.official ? '' : roleMemorySanitize(message.content.trim()).content.slice(0, 4000 - (memory ? memory.length + 1 : 0));
    const content = [text, memory].filter(Boolean).join('\n');
    if (!content) return [];
    try { return [{ role: message.role, content: safeRequest(content) }]; } catch { return []; }
  });
  const recent = turns.slice(-ROLE_MAX_HISTORY);
  while (recent.length && recent.reduce((total, turn) => total + turn.content.length, 0) > ROLE_MAX_HISTORY_CHARS) recent.shift();
  return recent;
}

/** Falas que vão ao modelo: falas seguidas do mesmo papel viram uma só e a conversa nunca começa pelo assistente. */
export function roleMergedTurns(turns: readonly RoleTurn[]): RoleTurn[] {
  const merged: RoleTurn[] = [];
  for (const turn of turns) {
    if (!merged.length && turn.role === 'assistant') continue;
    const last = merged.at(-1);
    if (last && last.role === turn.role) merged[merged.length - 1] = { role: last.role, content: `${last.content}\n\n${turn.content}` };
    else merged.push({ ...turn });
  }
  return merged;
}
