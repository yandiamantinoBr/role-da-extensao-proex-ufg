export const CONNECTION_PROVIDERS=['deepseek','typesafe','deepgram'] as const;
export type ConnectionProvider=typeof CONNECTION_PROVIDERS[number];
export const CONNECTION_OUTCOMES=['authenticated','rejected','rate_limited','timeout','cancelled','unavailable','invalid_response','pending'] as const;
export type ConnectionOutcome=typeof CONNECTION_OUTCOMES[number];
export type ConnectionReceipt={id:string;organizationId:string;provider:ConnectionProvider;revision:number;checkedAt:string;outcome:ConnectionOutcome;httpStatus:number|null;elapsedMs:number;modelListed:boolean|null;authenticationChecked:boolean;inferenceTested:false;replayed:boolean};
export type ConnectionStatus={organizationId:string;revision:number;checks:ConnectionReceipt[]};
export function connectionReceipt(value:unknown):ConnectionReceipt{
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Resposta de diagnóstico inválida.');const row=value as Record<string,unknown>;
 if(typeof row.id!=='string'||!row.id||typeof row.organizationId!=='string'||!CONNECTION_PROVIDERS.includes(row.provider as ConnectionProvider)||!Number.isSafeInteger(row.revision)||Number(row.revision)<1||typeof row.checkedAt!=='string'||!Number.isFinite(Date.parse(row.checkedAt))||!CONNECTION_OUTCOMES.includes(row.outcome as ConnectionOutcome)||!(row.httpStatus===null||Number.isInteger(row.httpStatus)&&Number(row.httpStatus)>=100&&Number(row.httpStatus)<=599)||!Number.isSafeInteger(row.elapsedMs)||Number(row.elapsedMs)<0||!(row.modelListed===null||typeof row.modelListed==='boolean')||typeof row.authenticationChecked!=='boolean'||row.inferenceTested!==false||typeof row.replayed!=='boolean')throw new Error('Resposta de diagnóstico inválida.');
 return{id:row.id,organizationId:row.organizationId,provider:row.provider as ConnectionProvider,revision:Number(row.revision),checkedAt:row.checkedAt,outcome:row.outcome as ConnectionOutcome,httpStatus:row.httpStatus as number|null,elapsedMs:Number(row.elapsedMs),modelListed:row.modelListed as boolean|null,authenticationChecked:row.authenticationChecked,inferenceTested:false,replayed:row.replayed};
}
export function connectionStatus(value:unknown,organizationId:string,revision:number):ConnectionStatus{
 if(!value||typeof value!=='object')throw new Error('Resposta de diagnóstico inválida.');const row=value as Record<string,unknown>;
 if(row.organizationId!==organizationId||row.revision!==revision||!Array.isArray(row.checks)||row.checks.length>3)throw new Error('A configuração mudou; atualize o assistente.');
 const checks=row.checks.map(connectionReceipt);if(checks.some(check=>check.organizationId!==organizationId||check.revision!==revision)||new Set(checks.map(check=>check.provider)).size!==checks.length)throw new Error('Resposta de diagnóstico inválida.');return{organizationId,revision,checks};
}
