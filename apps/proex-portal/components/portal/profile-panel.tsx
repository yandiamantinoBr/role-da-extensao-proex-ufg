'use client';

import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { Camera, Check, ImagePlus, LoaderCircle, LockKeyhole, RefreshCw, UserRound } from 'lucide-react';
import AccountIdentityPanel from './account-identity-panel';
import styles from './profile-panel.module.css';

type Affiliation = '' | 'student' | 'technical' | 'faculty' | 'scholar' | 'intern' | 'collaborator' | 'other';
type RegistrationType = '' | 'siape' | 'student' | 'other';
type Profile = {
  displayName: string; email: string; unit: string; unitId: string | null; affiliation: Affiliation;
  jobTitle: string; phone: string; registrationType: RegistrationType; registrationNumber: string;
  avatarUrl: string | null; version: number;
};
type ProfileDraft = Omit<Profile, 'email' | 'avatarUrl' | 'version' | 'unitId'> & { unitId: string };
type OrganizationalUnit = { id: string; name: string; acronym: string; status: 'active' | 'archived' };
type Payload = { profile: Profile; hasPassword: boolean };
type Props = { onUpdated?(): void };
const affiliations: Record<Affiliation, string> = { '': 'Não informado', student: 'Estudante', technical: 'Técnico-administrativo', faculty: 'Docente', scholar: 'Bolsista', intern: 'Estagiário(a)', collaborator: 'Colaborador(a)', other: 'Outro' };
const registrationTypes: Record<RegistrationType, string> = { '': 'Não informar', siape: 'SIAPE', student: 'Matrícula de estudante', other: 'Outro registro institucional' };
function profileDraft(profile: Profile): ProfileDraft {
  return { displayName: profile.displayName, unit: profile.unit, unitId: profile.unitId ?? '', affiliation: profile.affiliation, jobTitle: profile.jobTitle, phone: profile.phone, registrationType: profile.registrationType, registrationNumber: profile.registrationNumber };
}
function hasProfileChanges(profile: Profile, draft: ProfileDraft): boolean {
  const saved = profileDraft(profile);
  return (Object.keys(saved) as (keyof ProfileDraft)[]).some(key => draft[key].trim() !== saved[key]);
}
function unitLabel(unit: OrganizationalUnit): string { return unit.acronym ? `${unit.acronym} · ${unit.name}` : unit.name; }
async function responseData(response: Response): Promise<Payload> {
  const body = await response.json() as Partial<Payload> & { error?: string };
  if (!response.ok) throw new Error(body.error || 'Não foi possível atualizar seu perfil.');
  if (!body.profile || typeof body.profile.displayName !== 'string' || typeof body.profile.email !== 'string'
    || !Number.isSafeInteger(body.profile.version)) throw new Error('Atualize a página para recuperar seu perfil.');
  return { profile: { ...body.profile, unit: body.profile.unit ?? '', unitId: body.profile.unitId ?? null, affiliation: body.profile.affiliation ?? '', jobTitle: body.profile.jobTitle ?? '', phone: body.profile.phone ?? '', registrationType: body.profile.registrationType ?? '', registrationNumber: body.profile.registrationNumber ?? '' }, hasPassword: body.hasPassword === true };
}
async function fetchProfile(signal?: AbortSignal): Promise<Payload> {
  return responseData(await fetch('/api/profile', { credentials: 'same-origin', cache: 'no-store', signal }));
}
async function fetchUnits(signal?: AbortSignal): Promise<OrganizationalUnit[]> {
  const response = await fetch('/api/units', { credentials: 'same-origin', cache: 'no-store', signal });
  const body = await response.json() as { organizationalUnits?: OrganizationalUnit[]; error?: string };
  if (!response.ok || !Array.isArray(body.organizationalUnits)) throw new Error(body.error || 'Não foi possível carregar o catálogo de unidades.');
  return body.organizationalUnits.filter(unit => typeof unit.id === 'string' && typeof unit.name === 'string' && typeof unit.acronym === 'string' && (unit.status === 'active' || unit.status === 'archived'));
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
  const [profile, setProfile] = useState<Profile | null>(null), [draft, setDraft] = useState<ProfileDraft | null>(null);
  const [hasPassword, setHasPassword] = useState(false);
  const [units, setUnits] = useState<OrganizationalUnit[]>([]), [unitsLoading, setUnitsLoading] = useState(true), [unitsError, setUnitsError] = useState('');
  const [photo, setPhoto] = useState<Blob | null>(null), [preview, setPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [preparing, setPreparing] = useState(false);
  const [error, setError] = useState(''), [message, setMessage] = useState('');
  const [currentPassword, setCurrentPassword] = useState(''), [newPassword, setNewPassword] = useState(''), [confirmPassword, setConfirmPassword] = useState('');
  const [passwordBusy, setPasswordBusy] = useState(false), [passwordError, setPasswordError] = useState(''), [passwordMessage, setPasswordMessage] = useState('');
  const previewRef = useRef<string | null>(null), cameraRef = useRef<HTMLInputElement>(null), galleryRef = useRef<HTMLInputElement>(null);
  const selection = useRef(0), profileBusy = useRef(false), passwordPending = useRef(false);
  function applyProfile(data: Payload) { setProfile(data.profile); setDraft(profileDraft(data.profile)); setHasPassword(data.hasPassword); }
  async function refreshUnits() {
    setUnitsLoading(true); setUnitsError('');
    try { setUnits(await fetchUnits()); }
    catch (cause) { setUnitsError(cause instanceof Error ? cause.message : 'Não foi possível carregar as unidades.'); }
    finally { setUnitsLoading(false); }
  }
  async function refreshProfile() {
    if (profileBusy.current || passwordPending.current) return;
    setLoading(true); setError(''); setMessage('');
    try { const data = await fetchProfile(); applyProfile(data); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível carregar seu perfil.'); }
    finally { setLoading(false); }
  }
  useEffect(() => {
    const controller = new AbortController();
    // The unit catalog and the private profile are independent requests.
    void fetchProfile(controller.signal).then(data => {
      if (controller.signal.aborted) return;
      setProfile(data.profile); setDraft(profileDraft(data.profile)); setHasPassword(data.hasPassword); setLoading(false);
    }, (cause: unknown) => {
      if (controller.signal.aborted) return;
      setError(cause instanceof Error ? cause.message : 'Não foi possível carregar seu perfil.'); setLoading(false);
    });
    void fetchUnits(controller.signal).then(data => {
      if (!controller.signal.aborted) { setUnits(data); setUnitsLoading(false); }
    }, (cause: unknown) => {
      if (!controller.signal.aborted) { setUnitsError(cause instanceof Error ? cause.message : 'Não foi possível carregar as unidades.'); setUnitsLoading(false); }
    });
    return () => { controller.abort(); selection.current = -1; releasePhotoUrl(previewRef.current); };
  }, []);
  function edit<K extends keyof ProfileDraft>(key: K, value: ProfileDraft[K]) {
    setDraft(current => current ? { ...current, [key]: value } : current); setMessage('');
  }
  function discardPhoto() {
    selection.current++; releasePhotoUrl(previewRef.current); previewRef.current = null;
    setPreview(null); setPhoto(null); setMessage('');
  }
  async function choosePhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file || profileBusy.current || passwordPending.current) return;
    const request = ++selection.current;
    profileBusy.current = true; setBusy(true); setPreparing(true); setError(''); setMessage('');
    try {
      const blob = await prepareProfilePhoto(file), next = await photoDataUrl(blob);
      if (selection.current !== request) return;
      releasePhotoUrl(previewRef.current); previewRef.current = next; setPhoto(blob); setPreview(next);
      setPreparing(false);
      // A foto é gravada logo após o preparo: não depende de outro clique em "Salvar perfil".
      await uploadPhoto(blob, request);
    } catch (cause) { if (selection.current === request) setError(cause instanceof Error ? cause.message : 'Não foi possível preparar a foto.'); }
    finally { if (selection.current === request) { profileBusy.current = false; setBusy(false); setPreparing(false); } }
  }
  async function uploadPhoto(blob: Blob, request = selection.current) {
    const current = await fetchProfile();
    const form = new FormData(); form.set('file', blob, 'avatar.png'); form.set('expectedVersion', String(current.profile.version));
    try {
      const data = await responseData(await fetch('/api/profile', { method: 'POST', credentials: 'same-origin', headers: { 'X-Proex-Action': '1' }, body: form }));
      if (selection.current !== request) return;
      setProfile(data.profile); setHasPassword(data.hasPassword); discardPhoto(); setMessage('Foto do perfil atualizada.'); onUpdated?.();
    } catch (cause) {
      if (selection.current === request) setError((cause instanceof Error ? cause.message : 'Não foi possível salvar a foto.') + ' A prévia foi mantida: use “Tentar salvar a foto novamente”.');
    }
  }
  async function retryPhoto() {
    if (!photo || profileBusy.current) return;
    profileBusy.current = true; setBusy(true); setError(''); setMessage('');
    try { await uploadPhoto(photo); } finally { profileBusy.current = false; setBusy(false); }
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profile || !draft || profileBusy.current || passwordPending.current) return;
    setError(''); setMessage('');
    if (draft.registrationNumber.trim() && !draft.registrationType) { setError('Escolha o tipo da matrícula ou deixe o número em branco.'); return; }
    profileBusy.current = true; setBusy(true);
    let latest = profile;
    try {
      if (hasProfileChanges(profile, draft)) {
        const data = await responseData(await fetch('/api/profile', {
          method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Proex-Action': '1' },
          body: JSON.stringify({ ...draft, unitId: draft.unitId || null, expectedVersion: latest.version }),
        }));
        latest = data.profile; applyProfile(data);
      }
      if (photo) {
        const form = new FormData(); form.set('file', photo, 'avatar.png'); form.set('expectedVersion', String(latest.version));
        const data = await responseData(await fetch('/api/profile', {
          method: 'POST', credentials: 'same-origin', headers: { 'X-Proex-Action': '1' }, body: form,
        }));
        latest = data.profile; applyProfile(data); discardPhoto();
      }
      setMessage('Seu perfil foi atualizado.'); onUpdated?.();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível salvar o perfil.'); }
    finally { profileBusy.current = false; setBusy(false); }
  }
  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (profileBusy.current || passwordPending.current || !hasPassword) return;
    setPasswordError(''); setPasswordMessage('');
    if (!currentPassword || currentPassword.length > 128) { setPasswordError('Informe sua senha atual.'); return; }
    if (newPassword.length < 12 || newPassword.length > 128) { setPasswordError('Use uma nova senha de 12 a 128 caracteres.'); return; }
    if (newPassword !== confirmPassword) { setPasswordError('A confirmação deve ser igual à nova senha.'); return; }
    passwordPending.current = true; setPasswordBusy(true);
    try {
      const response = await fetch('/api/account', {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Proex-Action': '1' },
        body: JSON.stringify({ action: 'changePassword', currentPassword, newPassword }),
      });
      const body = await response.json().catch(() => ({})) as { error?: unknown; message?: unknown };
      if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : typeof body.message === 'string' ? body.message : 'Não foi possível alterar sua senha. Confira a senha atual.');
      setCurrentPassword(''); setNewPassword(''); setConfirmPassword(''); setPasswordMessage('Sua senha foi alterada com sucesso.');
    } catch (cause) { setPasswordError(cause instanceof Error ? cause.message : 'Não foi possível alterar sua senha.'); }
    finally { passwordPending.current = false; setPasswordBusy(false); }
  }

  if (loading) return <div className={`${styles.card} ${styles.busy}`} role="status"><LoaderCircle className="p-spin" size={20} aria-hidden="true" />Carregando seu perfil…</div>;
  const avatar = preview || profile?.avatarUrl, selectedUnit = units.find(unit => unit.id === profile?.unitId);
  const currentUnitMissing = !!draft?.unitId && !units.some(unit => unit.id === draft.unitId);
  const disabled = busy || passwordBusy;
  return <section className={styles.profileRoot} aria-labelledby="profile-title">
    {profile && draft && <>
      <div className={`${styles.card} ${styles.hero}`}>
        <div className={styles.avatarColumn}>
          <div className={styles.avatar}>
            {/* eslint-disable-next-line @next/next/no-img-element -- Private avatars must be fetched by the signed-in browser without an image proxy. */}
            {avatar ? <img src={avatar} alt={preview ? 'Prévia da sua nova foto' : 'Sua foto de perfil'} width={144} height={144} /> : <UserRound size={52} aria-hidden="true" />}
          </div>
          <div className={styles.photoActions}>
            <button type="button" className="p-button p-button-subtle" disabled={disabled} onClick={() => cameraRef.current?.click()}><Camera size={16} aria-hidden="true" />Tirar foto</button>
            <button type="button" className="p-button p-button-subtle" disabled={disabled} onClick={() => galleryRef.current?.click()}><ImagePlus size={16} aria-hidden="true" />Escolher foto</button>
          </div>
        </div>
        <div className={styles.heroBody}>
          <div className={styles.heroHeading}><div><p className={styles.kicker}>Meu perfil</p><h2 className={styles.name} id="profile-title">{profile.displayName}</h2><p className={styles.email}>{profile.email}</p></div><button className="p-button p-button-subtle" type="button" disabled={disabled} onClick={() => void refreshProfile()}><RefreshCw size={16} aria-hidden="true" />Recarregar dados</button></div>
          <dl className={styles.summary}>
            <div><dt>Unidade institucional</dt><dd>{selectedUnit ? unitLabel(selectedUnit) : profile.unitId ? 'Unidade cadastrada' : profile.unit || 'Não informada'}{selectedUnit && profile.unit && <small>{profile.unit}</small>}{selectedUnit?.status === 'archived' && <small>Unidade arquivada · vínculo preservado</small>}</dd></div>
            <div><dt>Vínculo principal</dt><dd>{affiliations[profile.affiliation]}{profile.jobTitle && <small>{profile.jobTitle}</small>}</dd></div>
            <div><dt>Registro institucional</dt><dd>{profile.registrationNumber || 'Não informado'}{profile.registrationType && <small>{registrationTypes[profile.registrationType]}</small>}</dd></div>
          </dl>
          <p className={styles.photoHelp}>Foto de até 20 MB em JPEG, PNG ou WebP. Ela é salva assim que escolhida: o portal prepara uma imagem de até 512 pixels e remove os metadados. Fotos HEIC do iPhone dependem do navegador; se não abrir, ajuste a câmera para “Mais compatível” ou escolha outra imagem.</p>
          {photo && !busy && <div className="p-inline"><button type="button" className="p-button p-button-primary" disabled={disabled} onClick={() => void retryPhoto()}>Tentar salvar a foto novamente</button><button type="button" className="p-text-link" disabled={disabled} onClick={discardPhoto}>Descartar foto escolhida</button></div>}
          {preparing && <p role="status" className={styles.busy}><LoaderCircle size={16} className="p-spin" aria-hidden="true" />Preparando a foto neste aparelho…</p>}
        </div>
        <input ref={cameraRef} type="file" accept="image/*" capture="user" hidden onChange={choosePhoto} />
        <input ref={galleryRef} type="file" accept="image/*" hidden onChange={choosePhoto} />
      </div>
      <div className={styles.card}>
        <div className={styles.sectionHeading}><UserRound size={23} aria-hidden="true" /><div><h3>Dados do perfil</h3><p>Seu nome identifica você na equipe. Os dados institucionais e de contato são opcionais.</p></div></div>
        <form className={styles.form} onSubmit={save}>
          <fieldset disabled={disabled}>
            <div className={styles.grid}>
              <label className={styles.field}><span>Nome de exibição</span><input autoComplete="name" required maxLength={80} value={draft.displayName} onChange={event => edit('displayName', event.target.value)} /></label>
              <label className={styles.field}><span>E-mail da conta</span><input type="email" value={profile.email} readOnly aria-readonly="true" /><small>O e-mail de acesso é gerenciado pela administração.</small></label>
            </div>
            <h4 className={styles.subheading}>Informações institucionais</h4>
            <div className={styles.grid}>
              <label className={styles.field}><span>Unidade institucional (opcional)</span><select value={draft.unitId} disabled={unitsLoading || !!unitsError} onChange={event => edit('unitId', event.target.value)} aria-describedby="profile-units-help"><option value="">Não informar</option>{currentUnitMissing && <option value={draft.unitId}>Unidade atual cadastrada</option>}{units.filter(unit => unit.status === 'active' || unit.id === profile.unitId).map(unit => <option key={unit.id} value={unit.id}>{unitLabel(unit)}{unit.status === 'archived' ? ' (arquivada)' : ''}</option>)}</select><small id="profile-units-help">{unitsLoading ? 'Carregando unidades…' : 'Escolha uma unidade do catálogo institucional.'}</small></label>
              <label className={styles.field}><span>Setor ou complemento (opcional)</span><input autoComplete="organization" maxLength={120} value={draft.unit} onChange={event => edit('unit', event.target.value)} placeholder="Ex.: Comunicação · turno da tarde" /><small>Se você já havia informado uma unidade por texto, ela foi preservada aqui.</small></label>
              <label className={styles.field}><span>Vínculo principal (opcional)</span><select value={draft.affiliation} onChange={event => edit('affiliation', event.target.value as Affiliation)}>{Object.entries(affiliations).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><small>Este dado descreve seu vínculo e não concede permissões.</small></label>
              <label className={styles.field}><span>Função ou atividade (opcional)</span><input autoComplete="organization-title" maxLength={120} value={draft.jobTitle} onChange={event => edit('jobTitle', event.target.value)} placeholder="Ex.: atendimento, comunicação ou coordenação" /></label>
              <label className={styles.field}><span>Tipo do registro (opcional)</span><select value={draft.registrationType} onChange={event => { const value = event.target.value as RegistrationType; setDraft(current => current ? { ...current, registrationType: value, ...(!value ? { registrationNumber: '' } : {}) } : current); setMessage(''); }}>{Object.entries(registrationTypes).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              <label className={styles.field}><span>Matrícula ou número do registro (opcional)</span><input autoComplete="off" maxLength={40} value={draft.registrationNumber} onChange={event => edit('registrationNumber', event.target.value)} aria-describedby="profile-registration-help" /><small id="profile-registration-help">Até 40 caracteres. Informe o tipo se preencher o número. Este dado permanece no ambiente privado de gestão.</small></label>
              <label className={styles.field}><span>Telefone ou ramal (opcional)</span><input type="tel" autoComplete="tel" maxLength={40} value={draft.phone} onChange={event => edit('phone', event.target.value)} placeholder="Contato útil para o trabalho da equipe" /></label>
            </div>
            {unitsError && <div className={styles.notice}><p role="alert">{unitsError} A unidade atual será preservada; você pode salvar os demais campos.</p><button type="button" className={`p-text-link ${styles.retry}`} onClick={() => void refreshUnits()}><RefreshCw size={15} aria-hidden="true" />Tentar carregar unidades</button></div>}
            <p className={styles.help}>Preencha somente o que for útil para a equipe. Você pode remover os dados opcionais neste formulário.</p>
            <div className={styles.actions}><button className="p-button p-button-primary" type="submit" disabled={disabled || (!hasProfileChanges(profile, draft) && !photo)}>{busy ? <LoaderCircle size={17} className="p-spin" aria-hidden="true" /> : <Check size={17} aria-hidden="true" />}{preparing ? 'Preparando foto…' : busy ? 'Salvando…' : 'Salvar perfil'}</button></div>
          </fieldset>
          {error && <p className={styles.error} role="alert">{error}</p>}{message && <p className={styles.success} role="status">{message}</p>}
        </form>
      </div>
      <details className={styles.disclosure}>
        <summary><span className={styles.summaryTitle}><LockKeyhole size={20} aria-hidden="true" />Senha de acesso</span></summary>
        <div className={styles.disclosureBody}>
          {hasPassword ? <form className={styles.form} onSubmit={changePassword}>
            <p className={styles.help}>Confirme a senha atual e escolha uma nova senha de 12 a 128 caracteres.</p>
            <fieldset disabled={disabled}><div className={styles.grid}>
              <label className={styles.field}><span>Senha atual</span><input type="password" autoComplete="current-password" required maxLength={128} value={currentPassword} onChange={event => { setCurrentPassword(event.target.value); setPasswordMessage(''); }} /></label>
              <label className={styles.field}><span>Nova senha</span><input type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={newPassword} onChange={event => { setNewPassword(event.target.value); setPasswordMessage(''); }} /></label>
              <label className={styles.field}><span>Confirmar nova senha</span><input type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={confirmPassword} onChange={event => { setConfirmPassword(event.target.value); setPasswordMessage(''); }} /></label>
            </div><div className={styles.actions}><button type="submit" className="p-button p-button-primary">{passwordBusy ? <LoaderCircle size={17} className="p-spin" aria-hidden="true" /> : <LockKeyhole size={17} aria-hidden="true" />}{passwordBusy ? 'Alterando senha…' : 'Alterar senha'}</button></div></fieldset>
            {passwordError && <p className={styles.error} role="alert">{passwordError}</p>}{passwordMessage && <p className={styles.success} role="status">{passwordMessage}</p>}
          </form> : <div><p className={styles.help}>Uma senha ainda não foi configurada para esta conta.</p><a className="p-button p-button-subtle" href="/acesso-inicial"><LockKeyhole size={17} aria-hidden="true" />Configurar senha de acesso</a></div>}
        </div>
      </details>
      <AccountIdentityPanel hasPassword={hasPassword} />
    </>}
    {!profile && <div className={styles.card}><h2 id="profile-title">Meu perfil</h2><p className={styles.error} role="alert">{error || 'Não foi possível carregar seu perfil.'}</p><button className="p-button p-button-subtle" type="button" onClick={() => void refreshProfile()}><RefreshCw size={16} aria-hidden="true" />Tentar novamente</button></div>}
  </section>;
}
