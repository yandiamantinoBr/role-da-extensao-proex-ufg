import { readFileSync } from 'node:fs';
import ts from 'typescript';

const directory = new URL('../../components/portal/', import.meta.url);
const compile = name => ts.transpileModule(readFileSync(new URL(name, directory), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const asUrl = code => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
const exportsUrl = asUrl(compile('report-export.ts'));
const pdfCode = compile('report-pdf.ts').replace(/from ['"]\.\/report-export['"]/g, `from ${JSON.stringify(exportsUrl)}`).replace(/import\(['"](pdf-lib|@pdf-lib\/fontkit)['"]\)/g, (_match, name) => `import(${JSON.stringify(import.meta.resolve(name))})`);

export const reportExport = await import(exportsUrl);
export const reportPdf = await import(asUrl(pdfCode));
export const fontBytes = new Uint8Array(readFileSync(new URL('../../public/fonts/NotoSans-Regular.ttf', import.meta.url)));

export async function zipEntries(blob) {
  const bytes = Buffer.from(await blob.arrayBuffer()), result = new Map();
  for (let cursor = 0; bytes.readUInt32LE(cursor) === 0x04034b50;) {
    const size = bytes.readUInt32LE(cursor + 18), names = bytes.readUInt16LE(cursor + 26), extra = bytes.readUInt16LE(cursor + 28);
    const name = bytes.subarray(cursor + 30, cursor + 30 + names).toString('utf8'), start = cursor + 30 + names + extra;
    result.set(name, bytes.subarray(start, start + size).toString('utf8')); cursor = start + size;
  }
  return result;
}
