import { MAX_UPLOAD_FILE_BYTES, UPLOAD_LIMIT_LABEL } from './upload-limits';

export const MAX_PHOTO_SOURCE_BYTES = 25 * 1024 * 1024;

/** Reduces a supported photo on this device before the user confirms the upload. */
export async function prepareUploadPhoto(file: File, fallbackName: string, signal?: AbortSignal): Promise<File> {
  if (file.size > MAX_PHOTO_SOURCE_BYTES) throw new Error('Escolha uma foto com até 25 MB para preparar o envio.');
  signal?.throwIfAborted();
  const url = URL.createObjectURL(file);
  const image = new window.Image();
  const abort = () => { image.removeAttribute('src'); };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    image.src = url;
    try {
      await image.decode();
    } catch {
      signal?.throwIfAborted();
      throw new Error('Não foi possível abrir a foto. Escolha outra imagem.');
    }
    signal?.throwIfAborted();
    if (!image.naturalWidth || !image.naturalHeight) throw new Error('Não foi possível abrir a foto. Escolha outra imagem.');
    const ratio = Math.min(1, 2000 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Não foi possível preparar esta foto.');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', .86));
    signal?.throwIfAborted();
    if (!blob?.size || blob.type !== 'image/jpeg') throw new Error('Não foi possível preparar esta foto.');
    if (blob.size > MAX_UPLOAD_FILE_BYTES) throw new Error(`A foto ficou maior que ${UPLOAD_LIMIT_LABEL}. Tente outra.`);
    return new File([blob], `${file.name.replace(/\.[^.]+$/, '') || fallbackName}.jpg`, { type: 'image/jpeg', lastModified: file.lastModified });
  } finally {
    signal?.removeEventListener('abort', abort);
    URL.revokeObjectURL(url);
  }
}
