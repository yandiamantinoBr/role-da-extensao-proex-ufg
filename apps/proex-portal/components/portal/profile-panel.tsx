'use client';

import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { Camera, Check, ImagePlus, LoaderCircle, LockKeyhole, RefreshCw, UserRound } from 'lucide-react';
import AccountIdentityPanel from './account-identity-panel';

type Profile = { displayName: string; email: string; unit: string; jobTitle: string; phone: string; avatarUrl: string | null; version: number };
type Payload = { profile: Profile; hasPassword: boolean };
type Props = { onUpdated?(): void };

async function responseData(response: Response): Promise<Payload> {
  const body = await response.json() as Partial<Payload> & { error?: string };
  if (!response.ok) throw new Error(body.error || 'Não foi possível atualizar seu perfil.');
  if (!body.profile || typeof body.profile.displayName !== 'string' || typeof body.profile.email !== 'string'
    || !Number.isSafeInteger(body.profile.version)) throw new Error('Atualize a página para recuperar seu perfil.');
  return { profile: { ...body.profile, unit: body.profile.unit ?? '', jobTitle: body.profile.jobTitle ?? '', phone: body.profile.phone ?? '' }, hasPassword: body.hasPassword === true };
}
async function fetchProfile(signal?: AbortSignal): Promise<Payload> {
  return responseData(await fetch('/api/profile', { credentials: 'same-origin', cache: 'no-store', signal }));
}

