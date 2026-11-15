import { docxText } from '../importer/documents';
import { HttpError } from '../errors';
import { MAX_UPLOAD_FILE_BYTES } from '../upload-limits';
import { readOfficialPdfText } from './official-pdf-text';
import { ROLE_DOCUMENT_TEXT_LIMIT, type RoleDocumentPreview } from './role-document-contracts';

export async function previewRoleDocument(file: Pick<File, 'name' | 'size' | 'arrayBuffer'>): Promise<RoleDocumentPreview> {
  if (!file.size || file.size > MAX_UPLOAD_FILE_BYTES) throw new HttpError(413, 'Use um arquivo de até 4 MB.', 'role_document_size');
  const format = file.name.match(/\.(pdf|docx)$/i)?.[1].toLowerCase();
  if (format !== 'pdf' && format !== 'docx') throw new HttpError(415, 'Escolha um PDF ou um documento Word (.docx).', 'role_document_format');
  const bytes = new Uint8Array(await file.arrayBuffer());
  try {
    const stem = file.name.replace(/^.*[\\/]/, '').slice(0, -(format.length + 1))
      .replace(/[^\p{L}\p{N} ._()-]/gu, '_').replace(/^\.+/, '').trim().slice(0, 105) || 'Documento';
    const name = `${stem}.${format}`;
    if (format === 'docx') {
      const text = docxText(bytes).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
      if (text.length > ROLE_DOCUMENT_TEXT_LIMIT) throw new HttpError(413, 'O texto excede 160.000 caracteres. Divida o documento.', 'role_document_size');
      if (!text) throw new HttpError(422, 'O documento não tem texto legível.', 'role_document_empty');
      return { name, format, parts: [{ page: null, text }] };
    }
    if (new TextDecoder().decode(bytes.subarray(0, 5)) !== '%PDF-') throw new HttpError(415, 'O arquivo não tem uma assinatura de PDF válida.', 'role_document_format');
    const pages = await readOfficialPdfText(bytes).catch(() => { throw new HttpError(422, 'Use um PDF íntegro, sem senha e com até 50 páginas e 160.000 caracteres.', 'role_document_pdf'); });
    if (!pages.length) throw new HttpError(422, 'O PDF não tem texto selecionável. Use uma versão com texto ou faça OCR antes de anexar.', 'role_document_empty');
    return { name, format, parts: pages.map(page => ({ page: page.number, text: page.text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim() })) };
  } finally {
    if (bytes.byteLength) bytes.fill(0);
  }
}
