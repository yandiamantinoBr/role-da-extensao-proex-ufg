'use client';
/*
 * Chamadas da tela ao Google Drive do portal e o seletor de pastas do Google (Picker).
 * O seletor pede ao Google, direto no navegador, uma autorização curta com o mesmo escopo drive.file.
 * Essa autorização nunca passa pelo servidor do portal e só serve para abrir o seletor.
 */
export type DriveFolder = { id: string; organizationId: string; organizationName: string; name: string; purpose: string; driveName: string; sharedDrive: boolean;
  unitId: string | null; unitName: string | null; projectId: string | null; projectName: string | null; audience: 'organization' | 'project' | 'managers'; audienceLabel: string;
  status: 'active' | 'archived'; version: number; confirmedByMe: boolean; driveFolderId: string; driveUrl: string; updatedAt: string };
export type DriveConnection = { status: 'unconfigured' | 'not_connected' | 'connected' | 'revoked'; account: string | null; connectedAt: string | null; lastUsedAt: string | null; revokedAt: string | null };
export type DrivePicker = { clientId: string; apiKey: string; appId: string; loginHint?: string | null };
export type DriveStatus = { configured: boolean; connection: DriveConnection; picker: DrivePicker | null; folders: DriveFolder[]; canManageFolders: boolean };
export type DriveUpload = { id: string; fileName: string; folderId: string; folderName: string | null; via: 'screen' | 'role'; status: 'sent' | 'failed'; errorCode: string | null; webViewLink: string | null; bytes: number; sourceKind: string; createdAt: string; personName: string | null };
export type DriveError = Error & { code?: string; status?: number };

export async function driveRequest<T>(path: string, body?: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Proex-Action': '1' }, body: JSON.stringify(body), signal } : { cache: 'no-store', signal });
  let value: unknown = null;
  try { value = await response.json(); } catch { /* resposta vazia */ }
  const record = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  if (!response.ok) throw Object.assign(new Error(typeof record.error === 'string' ? record.error : 'Não foi possível falar com o portal. Tente de novo.'), { code: typeof record.code === 'string' ? record.code : undefined, status: response.status }) as DriveError;
  return record as T;
}

/** Mensagens da volta do Google (cookie curto gravado pelo servidor). */
const RESULT_MESSAGES: Record<string, string> = {
  connected: 'Conta Google conectada. Seus envios ao Drive vão sair com o seu nome.',
  drive_oauth_denied: 'Você não autorizou o acesso no Google. Nada foi conectado.',
  drive_oauth_scope: 'A permissão do Google Drive ficou desmarcada na tela do Google. Conecte de novo e marque a caixa do Drive.',
  drive_oauth_state: 'A conexão expirou ou foi aberta em outra aba. Clique em Conectar de novo.',
  drive_oauth_identity: 'Não foi possível confirmar a conta Google. Use uma conta com e-mail verificado.',
  drive_vault_unavailable: 'O cofre do portal ainda não está configurado. Procure a administração geral.',
  drive_unconfigured: 'A conexão com o Google Drive ainda não foi configurada no servidor.',
};
export function takeOAuthResult(): { ok: boolean; message: string } | null {
  const match = document.cookie.split(';').map(part => part.trim()).find(part => part.startsWith('proex.gdrive.result='));
  if (!match) return null;
  document.cookie = 'proex.gdrive.result=; Path=/; Max-Age=0; SameSite=Lax; Secure';
  const code = match.slice('proex.gdrive.result='.length);
  return { ok: code === 'connected', message: RESULT_MESSAGES[code] ?? 'O Google interrompeu a conexão. Tente de novo.' };
}

type GoogleGlobal = {
  accounts: { oauth2: { initTokenClient(config: { client_id: string; scope: string; prompt?: string; hint?: string; callback(response: { access_token?: string; error?: string }): void; error_callback?(error: { type?: string }): void }): { requestAccessToken(options?: { prompt?: string }): void } } };
  picker: Record<string, unknown> & { PickerBuilder: new () => PickerBuilder; DocsView: new (viewId?: unknown) => DocsView; ViewId: Record<string, unknown>; Feature: Record<string, unknown>; Action: Record<string, string>; Response: Record<string, string>; Document: Record<string, string> };
};
type DocsView = { setSelectFolderEnabled(v: boolean): DocsView; setIncludeFolders(v: boolean): DocsView; setMimeTypes(v: string): DocsView; setEnableDrives(v: boolean): DocsView; setFileIds(v: string): DocsView; setMode(v: unknown): DocsView };
type PickerBuilder = { addView(v: DocsView): PickerBuilder; setOAuthToken(v: string): PickerBuilder; setDeveloperKey(v: string): PickerBuilder; setAppId(v: string): PickerBuilder; enableFeature(v: unknown): PickerBuilder; setTitle(v: string): PickerBuilder; setLocale(v: string): PickerBuilder; setOrigin(v: string): PickerBuilder; setCallback(cb: (data: Record<string, unknown>) => void): PickerBuilder; build(): { setVisible(v: boolean): void } };
declare global { interface Window { google?: GoogleGlobal; gapi?: { load(name: string, cb: () => void): void } } }

