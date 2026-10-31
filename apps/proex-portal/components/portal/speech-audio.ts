'use client';
import { validateSpeechAudio, MAX_SPEECH_SECONDS } from '../../lib/assistant/audio';
import { MAX_UPLOAD_FILE_BYTES } from '../../lib/upload-limits';
export type DecodedAudio = { duration: number; numberOfChannels: number; sampleRate: number; length: number; getChannelData: (channel: number) => Float32Array };
/** Deterministic PCM encoding makes duration enforceable on the server, independent of browser metadata. */
export function encodeSpeechWav(audio: DecodedAudio): Uint8Array<ArrayBuffer> {
 if (!Number.isFinite(audio.duration) || audio.duration < .5 || audio.duration > MAX_SPEECH_SECONDS || !Number.isSafeInteger(audio.numberOfChannels) || audio.numberOfChannels < 1 || audio.numberOfChannels > 8 || audio.length < 1) throw new Error('Use áudio entre meio segundo e noventa segundos, com até oito canais.');
 const samples = Math.floor(audio.duration * 16000), bytes = new Uint8Array(44 + samples * 2), view = new DataView(bytes.buffer);
 const ascii = (at: number, value: string) => Array.from(value).forEach((char,index) => view.setUint8(at+index,char.charCodeAt(0)));
 ascii(0,'RIFF');view.setUint32(4,bytes.length-8,true);ascii(8,'WAVE');ascii(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,16000,true);view.setUint32(28,32000,true);view.setUint16(32,2,true);view.setUint16(34,16,true);ascii(36,'data');view.setUint32(40,samples*2,true);
 const channels=Array.from({length:audio.numberOfChannels},(_,index)=>audio.getChannelData(index));
 for(let i=0;i<samples;i++){const position=i*audio.sampleRate/16000,left=Math.min(audio.length-1,Math.floor(position)),right=Math.min(audio.length-1,left+1),weight=position-left;let value=0;for(const channel of channels)value+=(channel[left]*(1-weight)+channel[right]*weight)/channels.length;value=Math.max(-1,Math.min(1,value));view.setInt16(44+i*2,Math.round(value*(value<0?32768:32767)),true);}
 validateSpeechAudio(bytes,'audio/wav');return bytes;
}
export async function prepareSpeechWav(file: File, createContext: () => AudioContext = () => new AudioContext()): Promise<File> {
 if(!file.size||file.size>MAX_UPLOAD_FILE_BYTES)throw new Error('Use áudio de até 4 MB.');
 const allowed=/^(?:audio\/(?:wav|wave|x-wav|webm|ogg|mpeg|mp3|mp4|x-m4a|aac|flac))(?:;|$)/i;
 if(!allowed.test(file.type))throw new Error('Use WAV, MP3, M4A, AAC, FLAC, OGG ou WebM de áudio.');
 const bytes=new Uint8Array(await file.arrayBuffer());
 try{validateSpeechAudio(bytes,file.type);return new File([bytes], 'audio-revisado.wav',{type:'audio/wav'});}catch(error){if(error instanceof Error&&'code'in error&&error.code!=='speech_audio_format')throw error;}
 const context=createContext();let timer:ReturnType<typeof setTimeout>|undefined;
 try{const decoded=await Promise.race([context.decodeAudioData(bytes.buffer),new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>reject(new Error('O áudio demorou a ser convertido. Use um trecho menor ou WAV.')),15000);})]);return new File([encodeSpeechWav(decoded)],'audio-revisado.wav',{type:'audio/wav'});}
 catch(error){throw new Error(error instanceof Error&&/Use áudio|sinal suficiente|demorou/.test(error.message)?error.message:'Não foi possível converter este áudio no navegador. Tente WAV ou grave novamente.');}
 finally{if(timer)clearTimeout(timer);await context.close().catch(()=>{});}
}
