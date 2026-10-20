import {HttpError} from './errors';
export async function boundedJson(request:Request,limit=32768):Promise<Record<string,any>>{
 if(Number(request.headers.get('content-length')||0)>limit)throw new HttpError(413,'Solicitação muito grande.');
 if(!request.body)throw new HttpError(400,'Solicitação vazia.');const reader=request.body.getReader();let size=0;const chunks:Uint8Array[]=[];
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit){await reader.cancel();throw new HttpError(413,'Solicitação muito grande.');}chunks.push(value);}}finally{reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 let data:any;try{data=JSON.parse(new TextDecoder().decode(bytes));}catch{throw new HttpError(400,'Solicitação inválida.');}if(!data||typeof data!=='object'||Array.isArray(data))throw new HttpError(400,'Solicitação inválida.');return data;
}
