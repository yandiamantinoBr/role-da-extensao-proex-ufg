// Synthetic visual-review fixtures only. No environment, database or provider calls.
import { mkdir, writeFile } from 'node:fs/promises';
import { reportExport, reportPdf, fontBytes, brandBytes } from '../tests/support/report-module.mjs';
const directory = new URL('../.sites-runtime/report-qa/', import.meta.url);
await mkdir(directory, { recursive: true });
const columns = [{ key: 'material', label: 'Material' }, { key: 'project', label: 'Projeto' }, { key: 'quantity', label: 'Quantidade', numeric: true }, { key: 'unit', label: 'Unidade de medida' }];
const rows = Array.from({ length: 45 }, (_, index) => ({ material: `Material fictício ${index + 1} · comunicação, extensão e cultura`, project: 'Projeto sintético de extensão', quantity: index + 1, unit: 'unidade' }));
const info = [['Recorte', 'Dados sintéticos de homologação'], ['Período', '01/10/2026 a 31/10/2026'], ['Fonte', 'Portal PROEX · UFG'], ['Gerado em', '31/10/2026 (Brasília)']];
const wide = [...columns, ...Array.from({ length: 5 }, (_, index) => ({ key: `field${index}`, label: `Campo complementar ${index + 1}` }))];
for (const row of rows) for (let index = 0; index < 5; index++) row[`field${index}`] = 'Descrição sintética para revisão de acentuação e quebra de linha.';
for (const [name, title, fields, data] of [['saidas', 'Saídas institucionais', columns, rows], ['bens', 'Patrimônio · detalhamento', wide, rows.slice(0, 4)]]) {
  for (const format of ['docx', 'pdf']) {
    const blob = format === 'docx' ? reportExport.toDocx(title, fields, data, (row, key) => row[key], info) : await reportPdf.toPdf(title, fields, data, (row, key) => row[key], info, { fontBytes, brandBytes });
    await writeFile(new URL(`${name}.${format}`, directory), Buffer.from(await blob.arrayBuffer()));
  }
}
const fields = [
  { key: 'project', label: 'Projeto' }, { key: 'unit', label: 'Unidade' }, { key: 'area', label: 'Área temática' },
  { key: 'kind', label: 'Modalidade' }, { key: 'scope', label: 'Abrangência' }, { key: 'stage', label: 'Etapa' },
  { key: 'materials', label: 'Materiais', numeric: true }, { key: 'events', label: 'Eventos', numeric: true },
  { key: 'loans', label: 'Empréstimos', numeric: true }, { key: 'records', label: 'Registros', numeric: true },
];
for (const [name, projectBrand, projectName] of [
  ['ficha-projeto', 'conpeex-2026', '23º CONPEEX — Congresso de Pesquisa, Ensino e Extensão'],
  ['ficha-role', 'role-da-extensao', 'Rolê da Extensão'],
]) {
  const project = { project: projectName, kind: 'Evento', scope: 'Interno PROEX', unit: '', area: '', stage: 'Em andamento', materials: 12, events: 5, loans: 0, records: 3 };
  const report = await reportPdf.toPdf('Projetos e ações', fields, [project], (row, key) => row[key], [
    ['Relatório', 'Projetos e ações'], ['Recorte', projectName], ['Período', 'Todo o período'],
    ['Linhas', '1'], ['Gerado em', '04/11/2026, 11:34:46 (Brasília)'], ['Fonte', 'Dados sintéticos de homologação'],
  ], { fontBytes, brandBytes, presentation: { projectName, projectBrand, metrics: fields.filter(field => field.numeric).map(field => ({ label: field.label, value: project[field.key] })) } });
  await writeFile(new URL(name + '.pdf', directory), Buffer.from(await report.arrayBuffer()));
}
console.log('Arquivos sintéticos PDF/DOCX prontos em .sites-runtime/report-qa. Renderize e confira antes da publicação.');
