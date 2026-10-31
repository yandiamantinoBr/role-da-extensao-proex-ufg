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
  { key: 'brand', label: 'Marca', maximum: 120, metadata: true }, { key: 'model', label: 'Modelo', maximum: 120, metadata: true },
  { key: 'serialNumber', label: 'Número de série', maximum: 120, metadata: true },
  { key: 'location', label: 'Localização física', maximum: 200, metadata: true },
  { key: 'responsibleUnit', label: 'Unidade responsável', maximum: 200, metadata: true },
  { key: 'sourceCondition', label: 'Condição informada', maximum: 100, metadata: true },
];
export const importFields = (kind: ImportKind) => kind === 'project' ? PROJECT_IMPORT_FIELDS : ASSET_IMPORT_FIELDS;
export type ImportCandidate = { key: string; fields: Record<string, string>; problems: Record<string, string>; warnings: string[]; suggestedUnitId?: string; suggestedTypeId?: string };
export type ImportFileProvenance = { fileFormat: string; sha256: string; extraction: 'server-docx' | 'browser-pdf' | 'text-file'; pages?: number[] };
export type ImportProvenance = { kind: 'sigaa' | 'document' | 'manual'; label: string; url?: string; externalId?: string; sha256: string; textSha256?: string; fileFormat?: string; extraction?: ImportFileProvenance['extraction']; pages?: number[]; retrievedAt: string };
export type ImportReview = { version: 1; actorId: string; kind: ImportKind; projectId: string | null; itemId: string | null; expectedVersion: number | null; provenance: ImportProvenance; candidates: ImportCandidate[]; expiresAt: number };
export type ImportPreview = Omit<ImportReview, 'actorId'> & { reviewToken: string };
export const IMPORT_TEXT_LIMIT = 256 * 1024;
export const IMPORT_MAX_ROWS = 20;
