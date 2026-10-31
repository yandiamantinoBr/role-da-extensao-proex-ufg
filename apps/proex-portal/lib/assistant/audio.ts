import { HttpError } from '../errors';
import { MAX_UPLOAD_FILE_BYTES } from '../upload-limits';
export const MAX_SPEECH_SECONDS = 90;
export function validateSpeechAudio(bytes: Uint8Array, mime: string): { duration: number; samples: number } {
 const invalid = () => new HttpError(415, 'O áudio deve ser WAV PCM mono de 16 kHz e 16 bits. Use a conversão do painel.', 'speech_audio_format');
 if (!['audio/wav','audio/wave','audio/x-wav'].includes(mime.split(';')[0].trim().toLowerCase()) || bytes.length < 44 || bytes.length > MAX_UPLOAD_FILE_BYTES) throw invalid();
 const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), ascii = (from: number, count: number) => new TextDecoder().decode(bytes.subarray(from, from + count));
 if (ascii(0,4) !== 'RIFF' || ascii(8,4) !== 'WAVE' || ascii(12,4) !== 'fmt ' || ascii(36,4) !== 'data' || view.getUint32(4,true) !== bytes.length - 8 || view.getUint32(16,true) !== 16 || view.getUint16(20,true) !== 1 || view.getUint16(22,true) !== 1 || view.getUint32(24,true) !== 16000 || view.getUint32(28,true) !== 32000 || view.getUint16(32,true) !== 2 || view.getUint16(34,true) !== 16 || view.getUint32(40,true) !== bytes.length - 44 || (bytes.length - 44) % 2) throw invalid();
 const samples = (bytes.length - 44) / 2, duration = samples / 16000;
 if (duration < .5 || duration > MAX_SPEECH_SECONDS) throw new HttpError(400, 'Use áudio entre meio segundo e noventa segundos.', 'speech_duration');
 let energy = 0; for (let offset = 44; offset < bytes.length; offset += 2) energy += view.getInt16(offset,true) ** 2;
 if (Math.sqrt(energy / samples) < 4) throw new HttpError(422, 'O áudio não apresenta sinal suficiente. Grave novamente perto do microfone.', 'speech_silence');
 return { duration, samples };
}
