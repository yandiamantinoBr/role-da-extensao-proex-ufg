/**
 * Rolê: memória da conversa, usada pela tela e pelo servidor (sem dependência de servidor).
 * O servidor não guarda nada: a memória é a própria conversa que a tela envia. Cada resposta do Rolê
 * leva uma linha compacta do que foi consultado (consulta, quantos resultados e as fontes por nome),
 * para a pergunta seguinte ("e os atrasados?") funcionar sem repetir a consulta.
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

const oneLine = (value: string) => value.replace(/\s+/g, ' ').replace(/[[\]]/g, '').trim();
function memoryLine(parts: string[], labels: string[]): string {
  const sources = [...new Set(labels.map(oneLine).filter(Boolean))].slice(0, 4);
  const line = `${ROLE_MEMORY_PREFIX} ${parts.join(', ')}${sources.length ? `. Fontes: ${sources.join('; ')}` : ''}]`;
  return line.length <= ROLE_MEMORY_CHARS ? line : `${line.slice(0, ROLE_MEMORY_CHARS - 2).trimEnd()}…]`;
}

/** Resumo de uma resposta com consultas: nome da consulta, quantos resultados e as fontes (rótulos, sem endereço). */
export function roleTurnMemory(tools: readonly { name: string; rows: number }[], sources: readonly RoleSource[]): string {
  const counts = new Map<string, number>();
  for (const tool of tools) {
    const label = ROLE_TOOL_LABELS[tool.name];
    if (!label) continue;
    const previous = counts.get(label);
    counts.set(label, tool.rows < 0 ? previous ?? -1 : Math.max(0, previous ?? 0) + tool.rows);
  }
  if (!counts.size) return '';
  const parts = [...counts].map(([label, rows]) => `${label} (${rows < 0 ? 'indisponível' : rows === 1 ? '1 resultado' : `${rows} resultados`})`);
  return memoryLine(parts, sources.map(source => source.label));
}

/** Resumo de uma resposta direta do portal (fontes oficiais, sem IA): só as fontes, nunca o texto longo de links. */
export function officialTurnMemory(sources: readonly RoleSource[], linkLabel?: string | null): string {
  const labels = [...(linkLabel ? [linkLabel] : []), ...sources.map(source => source.label)];
  return labels.length ? memoryLine(['Fontes oficiais'], labels) : '';
}

export type RoleHistoryMessage = { role: 'user' | 'assistant'; content: string; memory?: string; official?: true; video?: true; isolated?: true };
/**
 * Histórico que vai ao servidor: a resposta leva a linha de memória ao fim; a resposta direta (fontes oficiais)
 * entra só pela linha de memória; vídeo e documento ficam fora (conversa isolada). Mesma limpeza do servidor,
 * para o custo previsto bater; numa conversa longa saem as mensagens mais antigas.
 */
export function roleHistoryTurns(messages: readonly RoleHistoryMessage[]): RoleTurn[] {
  const turns: RoleTurn[] = messages.filter(message => !message.video && !message.isolated).flatMap(message => {
    const line = message.role === 'assistant' && message.memory?.startsWith(ROLE_MEMORY_PREFIX) ? message.memory.slice(0, ROLE_MEMORY_CHARS) : '';
    const text = message.official ? '' : message.content.trim().slice(0, 4000 - (line ? line.length + 1 : 0));
    const content = [text, line].filter(Boolean).join('\n');
    if (!content) return [];
    try { return [{ role: message.role, content: safeRequest(content) }]; } catch { return []; }
  });
  const recent = turns.slice(-ROLE_MAX_HISTORY);
  while (recent.length && recent.reduce((total, turn) => total + turn.content.length, 0) > ROLE_MAX_HISTORY_CHARS) recent.shift();
  return recent;
}