const PHOTO_READ_TIMEOUT = 12000;
function photoDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    const timer = window.setTimeout(() => { reader.abort(); reject(new Error('O aparelho demorou para ler a foto. Selecione o arquivo novamente.')); }, PHOTO_READ_TIMEOUT);
    const done = () => { window.clearTimeout(timer); reader.onload = null; reader.onerror = null; reader.onabort = null; };
    reader.onload = () => { const result = reader.result; done(); if (typeof result === 'string') resolve(result); else reject(new Error('O aparelho não conseguiu ler esta foto.')); };
    reader.onerror = () => { done(); reject(new Error('O aparelho não conseguiu ler esta foto. Selecione uma cópia em JPEG ou PNG.')); };
    reader.onabort = () => { done(); reject(new Error('A leitura da foto foi interrompida. Selecione o arquivo novamente.')); };
    try { reader.readAsDataURL(file); } catch { done(); reject(new Error('O navegador não conseguiu acessar o arquivo escolhido. Selecione a foto novamente.')); }
  });
}
function releasePhotoUrl(url: string | null): void {
  if (url?.startsWith('blob:')) { try { URL.revokeObjectURL(url); } catch { /* Some embedded browsers omit the blob URL API. */ } }
}
type DecodedPhoto = { image: CanvasImageSource; width: number; height: number; release(): void };
async function decodePhoto(file: File): Promise<DecodedPhoto> {
  // Decode the Blob directly when available. This avoids blob-URL restrictions in embedded views.
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await new Promise<ImageBitmap>((resolve, reject) => {
        let expired = false;
        const timer = window.setTimeout(() => { expired = true; reject(new Error('photo_decode_timeout')); }, PHOTO_READ_TIMEOUT);
        try {
          void createImageBitmap(file).then(value => {
            window.clearTimeout(timer);
            if (expired) value.close(); else resolve(value);
          }, error => { window.clearTimeout(timer); reject(error); });
        } catch (error) { window.clearTimeout(timer); reject(error); }
      });
      if (bitmap.width && bitmap.height) return { image: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() };
      bitmap.close();
    } catch { /* Fall back to an HTML image for browsers with partial ImageBitmap support. */ }
  }
  const load = (source: string) => new Promise<DecodedPhoto>((resolve, reject) => {
    // Use the document's image element rather than a possibly replaced global Image constructor.
    const image = document.createElement('img');
    const cleanup = () => { window.clearTimeout(timer); image.onload = null; image.onerror = null; };
    const fail = () => { cleanup(); image.removeAttribute('src'); reject(new Error('photo_image_decode')); };
    const timer = window.setTimeout(fail, PHOTO_READ_TIMEOUT);
    image.onload = () => {
      cleanup();
      if (!image.naturalWidth || !image.naturalHeight) { reject(new Error('photo_empty_image')); return; }
      resolve({ image, width: image.naturalWidth, height: image.naturalHeight, release: () => image.removeAttribute('src') });
    };
    image.onerror = fail;
    try { image.src = source; } catch { fail(); }
  });
  let source: string | null = null;
  try {
    source = URL.createObjectURL(file);
    return await load(source);
  } catch {
    try { return await load(await photoDataUrl(file)); }
    catch { throw new Error('O navegador não conseguiu abrir esta foto. Escolha uma cópia em JPEG ou PNG; se estiver no aplicativo, tente abrir o portal em outra aba.'); }
  } finally { releasePhotoUrl(source); }
}
function canvasPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    let completed = false;
    const fallback = () => {
      if (completed) return; completed = true; window.clearTimeout(timer);
      try {
        const encoded = canvas.toDataURL('image/png');
        if (!encoded.startsWith('data:image/png;base64,')) throw new Error('photo_png_export');
        const binary = atob(encoded.slice(encoded.indexOf(',') + 1));
        resolve(new Blob([Uint8Array.from(binary, value => value.charCodeAt(0))], { type: 'image/png' }));
      } catch { reject(new Error('photo_canvas_export')); }
    };
    const timer = window.setTimeout(fallback, 3000);
    try {
      canvas.toBlob(value => {
        if (completed) return;
        if (!value) { fallback(); return; }
        completed = true; window.clearTimeout(timer); resolve(value);
      }, 'image/png');
    } catch { fallback(); }
  });
}
/** Browser-only preparation. Server independently validates and re-encodes every uploaded PNG. */
export async function prepareProfilePhoto(file: File): Promise<Blob> {
  const mime = file.type.toLowerCase();
  if (!file.size || file.size > 20 * 1024 * 1024) {
    throw new Error('Escolha uma foto de até 20 MB na câmera ou galeria.');
  }
  if (mime === 'image/svg+xml' || (!mime.startsWith('image/') && !((!mime || mime === 'application/octet-stream') && /\.(jpe?g|png|webp|gif|avif|bmp|hei[cf])$/i.test(file.name)))) {
    throw new Error('Escolha uma foto em JPEG, PNG ou outro formato de imagem compatível com seu navegador.');
  }
  const decoded = await decodePhoto(file);
  try {
    const scale = Math.min(1, 512 / Math.max(decoded.width, decoded.height));
    const width = Math.max(1, Math.round(decoded.width * scale)), height = Math.max(1, Math.round(decoded.height * scale));
    let blob: Blob;
    try {
      const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('photo_canvas_context');
      context.drawImage(decoded.image, 0, 0, width, height);
      blob = await canvasPng(canvas);
    } catch {
      try {
        if (typeof OffscreenCanvas !== 'function') throw new Error('photo_offscreen_unavailable');
        const canvas = new OffscreenCanvas(width, height), context = canvas.getContext('2d');
        if (!context) throw new Error('photo_offscreen_context');
        context.drawImage(decoded.image, 0, 0, width, height);
        blob = await canvas.convertToBlob({ type: 'image/png' });
      } catch { throw new Error('O navegador abriu a foto, mas não conseguiu convertê-la para o perfil. Tente uma imagem menor em JPEG ou PNG ou abra o portal em outra aba.'); }
    }
    if (!blob.size || blob.type !== 'image/png' || blob.size > 2 * 1024 * 1024) throw new Error('A foto preparada não ficou em PNG com até 2 MB. Escolha outra imagem.');
    return blob;
  } finally { decoded.release(); }
}

