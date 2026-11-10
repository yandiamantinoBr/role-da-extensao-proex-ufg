import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

// Compile a static Apps Script from an explicit allowlist. No runtime loading,
// evaluation, Drive APIs, global configuration or backup functions are included.
const base=new URL('../public/integracoes/proex-planilha.gs',import.meta.url);
const overrides=new URL('./project-sheet-connector-overrides.gs',import.meta.url);
const target=new URL('../public/integracoes/proex-projeto-planilha.gs',import.meta.url);
const source=ts.createSourceFile('connector.js',readFileSync(base,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const selected=new Set(['OPERATIONS_HEADER','CONFLICTS_HEADER','BASELINE_NOTE','EDITABLE_COLOR','SYNC_BUDGET_MS','ISOLATE_CODES','PARTIAL_METADATA_TABLES','propriedades_','sincronizarAutomatico','sincronizarAgora','CADASTRO_MATERIAL','TIPOS_MATERIAL','cadastrarMaterial','rascunhoMaterial_','chaveMaterial_','carregarCadastroMaterial','normalizarCadastroMaterial_','mensagemCadastroMaterial_','salvarCadastroMaterial','novoCadastroMaterial','CADASTRO_MATERIAL_HTML','sincronizar_','aplicar_','isolavel_','lerTabela_','coletarEdicoes_','alteradaDuranteSync_','coletarOperacoes_','gravarRetornoOperacoes_','escreverTabela_','conferirTabela_','garantirAbasDeControle_','lerControle_','registrarConflitos_','conflito_','texto_','converter_','hex_','hexBytes_']);
const found=new Set(),statements=[];
for(const statement of source.statements){
 const names=ts.isFunctionDeclaration(statement)&&statement.name?[statement.name.text]:ts.isVariableStatement(statement)?statement.declarationList.declarations.flatMap(declaration=>ts.isIdentifier(declaration.name)?[declaration.name.text]:[]):[];
 if(!names.some(name=>selected.has(name)))continue;
 names.forEach(name=>found.add(name));
 let text=statement.getText(source);
 if(names.includes('sincronizar_'))text=text.replace('registrarConflitos_(ss, conflicts);','registrarConflitos_(ss, conflicts);\n      registrarAbasProjeto_(ss, schemas);');
 text=text.replaceAll('planilha mestre configurada','planilha deste projeto configurada').replaceAll('Use a aba Operações para criar registros.','Use PROEX · Projeto → Cadastrar material para criar materiais.');
 statements.push(text);
}
for(const name of selected)if(!found.has(name))throw new Error('Missing connector core: '+name);
const generated=readFileSync(overrides,'utf8').replaceAll('vale30','vale 30').replaceAll('em30','em 30').replaceAll('cada10','cada 10').replaceAll('cada30','cada 30')+'\n\n'+statements.join('\n\n')+'\n';
if(/\bDriveApp\b|\/api\/sync\/connector|proex_sync_configure|copiarAnexos|backupCompleto/.test(generated))throw new Error('Unsafe global capability in project connector');
// Every helper called as name_(...) must be defined in the generated file; a missing one would only fail inside Google.
const defined=new Set([...generated.matchAll(/function\s+([A-Za-z0-9]+_)\s*\(/g)].map(match=>match[1]));
const missing=[...new Set([...generated.matchAll(/(?<![.\w])([A-Za-z0-9]+_)\s*\(/g)].map(match=>match[1]))].filter(name=>!defined.has(name));
if(missing.length)throw new Error('Project connector calls undefined helpers: '+missing.join(', '));
if(process.argv.includes('--check')){if(readFileSync(target,'utf8')!==generated)throw new Error('Project connector is stale; regenerate: node '+fileURLToPath(import.meta.url));}else writeFileSync(target,generated);
