// Fronteira legada das consultas D1: cada projeção SQL possui colunas diferentes.
// Tipar todas as consultas exige contratos por serviço; mantenha a exceção aqui,
// sem propagar novos `any` para parsers ou desabilitar a regra no projeto.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Row=Record<string,any>;
export async function all(db:D1Database,sql:string,params:unknown[]=[]):Promise<Row[]>{return (await db.prepare(sql).bind(...params).all<Row>()).results??[];}
export async function one(db:D1Database,sql:string,params:unknown[]=[]):Promise<Row|null>{return db.prepare(sql).bind(...params).first<Row>();}
export function uid(){return crypto.randomUUID();}
export function iso(){return new Date().toISOString();}
export function text(value:unknown,max=500):string{return typeof value==='string'?value.trim().slice(0,max):'';}
export function csv(rows:Row[]):string{
 const keys=rows.length?Object.keys(rows[0]):['sem_registros'];
 const quote=(value:unknown)=>{let s=String(value??'');if(/^[\t\r\n]|^\s*[=+@-]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};
 return '\uFEFF'+[keys.map(quote).join(';'),...rows.map(r=>keys.map(k=>quote(r[k])).join(';'))].join('\r\n');
}