const scripts = new Map<string, Promise<void>>();
function loadScript(src: string): Promise<void> {
  if (!scripts.has(src)) scripts.set(src, new Promise((resolve, reject) => {
    const element = document.createElement('script');
    element.src = src; element.async = true; element.onload = () => resolve();
    element.onerror = () => { scripts.delete(src); reject(new Error('Não foi possível carregar o seletor do Google. Confira a internet e tente de novo.')); };
    document.head.appendChild(element);
  }));
  return scripts.get(src)!;
}
async function pickerLibraries() {
  await Promise.all([loadScript('https://apis.google.com/js/api.js'), loadScript('https://accounts.google.com/gsi/client')]);
  await new Promise<void>(resolve => window.gapi!.load('picker', resolve));
  return window.google!;
}
/** Autorização curta, pedida ao Google no navegador, só para abrir o seletor. */
function pickerToken(google: GoogleGlobal, clientId: string, hint?: string | null): Promise<string> {
  return new Promise((resolve, reject) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: clientId, scope: 'https://www.googleapis.com/auth/drive.file', prompt: '', ...(hint ? { hint } : {}),
      callback: response => response.access_token ? resolve(response.access_token) : reject(new Error('O Google não liberou o seletor. Tente de novo.')),
      error_callback: error => reject(new Error(error.type === 'popup_closed' ? 'A janela do Google foi fechada antes de terminar.' : 'O navegador bloqueou a janela do Google. Permita janelas deste site e tente de novo.')),
    });
    client.requestAccessToken({ prompt: '' });
  });
}
export type PickedFolder = { id: string; name: string };
/**
 * Abre o seletor de pastas. `onlyId` mostra só a pasta registrada (para a pessoa confirmar com um clique).
 * Resolve `null` se a pessoa cancelar.
 */
export async function pickDriveFolder(config: DrivePicker, options: { onlyId?: string; title: string }): Promise<PickedFolder | null> {
  const google = await pickerLibraries();
  const token = await pickerToken(google, config.clientId, config.loginHint);
  const picker = google.picker;
  return new Promise(resolve => {
    const view = new picker.DocsView(picker.ViewId.FOLDERS).setSelectFolderEnabled(true).setIncludeFolders(true).setMimeTypes('application/vnd.google-apps.folder').setEnableDrives(true);
    if (options.onlyId) view.setFileIds(options.onlyId);
    new picker.PickerBuilder().addView(view).enableFeature(picker.Feature.SUPPORT_DRIVES).setOAuthToken(token).setDeveloperKey(config.apiKey).setAppId(config.appId)
      .setTitle(options.title).setLocale('pt-BR').setOrigin(window.location.origin)
      .setCallback(data => {
        const action = data[picker.Response.ACTION];
        if (action === picker.Action.CANCEL) resolve(null);
        if (action !== picker.Action.PICKED) return;
        const doc = (data[picker.Response.DOCUMENTS] as Record<string, unknown>[] | undefined)?.[0];
        resolve(doc ? { id: String(doc[picker.Document.ID]), name: String(doc[picker.Document.NAME] ?? '') } : null);
      }).build().setVisible(true);
  });
}

const FAILED: Record<string, string> = {
  drive_permission_denied: 'A conta Google não tinha permissão para gravar nessa pasta.',
  drive_reconnect_required: 'A conexão com o Google tinha vencido. Conecte outra vez em Conta › Google Drive.',
  drive_folder_confirm_required: 'A pasta não estava liberada na conta Google; libere a pasta.',
  drive_folder_public: 'A pasta estava aberta a qualquer pessoa com o link; o portal não envia para pastas assim.',
  drive_storage_full: 'O Drive de destino estava sem espaço.',
  drive_rate_limited: 'Foram muitos envios seguidos. Espere alguns minutos.',
  sending: 'O envio foi interrompido no meio.',
};
/** Motivo curto de um envio que não chegou, com o que fazer. */
export function failedReason(code: string | null): string { return `${FAILED[code ?? ''] ?? 'O Google não confirmou o envio.'} Depois, envie outra vez pelo arquivo de origem.`; }
export function sizeLabel(bytes: number) { return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`; }
export const when = (value: string) => new Date(value).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
