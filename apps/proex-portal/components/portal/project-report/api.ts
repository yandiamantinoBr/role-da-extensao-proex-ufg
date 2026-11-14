import type { ReportConfig } from '@/lib/project-report-config';
import type { ReportData } from './document';

export type ReportTemplate = { id: string; name: string; version: number; config: ReportConfig };
export type ProjectReportPayload = ReportData & {
  permissions: { canSaveTemplates: boolean; canAddReferences: boolean };
  templates: ReportTemplate[];
};
export type ProjectReportQuery = { viewerId: string; projectId: string; from: string; to: string };

export function reportErrorMessage(body: unknown, fallback: string): string {
  const value = body && typeof body === 'object' ? (body as Record<string, unknown>).error ?? (body as Record<string, unknown>).message : null;
  const detail = value && typeof value === 'object' && 'message' in value ? (value as { message?: unknown }).message : value;
  return typeof detail === 'string' && detail ? detail : fallback;
}

export class ProjectReportError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export async function readProjectReport(query: ProjectReportQuery, signal: AbortSignal): Promise<ProjectReportPayload> {
  const { viewerId, projectId, from, to } = query;
  const params = new URLSearchParams();
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  let response: Response;
  try {
    response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/report?${params}`, {
      headers: { 'X-Proex-Viewer': viewerId }, credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal,
    });
  } catch {
    signal.throwIfAborted();
    throw new ProjectReportError('Não foi possível conectar ao Portal. Confira a conexão e tente novamente.', 0);
  }
  const body = await response.json().catch(() => null) as Partial<ProjectReportPayload> | null;
  signal.throwIfAborted();
  if (!response.ok) {
    throw new ProjectReportError(reportErrorMessage(body, 'Não foi possível consultar os dados do relatório.'), response.status);
  }
  if (response.headers.get('X-Proex-Viewer') !== viewerId || !body || body.project?.id !== projectId
    || body.period?.from !== (from || null) || body.period?.to !== (to || null)
    || typeof body.generatedAt !== 'string' || !Number.isFinite(Date.parse(body.generatedAt))
    || !body.sections || !body.permissions || !Array.isArray(body.templates)) {
    throw new ProjectReportError('Atualize a página para consultar o relatório com a conta e o período atuais.', 403);
  }
  return body as ProjectReportPayload;
}

/** Ignore metadata that cannot affect the preview or the files. Keep section and row order. */
function snapshot(data: ReportData): string {
  return JSON.stringify([data.project, data.period, data.sections]);
}

/** The user must see the same authorized projection at preview, preparation and download. */
export async function prepareProjectReport<R>(
  preview: ReportData,
  read: () => Promise<ProjectReportPayload>,
  render: () => Promise<R>,
  refreshPreview: (data: ProjectReportPayload) => void,
  signal: AbortSignal,
): Promise<R> {
  const expected = snapshot(preview);
  async function verify() {
    signal.throwIfAborted();
    const fresh = await read();
    signal.throwIfAborted();
    if (snapshot(fresh) !== expected) {
      refreshPreview(fresh);
      throw new ProjectReportError('Os dados ou seus acessos mudaram. Confira a prévia atualizada e baixe novamente.', 409);
    }
  }
  await verify();
  const artifact = await render();
  await verify();
  return artifact;
}
