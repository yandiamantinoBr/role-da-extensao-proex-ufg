export class HttpError extends Error {
 constructor(public status:number,message:string,public code='request_failed'){super(message);this.name='HttpError';}
}
export function publicError(error:unknown):Response{
 if(error instanceof HttpError)return Response.json({error:error.message,code:error.code},{status:error.status,headers:{'Cache-Control':'no-store'}});
 const message=error instanceof Error?error.message:'';
 if(message.includes('stock_unavailable')||message.includes('stock_negative'))return Response.json({error:'Não há saldo disponível para esta operação. Confira o estoque e as reservas.'},{status:409,headers:{'Cache-Control':'no-store'}});
 if(message.includes('loan_checkout_window'))return Response.json({error:'A retirada só pode ser registrada dentro do período reservado.'},{status:409,headers:{'Cache-Control':'no-store'}});
 if(message.includes('participation_used')||message.includes('attempt_immutable'))return Response.json({error:'Esta participação já foi registrada. Atualize para recuperar o resultado.'},{status:409,headers:{'Cache-Control':'no-store'}});
 if(message.includes('loan_conflict')||message.includes('asset_unavailable'))return Response.json({error:'O equipamento está reservado, atrasado ou indisponível neste período.'},{status:409,headers:{'Cache-Control':'no-store'}});
 if(message.includes('UNIQUE constraint'))return Response.json({error:'Esta operação já foi registrada. Atualize a tela para recuperar o registro.'},{status:409,headers:{'Cache-Control':'no-store'}});
 if(message.includes('CHECK constraint')||message.includes('FOREIGN KEY'))return Response.json({error:'Os dados não atendem às regras deste cadastro. Confira quantidades, vínculos e datas.'},{status:400,headers:{'Cache-Control':'no-store'}});
 // Never serialize arbitrary database/provider errors, payloads, or personal fields.
 console.error('Portal request failed:',error instanceof Error?error.name:'UnknownError');
 return Response.json({error:'Não foi possível concluir. Atualize e tente novamente com a mesma operação.'},{status:500,headers:{'Cache-Control':'no-store'}});
}
