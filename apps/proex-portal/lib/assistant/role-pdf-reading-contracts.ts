import { DEFAULT_ROLE_VIDEO, roleVideoCostMicros, type RoleVideoProfile } from './role-video-contracts';

/*
 * Leitura com IA de um PDF público oficial escaneado (sem texto), só depois do toque da pessoa.
 * Vale no navegador e no servidor: os dois calculam o mesmo teto.
 *
 * Modelo: o mais barato que o caminho de vídeo já suporta (Gemini 3.8 Flash, esforço baixo), metade do
 * preço do Gemini 4 Hydrogen na tabela de roleVideoCostMicros. Transcrever o trecho de um edital
 * escaneado é leitura de imagem com pouco raciocínio; o esforço baixo basta e o teto fica previsível.
 */
export const PDF_READING_PROFILE: RoleVideoProfile = { model: DEFAULT_ROLE_VIDEO.model, effort: DEFAULT_ROLE_VIDEO.effort };
export const PDF_READING_MAX_PAGES = 10;
/**
 * Resolução média, enviada explícita em cada pedido. O guia de resolução de mídia do Google
 * (ai.google.dev/gemini-api/docs/media-resolution, lido em 2026-11-17) documenta, para Gemini 3 e 4,
 * 560 tokens por página de PDF em "medium", mais o texto nativo; a qualidade de OCR satura nesse nível.
 * O PDF escaneado tem menos de 200 caracteres de texto nativo no total: 600 por página cobre os dois.
 */
export const PDF_READING_RESOLUTION = 'medium';
export const PDF_READING_TOKENS_PER_PAGE = 600;
const PDF_READING_REQUEST_TOKENS = 512;
/** Saída fixa (inclui o raciocínio cobrado como saída): só o trecho e a página. */
export const PDF_READING_OUTPUT_TOKENS = 1_500;
/** Teto por leitura em micro-dólares (US$ 0,03), conferido no servidor antes de qualquer pedido. */
export const PDF_READING_MAX_COST_MICROS = 30_000;

export const PDF_READING_NOTICE = 'O PDF público e a sua pergunta serão enviados ao Google Gemini (IA do Google) para leitura.';
export const PDF_READING_AI_LINE = 'Leitura feita por IA a partir da imagem do documento; confira no PDF.';
export const PDF_READING_DISABLED = 'A leitura de PDF escaneado com IA não está ligada nesta organização.';

/** O que o chat recebe junto do resultado sem_texto: endereço oficial, título, custo máximo e a oferta assinada. */
export type RolePdfReadingOffer = { url: string; title: string; costMicros: number; expiresAt: number; signature: string };

/** Custo máximo: páginas × tokens por página + pedido + pergunta (bytes ≥ tokens) + saída limitada. */
export function pdfReadingEstimate({ textBytes, pages = PDF_READING_MAX_PAGES, now }: { textBytes: number; pages?: number; now?: number }) {
  const inputTokens = Math.max(1, Math.min(pages, PDF_READING_MAX_PAGES)) * PDF_READING_TOKENS_PER_PAGE + PDF_READING_REQUEST_TOKENS + textBytes;
  return {
    inputTokens,
    tokens: inputTokens + PDF_READING_OUTPUT_TOKENS,
    costMicros: roleVideoCostMicros(inputTokens, PDF_READING_OUTPUT_TOKENS, now, PDF_READING_PROFILE.model),
  };
}
