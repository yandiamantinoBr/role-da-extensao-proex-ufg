import { ASSET_TEXT_FIELDS } from '../asset-metadata';
export type ImportKind = 'project' | 'asset';
export type ImportField = { key: string; label: string; maximum: number; metadata?: boolean };
export const PROJECT_IMPORT_FIELDS: ImportField[] = [
  { key: 'name', label: 'Nome', maximum: 120 }, { key: 'shortName', label: 'Nome curto', maximum: 40 },
  { key: 'description', label: 'Resumo', maximum: 2000 }, { key: 'startsAt', label: 'Início', maximum: 40 },
  { key: 'endsAt', label: 'Fim', maximum: 40 }, { key: 'location', label: 'Local', maximum: 200 },
  { key: 'thematicArea', label: 'Área temática', maximum: 80 }, { key: 'extensionLine', label: 'Linha de extensão', maximum: 80 },
  { key: 'unitName', label: 'Unidade informada', maximum: 200, metadata: true },
  { key: 'modality', label: 'Modalidade', maximum: 80, metadata: true },
  { key: 'sourceYear', label: 'Ano do cadastro na fonte', maximum: 4, metadata: true },
  { key: 'sourceStatus', label: 'Situação na fonte', maximum: 100, metadata: true },
  { key: 'funding', label: 'Financiamento informado', maximum: 1000, metadata: true },
];
export const ASSET_IMPORT_FIELDS: ImportField[] = [
  { key: 'name', label: 'Nome do bem', maximum: 120 }, { key: 'assetCode', label: 'Tombamento / patrimônio', maximum: 100 },
  { key: 'description', label: 'Descrição', maximum: 2000 }, { key: 'unit', label: 'Unidade de medida', maximum: 40 },
  ...ASSET_TEXT_FIELDS.map(field => ({ key: field[0], label: field[2], maximum: field[3], metadata: true })),
  { key: 'acquisitionDate', label: 'Data de aquisição documentada', maximum: 10, metadata: true },
  { key: 'acquisitionValueCents', label: 'Valor documentado em centavos inteiros', maximum: 13, metadata: true },
];
export const importFields = (kind: ImportKind) => kind === 'project' ? PROJECT_IMPORT_FIELDS : ASSET_IMPORT_FIELDS;
export type ImportFieldEvidence = {method:'rule'|'ai';status:'literal'|'missing'|'conflict'|'review';quote:string|null;sourceTextSha256:string;confidence:null;page?:number};
export type ImportAiProvenance = {callId:string;configRevision:number;provider:'deepseek';model:string;modelRevision:string;returnedModel:string;jevModel:string|null;sourceTextSha256:string;reviewedAt:string};
export type ImportCandidate = { key: string; fields: Record<string, string>; problems: Record<string, string>; warnings: string[]; evidence?:Record<string,ImportFieldEvidence>; suggestedUnitId?: string; suggestedTypeId?: string };
export type ImportFileProvenance = { fileFormat: string; sha256: string; extraction: 'server-docx' | 'browser-pdf' | 'text-file'; pages?: number[] };
export type ImportProvenance = { kind: 'sigaa' | 'document' | 'manual'; organizationId: string; label: string; url?: string; externalId?: string; sha256: string; textSha256?: string; fileFormat?: string; extraction?: ImportFileProvenance['extraction']; pages?: number[]; retrievedAt: string; ai?:ImportAiProvenance };
export type ImportReview = { version: 2 | 3; organizationId: string; actorId: string; kind: ImportKind; projectId: string | null; itemId: string | null; expectedVersion: number | null; provenance: ImportProvenance; candidates: ImportCandidate[]; expiresAt: number };
export type ImportPreview = Omit<ImportReview, 'actorId'> & { reviewToken: string };
export const IMPORT_TEXT_LIMIT = 256 * 1024;
export const IMPORT_MAX_ROWS = 20;