export default function ProfilePanel({ onUpdated }: Props) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [hasPassword, setHasPassword] = useState(false);
  const [name, setName] = useState('');
  const [unit, setUnit] = useState(''), [jobTitle, setJobTitle] = useState(''), [phone, setPhone] = useState('');
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [passwordMessage, setPasswordMessage] = useState('');
  const previewRef = useRef<string | null>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const selection = useRef(0);
  async function refreshProfile() {
    setLoading(true); setError(''); setMessage('');
    try {
      const data = await fetchProfile();
      setProfile(data.profile); setName(data.profile.displayName); setHasPassword(data.hasPassword);
      setUnit(data.profile.unit); setJobTitle(data.profile.jobTitle); setPhone(data.profile.phone);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível carregar seu perfil.');
    } finally { setLoading(false); }
  }
  useEffect(() => {
    const controller = new AbortController();
    void fetchProfile(controller.signal).then((data) => {
      if (controller.signal.aborted) return;
      setProfile(data.profile); setName(data.profile.displayName); setHasPassword(data.hasPassword); setLoading(false);
      setUnit(data.profile.unit); setJobTitle(data.profile.jobTitle); setPhone(data.profile.phone);
    }, (cause: unknown) => {
      if (controller.signal.aborted) return;
      setError(cause instanceof Error ? cause.message : 'Não foi possível carregar seu perfil.'); setLoading(false);
    });
    return () => { controller.abort(); selection.current = -1; releasePhotoUrl(previewRef.current); };
  }, []);

  function discardPhoto() {
    selection.current++;
    releasePhotoUrl(previewRef.current);
    previewRef.current = null; setPreview(null); setPhoto(null); setMessage('');
  }
  async function choosePhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file || busy || passwordBusy) return;
    const request = ++selection.current;
    setBusy(true); setPreparing(true); setError(''); setMessage('');
    try {
      const blob = await prepareProfilePhoto(file);
      const next = await photoDataUrl(blob);
      if (selection.current !== request) return;
      releasePhotoUrl(previewRef.current);
      previewRef.current = next; setPhoto(blob); setPreview(next);
      setMessage('Foto preparada. Confira a prévia e clique em “Salvar perfil”.');
    } catch (cause) { if (selection.current === request) setError(cause instanceof Error ? cause.message : 'Não foi possível preparar a foto.'); }
    finally { if (selection.current === request) { setBusy(false); setPreparing(false); } }
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profile || busy || passwordBusy) return;
    setBusy(true); setError(''); setMessage('');
    let latest = profile;
    try {
      if (name.trim() !== profile.displayName || unit.trim() !== profile.unit || jobTitle.trim() !== profile.jobTitle || phone.trim() !== profile.phone) {
        const data = await responseData(await fetch('/api/profile', {
          method: 'PUT', credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json', 'X-Proex-Action': '1' },
          body: JSON.stringify({ displayName: name, unit, jobTitle, phone, expectedVersion: latest.version }),
        }));
        latest = data.profile; setProfile(latest); setName(latest.displayName); setHasPassword(data.hasPassword);
        setUnit(latest.unit); setJobTitle(latest.jobTitle); setPhone(latest.phone);
      }
      if (photo) {
        const form = new FormData();
        form.set('file', photo, 'avatar.png'); form.set('expectedVersion', String(latest.version));
        const data = await responseData(await fetch('/api/profile', {
          method: 'POST', credentials: 'same-origin', headers: { 'X-Proex-Action': '1' }, body: form,
        }));
        latest = data.profile; setProfile(latest); setHasPassword(data.hasPassword); discardPhoto();
      }
      setMessage('Seu perfil foi atualizado.'); onUpdated?.();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível salvar o perfil.'); }
    finally { setBusy(false); }
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || passwordBusy || !hasPassword) return;
    setPasswordError(''); setPasswordMessage('');
    if (!currentPassword || currentPassword.length > 128) {
      setPasswordError('Informe sua senha atual.'); return;
    }
    if (newPassword.length < 12 || newPassword.length > 128) {
      setPasswordError('Use uma nova senha de 12 a 128 caracteres.'); return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('A confirmação deve ser igual à nova senha.'); return;
    }
    setPasswordBusy(true);
    try {
      const response = await fetch('/api/account', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-Proex-Action': '1' },
        body: JSON.stringify({ action: 'changePassword', currentPassword, newPassword }),
      });
      const body = await response.json().catch(() => ({})) as { error?: unknown; message?: unknown };
      if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error
        : typeof body.message === 'string' ? body.message : 'Não foi possível alterar sua senha. Confira a senha atual.');
      setCurrentPassword(''); setNewPassword(''); setConfirmPassword('');
      setPasswordMessage('Sua senha foi alterada com sucesso.');
    } catch (cause) {
      setPasswordError(cause instanceof Error ? cause.message : 'Não foi possível alterar sua senha.');
    } finally { setPasswordBusy(false); }
  }

  if (loading) return <div className="p-card" role="status" style={{ padding: 24 }}><LoaderCircle className="p-spin" size={20} /> Carregando seu perfil…</div>;
  const avatar = preview || profile?.avatarUrl;
  return <section className="p-card" aria-labelledby="profile-title" style={{ padding: 'clamp(18px,4vw,30px)' }}>
    <div className="p-row-between" style={{ gap: 16, flexWrap: 'wrap', marginBottom: 24 }}><div><h2 id="profile-title" style={{ margin: '0 0 8px' }}>Meu perfil</h2><p className="p-form-help" style={{ margin: 0 }}>Atualize seu nome e sua foto. O e-mail identifica sua conta.</p></div><button className="p-button p-button-subtle" type="button" disabled={busy || passwordBusy} onClick={() => void refreshProfile()}><RefreshCw size={16} />Atualizar</button></div>
    {profile && <form className="p-form" onSubmit={save}><fieldset disabled={busy || passwordBusy || loading}>
      <div style={{ display: 'flex', gap: 22, alignItems: 'center', flexWrap: 'wrap', marginBottom: 24 }}>
        <div style={{ width: 104, height: 104, flexShrink: 0, borderRadius: '50%', overflow: 'hidden', background: 'var(--surface-soft)', display: 'grid', placeItems: 'center', color: 'var(--brand-ink)' }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- Private avatar must be requested by the signed-in browser, without an image proxy. */}
          {avatar ? <img src={avatar} alt={preview ? 'Prévia da sua nova foto' : 'Sua foto de perfil'} width={104} height={104} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <UserRound size={42} aria-hidden="true" />}
        </div>
        <div><div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}><button type="button" className="p-button p-button-subtle" onClick={() => cameraRef.current?.click()}><Camera size={17} />Tirar foto</button><button type="button" className="p-button p-button-subtle" onClick={() => galleryRef.current?.click()}><ImagePlus size={17} />Escolher foto</button></div><p className="p-form-help">JPEG, PNG ou imagem compatível com seu aparelho, até 20 MB. A foto será reduzida e ficará protegida no portal.</p>{preparing && <p role="status" className="p-form-help">Preparando a foto neste aparelho…</p>}{photo && <button type="button" className="p-text-link" onClick={discardPhoto}>Descartar foto escolhida</button>}</div>
      </div>
      <input ref={cameraRef} type="file" accept="image/*" capture="user" hidden onChange={choosePhoto} />
      <input ref={galleryRef} type="file" accept="image/*" hidden onChange={choosePhoto} />
      <div className="p-form-grid"><label className="p-field"><span>Nome de exibição</span><input autoComplete="name" required maxLength={80} value={name} onChange={(event) => { setName(event.target.value); setMessage(''); }} /></label><label className="p-field"><span>E-mail da conta</span><input type="email" value={profile.email} readOnly aria-readonly="true" /><small>O e-mail, a função e as permissões não são alterados neste formulário.</small></label></div>
      <div className="p-form-grid"><label className="p-field"><span>Unidade ou setor (opcional)</span><input autoComplete="organization" maxLength={120} value={unit} onChange={event => { setUnit(event.target.value); setMessage(''); }} placeholder="Ex.: PROEX · Comunicação" /></label><label className="p-field"><span>Vínculo ou função institucional (opcional)</span><input autoComplete="organization-title" maxLength={120} value={jobTitle} onChange={event => { setJobTitle(event.target.value); setMessage(''); }} placeholder="Ex.: bolsista, técnico ou docente" /><small>Informação de perfil; não concede permissões administrativas.</small></label><label className="p-field"><span>Telefone de contato (opcional)</span><input type="tel" autoComplete="tel" maxLength={40} value={phone} onChange={event => { setPhone(event.target.value); setMessage(''); }} placeholder="Telefone ou ramal institucional" /></label></div>
      <p className="p-form-help">Preencha os dados opcionais somente se forem úteis para o trabalho da equipe. Você pode apagá-los a qualquer momento.</p>
      <div className="p-form-footer"><button className="p-button p-button-primary" type="submit" disabled={busy || passwordBusy || (name.trim() === profile.displayName && unit.trim() === profile.unit && jobTitle.trim() === profile.jobTitle && phone.trim() === profile.phone && !photo)}>{busy ? <LoaderCircle size={17} className="p-spin" /> : <Check size={17} />}{preparing ? 'Preparando foto…' : busy ? 'Salvando…' : 'Salvar perfil'}</button></div>
    </fieldset></form>}
    {error && <p className="p-inline-error" role="alert">{error}</p>}
    {message && <p role="status" style={{ color: 'var(--success-ink)', marginBottom: 0 }}>{message}</p>}
    {profile && <section aria-labelledby="profile-password-title" style={{ marginTop: 30, paddingTop: 24, borderTop: '1px solid var(--line)' }}>
      <h3 id="profile-password-title" style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '0 0 10px' }}><LockKeyhole size={20} aria-hidden="true" />Alterar senha</h3>
      {hasPassword ? <form className="p-form" onSubmit={changePassword}>
        <p className="p-form-help">Confirme sua senha atual e escolha uma nova senha de 12 a 128 caracteres.</p>
        <fieldset disabled={busy || passwordBusy}>
          <div className="p-form-grid">
            <label className="p-field"><span>Senha atual</span><input type="password" autoComplete="current-password" required maxLength={128} value={currentPassword} onChange={(event) => { setCurrentPassword(event.target.value); setPasswordMessage(''); }} /></label>
            <label className="p-field"><span>Nova senha</span><input type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={newPassword} onChange={(event) => { setNewPassword(event.target.value); setPasswordMessage(''); }} /></label>
            <label className="p-field"><span>Confirmar nova senha</span><input type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={confirmPassword} onChange={(event) => { setConfirmPassword(event.target.value); setPasswordMessage(''); }} /></label>
          </div>
          <div className="p-form-footer"><button type="submit" className="p-button p-button-primary">{passwordBusy ? <LoaderCircle size={17} className="p-spin" /> : <LockKeyhole size={17} />}{passwordBusy ? 'Alterando senha…' : 'Alterar senha'}</button></div>
        </fieldset>
        {passwordError && <p className="p-inline-error" role="alert">{passwordError}</p>}
        {passwordMessage && <p role="status" style={{ color: 'var(--success-ink)', marginBottom: 0 }}>{passwordMessage}</p>}
      </form> : <div><p className="p-form-help">Uma senha ainda não foi configurada para esta conta.</p><a className="p-button p-button-subtle" href="/acesso-inicial"><LockKeyhole size={17} />Configurar senha de acesso</a></div>}
    </section>}
    {profile && <AccountIdentityPanel hasPassword={hasPassword} />}
  </section>;
}
