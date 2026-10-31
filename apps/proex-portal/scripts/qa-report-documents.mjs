// Synthetic visual-review fixtures only. No environment, database or provider calls.
import { mkdir, writeFile } from 'node:fs/promises';
import { reportExport, reportPdf, fontBytes } from '../tests/support/report-module.mjs';
const directory = new URL('../.sites-runtime/report-qa/', import.meta.url);
await mkdir(directory, { recursive: true });
const columns = [{ key: 'material', label: 'Material' }, { key: 'project', label: 'Projeto' }, { key: 'quantity', label: 'Quantidade', numeric: true }, { key: 'unit', label: 'Unidade de medida' }];
const rows = Array.from({ length: 45 }, (_, index) => ({ material: `Material fictício ${index + 1} · comunicação, extensão e cultura`, project: 'Projeto sintético de extensão', quantity: index + 1, unit: 'unidade' }));
const info = [['Recorte', 'Dados sintéticos de homologação'], ['Período', '01/10/2026 a 31/10/2026'], ['Fonte', 'Portal PROEX · UFG'], ['Gerado em', '31/10/2026 (Brasília)']];
const wide = [...columns, ...Array.from({ length: 5 }, (_, index) => ({ key: `field${index}`, label: `Campo complementar ${index + 1}` }))];
for (const row of rows) for (let index = 0; index < 5; index++) row[`field${index}`] = 'Descrição sintética para revisão de acentuação e quebra de linha.';
for (const [name, title, fields, data] of [['saidas', 'Saídas institucionais', columns, rows], ['bens', 'Patrimônio · detalhamento', wide, rows.slice(0, 4)]]) {
  for (const format of ['docx', 'pdf']) {
    const blob = format === 'docx' ? reportExport.toDocx(title, fields, data, (row, key) => row[key], info) : await reportPdf.toPdf(title, fields, data, (row, key) => row[key], info, { fontBytes });
    await writeFile(new URL(`${name}.${format}`, directory), Buffer.from(await blob.arrayBuffer()));
  }
}
console.log('Arquivos sintéticos PDF/DOCX prontos em .sites-runtime/report-qa. Renderize e confira antes da publicação.');
