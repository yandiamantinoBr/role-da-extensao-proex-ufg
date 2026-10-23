'use client';

import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { Camera, Check, ImagePlus, LoaderCircle, LockKeyhole, RefreshCw, UserRound } from 'lucide-react';

type Profile = { displayName: string; email: string; avatarUrl: string | null; version: number };
type Payload = { profile: Profile; hasPassword: boolean };
type Props = { onUpdated?(): void };

async function responseData(response: Response): Promise<Payload> {
  const body = await response.json() as Partial<Payload> & { error?: string };
  if (!response.ok) throw new Error(body.error || 'Não foi possível atualizar seu perfil.');
  if (!body.profile || typeof body.profile.displayName !== 'string' || typeof body.profile.email !== 'string'
    || !Number.isSafeInteger(body.profile.version)) throw new Error('Atualize a página para recuperar seu perfil.');
  return { profile: body.profile, hasPassword: body.hasPassword === true };
}
async function fetchProfile(signal?: AbortSignal): Promise<Payload> {
  return responseData(await fetch('/api/profile', { credentials: 'same-origin', cache: 'no-store', signal }));
}

async function preparePhoto(file: File): Promise<Blob> {
  if (!file.type.startsWith('image/') || file.size > 20 * 1024 * 1024) {
    throw new Error('Escolha uma foto de até 20 MB na câmera ou galeria.');
  }
  const source = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = 'async';
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('Não foi possível abrir esta foto. Tente JPEG ou PNG.'));
      image.src = source;
    });
    if (!image.naturalWidth || !image.naturalHeight) throw new Error('A foto não contém uma imagem válida.');
    const scale = Math.min(1, 512 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Este navegador não conseguiu preparar a foto.');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(
      (value) => value ? resolve(value) : reject(new Error('Não foi possível preparar a foto.')), 'image/png',
    ));
    if (blob.size > 2 * 1024 * 1024) throw new Error('A foto preparada ultrapassou 2 MB. Escolha outra imagem.');
    return blob;
  } finally { URL.revokeObjectURL(source); }
}

export default function ProfilePanel({ onUpdated }: Props) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [hasPassword, setHasPassword] = useState(false);
  const [name, setName] = useState('');
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
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
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível carregar seu perfil.');
    } finally { setLoading(false); }
  }
  useEffect(() => {
    const controller = new AbortController();
    void fetchProfile(controller.signal).then((data) => {
      if (controller.signal.aborted) return;
      setProfile(data.profile); setName(data.profile.displayName); setHasPassword(data.hasPassword); setLoading(false);
    }, (cause: unknown) => {
      if (controller.signal.aborted) return;
      setError(cause instanceof Error ? cause.message : 'Não foi possível carregar seu perfil.'); setLoading(false);
    });
    return () => { controller.abort(); selection.current = -1; if (previewRef.current) URL.revokeObjectURL(previewRef.current); };
  }, []);

  function discardPhoto() {
    selection.current++;
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = null; setPreview(null); setPhoto(null);
  }
  async function choosePhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file || busy || passwordBusy) return;
    const request = ++selection.current;
    setBusy(true); setError(''); setMessage('');
    try {
      const blob = await preparePhoto(file);
      if (selection.current !== request) return;
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
      const next = URL.createObjectURL(blob);
      previewRef.current = next; setPhoto(blob); setPreview(next);
    } catch (cause) { if (selection.current === request) setError(cause instanceof Error ? cause.message : 'Não foi possível preparar a foto.'); }
    finally { if (selection.current === request) setBusy(false); }
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profile || busy || passwordBusy) return;
    setBusy(true); setError(''); setMessage('');
    let latest = profile;
    try {
      if (name.trim() !== profile.displayName) {
        const data = await responseData(await fetch('/api/profile', {
          method: 'PUT', credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json', 'X-Proex-Action': '1' },
          body: JSON.stringify({ displayName: name, expectedVersion: latest.version }),
        }));
        latest = data.profile; setProfile(latest); setName(latest.displayName); setHasPassword(data.hasPassword);
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
        <div style={{ width: 104, height: 104, flexShrink: 0, borderRadius: '50%', overflow: 'hidden', background: '#EFE5F5', display: 'grid', placeItems: 'center', color: '#54216C' }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- Private avatar must be requested by the signed-in browser, without an image proxy. */}
          {avatar ? <img src={avatar} alt={preview ? 'Prévia da sua nova foto' : 'Sua foto de perfil'} width={104} height={104} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <UserRound size={42} aria-hidden="true" />}
        </div>
        <div><div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}><button type="button" className="p-button p-button-subtle" onClick={() => cameraRef.current?.click()}><Camera size={17} />Tirar foto</button><button type="button" className="p-button p-button-subtle" onClick={() => galleryRef.current?.click()}><ImagePlus size={17} />Escolher foto</button></div><p className="p-form-help">A imagem será preparada para carregar rápido e ficará protegida no portal.</p>{photo && <button type="button" className="p-text-link" onClick={discardPhoto}>Descartar foto escolhida</button>}</div>
      </div>
      <input ref={cameraRef} type="file" accept="image/*" capture="user" hidden onChange={choosePhoto} />
      <input ref={galleryRef} type="file" accept="image/*" hidden onChange={choosePhoto} />
      <div className="p-form-grid"><label className="p-field"><span>Nome de exibição</span><input autoComplete="name" required maxLength={80} value={name} onChange={(event) => { setName(event.target.value); setMessage(''); }} /></label><label className="p-field"><span>E-mail da conta</span><input type="email" value={profile.email} readOnly aria-readonly="true" /><small>O e-mail, a função e as permissões não são alterados neste formulário.</small></label></div>
      <div className="p-form-footer"><button className="p-button p-button-primary" type="submit" disabled={busy || passwordBusy || (name.trim() === profile.displayName && !photo)}>{busy ? <LoaderCircle size={17} className="p-spin" /> : <Check size={17} />}{busy ? 'Salvando…' : 'Salvar perfil'}</button></div>
    </fieldset></form>}
    {error && <p className="p-inline-error" role="alert">{error}</p>}
    {message && <p role="status" style={{ color: '#256455', marginBottom: 0 }}>{message}</p>}
    {profile && <section aria-labelledby="profile-password-title" style={{ marginTop: 30, paddingTop: 24, borderTop: '1px solid #e7dcec' }}>
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
        {passwordMessage && <p role="status" style={{ color: '#256455', marginBottom: 0 }}>{passwordMessage}</p>}
      </form> : <div><p className="p-form-help">Uma senha ainda não foi configurada para esta conta.</p><a className="p-button p-button-subtle" href="/acesso-inicial"><LockKeyhole size={17} />Configurar senha de acesso</a></div>}
    </section>}
  </section>;
}
