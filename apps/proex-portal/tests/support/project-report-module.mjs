// Carrega os módulos do relatório do projeto (TypeScript) para os testes, com dados sintéticos.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = fileURLToPath(new URL('../../', import.meta.url));
const modules = new Map();
function compile(file) {
  file = resolve(root, file);
  if (modules.has(file)) return modules.get(file);
  let code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  code = code.replace(/from (['"])(\.[^'"]+)\1/g, (_match, _quote, dependency) => `from ${JSON.stringify(compile(resolve(dirname(file), dependency.endsWith('.ts') ? dependency : `${dependency}.ts`)))}`)
    .replace(/import\(['"](pdf-lib|@pdf-lib\/fontkit)['"]\)/g, (_match, name) => `import(${JSON.stringify(import.meta.resolve(name))})`);
  const url = `data:text/javascript;base64,${Buffer.from(`${code}\n//# sourceURL=${file.replace(root, '')}-under-test.mjs`).toString('base64')}`;
  modules.set(file, url);
  return url;
}
export const load = file => import(compile(file));
export const fontBytes = new Uint8Array(readFileSync(resolve(root, 'public/fonts/NotoSans-Regular.ttf')));
export const marks = {
  proex: new Uint8Array(readFileSync(resolve(root, 'public/brand/proex.png'))),
  ufg: new Uint8Array(readFileSync(resolve(root, 'public/brand/ufg-white.png'))),
  project: new Uint8Array(readFileSync(resolve(root, 'public/brand/role-da-extensao.png'))),
};

/** Dados sintéticos no formato devolvido por /api/projects/[id]/report. */
export function syntheticReportData(overrides = {}) {
  const demands = Array.from({ length: 14 }, (_, index) => ({
    id: `task-${index}`, demanda: `Demanda sintética ${index + 1} — conferir brindes & ação`, prioridade: ['high', 'medium', 'low'][index % 3],
    situacao: index % 4 === 0 ? 'completed' : index % 4 === 1 ? 'in_progress' : 'open', data: `2026-${String(8 + (index % 3)).padStart(2, '0')}-${String(3 + index).padStart(2, '0')}`,
    prazo: '2026-11-20', em_atraso: index % 5 === 0 ? 'sim' : 'nao', concluida_em: index % 4 === 0 ? `2026-${String(9 + (index % 2)).padStart(2, '0')}-15` : null,
  }));
  return {
    generatedAt: '2026-11-09T15:00:00.000Z',
    period: { from: null, to: null },
    project: {
      id: 'synthetic-project', name: 'Projeto Sintético de Extensão', shortName: 'PSE', description: 'Descrição fictícia do projeto, usada só em testes.\nSegunda linha.',
      status: 'active', lifecycle: 'active', unit: 'FX · Faculdade Fictícia', type: 'Projeto', thematicArea: 'cultura', thematicAreaLabel: 'Cultura', extensionLine: '01', extensionLineLabel: '01 · Linha fictícia',
      scope: 'internal', location: 'Campus Fictício', startsAt: '2026-08-01', endsAt: '2026-12-15', officialUrl: 'https://example.org/projeto', prizesEnabled: true,
      counts: { materiais: 3, eventos: 2, emprestimos: 2, registros: 4, marcos_agenda: 3 },
    },
    permissions: { canSaveTemplates: true, canAddReferences: true },
    sections: {
      team: { teams: [{ name: 'Equipe Alfa', status: 'active', members: ['Pessoa Fictícia A', 'Pessoa Fictícia B'], counts: { total: 6, open: 2, in_progress: 1, blocked: 0, completed: 3 } }], truncated: false },
      demands: { rows: demands, truncated: false },
      materials: {
        items: [
          { material: 'Camiseta fictícia', categoria: 'Brindes', classe: 'gift', saldo: 40, disponivel: 35, unidade_medida: 'unidade', situacao_estoque: 'ok' },
          { material: 'Caixa de som fictícia', categoria: '', classe: 'equipment', saldo: 1, disponivel: 0, unidade_medida: 'unidade', situacao_estoque: 'baixo' },
        ],
        movements: [
          { data: '2026-09-02', material: 'Camiseta fictícia', tipo: 'receive', quantidade: 50, unidade_medida: 'unidade', observacao: 'Compra sintética' },
          { data: '2026-10-05', material: 'Camiseta fictícia', tipo: 'distribute', quantidade: -10, unidade_medida: 'unidade', observacao: 'Feira sintética' },
          { data: '2026-10-06', material: 'Camiseta fictícia', tipo: 'adjust', quantidade: -1, unidade_medida: 'unidade', observacao: '=SOMA(A1)' },
        ],
        corrections: [{ material: 'Camiseta fictícia', versao: 2, data: '2026-10-07', campos: ['low_stock', 'name'] }],
        attachments: [{ material: 'Caixa de som fictícia', registro: 'Conserto sintético', arquivo: 'nota-ficticia.pdf', tipo: 'application/pdf', tamanho: 1200, data: '2026-10-02' }],
        truncated: false, detailed: true,
      },
      loans: { rows: [{ material: 'Caixa de som fictícia', acao: 'Mostra sintética', inicio: '2026-10-01', fim: '2026-10-03', situacao: 'returned', em_atraso: 'nao' }], truncated: false },
      campaigns: { rows: [{ evento: 'Dinâmica sintética', local: 'Pátio fictício', inicio: '2026-10-10', fim: '2026-10-10', situacao: 'closed', participacoes: 120, tentativas: 130, premios_entregues: 80 }], truncated: false },
      schedule: { rows: [{ titulo: 'Abertura fictícia', inicio: '2026-08-05', fim: '2026-08-05', situacao: 'completed', observacao: '' }, { titulo: 'Encerramento fictício', inicio: '2026-12-10', fim: '2026-12-10', situacao: 'planned', observacao: 'A confirmar' }] },
      records: { rows: [{ data: '2026-10-02', categoria: 'maintenance', titulo: 'Conserto sintético', anexos: 1 }], truncated: false },
      history: { rows: [{ tipo: 'project', item: 'Projeto Sintético de Extensão', versao: 2, data: '2026-09-01', momento: '2026-09-01T13:00:00.000Z', por: 'Pessoa Fictícia A', campos: ['description', 'location'] }, { tipo: 'project_link', item: 'Planilha fictícia', versao: 1, data: '2026-08-02', campos: ['__created__'] }] },
      references: { rows: [
        { titulo: 'Página oficial do projeto', url: 'https://example.org/projeto', origem: 'Ficha do projeto', tipo: 'link' },
        { titulo: 'Planilha fictícia', url: 'https://docs.google.com/spreadsheets/d/synthetic/edit', origem: 'Vinculado ao projeto', tipo: 'spreadsheet' },
        { titulo: 'Plano de trabalho fictício', url: 'https://example.org/plano.pdf', origem: 'Vinculado ao projeto', tipo: 'document' },
      ] },
    },
    ...overrides,
  };
}

export async function zipEntries(blob) {
  const bytes = Buffer.from(await blob.arrayBuffer()), result = new Map();
  for (let cursor = 0; bytes.readUInt32LE(cursor) === 0x04034b50;) {
    const size = bytes.readUInt32LE(cursor + 18), names = bytes.readUInt16LE(cursor + 26), extra = bytes.readUInt16LE(cursor + 28);
    const name = bytes.subarray(cursor + 30, cursor + 30 + names).toString('utf8'), start = cursor + 30 + names + extra;
    result.set(name, bytes.subarray(start, start + size).toString('utf8')); cursor = start + size;
  }
  return result;
}
