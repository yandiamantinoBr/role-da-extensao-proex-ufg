'use client';

import { useEffect, useRef, useState } from 'react';
import { Camera, Check, LoaderCircle, RefreshCw, SwitchCamera, X } from 'lucide-react';
import styles from './profile-panel.module.css';

/** Usa a webcam do computador (getUserMedia). Em celulares o seletor nativo com câmera é melhor. */
export function prefersNativeCamera(): boolean {
  if (typeof window === 'undefined') return true;
  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
  return mobile || !navigator.mediaDevices?.getUserMedia || !window.isSecureContext;
}

function cameraError(cause: unknown): string {
  const name = cause instanceof DOMException ? cause.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'O navegador bloqueou a câmera. Clique no ícone de câmera ou cadeado na barra de endereço, permita o acesso e tente de novo.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'Nenhuma câmera foi encontrada neste computador. Use “Escolher foto”.';
  if (name === 'NotReadableError' || name === 'AbortError') return 'A câmera está em uso por outro aplicativo (por exemplo, uma chamada de vídeo). Feche-o e tente de novo.';
  return 'Não foi possível abrir a câmera. Use “Escolher foto”.';
}

export default function WebcamCapture({ onCapture, onClose, onFallback }: { onCapture: (file: File) => void; onClose: () => void; onFallback: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null), videoRef = useRef<HTMLVideoElement>(null), streamRef = useRef<MediaStream | null>(null);
  const [facing, setFacing] = useState<'user' | 'environment'>('user'), [cameras, setCameras] = useState(0), [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<'starting' | 'live' | 'captured' | 'error'>('starting'), [error, setError] = useState('');
  const [still, setStill] = useState<{ url: string; blob: Blob } | null>(null);

  useEffect(() => { const dialog = dialogRef.current; if (dialog && !dialog.open) dialog.showModal(); }, []);
  useEffect(() => {
    let cancelled = false;
    const start = window.setTimeout(() => { setStatus('starting'); setError(''); }, 0);
    navigator.mediaDevices.getUserMedia({ video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 960 } }, audio: false }).then(async stream => {
      if (cancelled) { stream.getTracks().forEach(track => track.stop()); return; }
      streamRef.current = stream;
      const video = videoRef.current;
      if (video) { video.srcObject = stream; await video.play().catch(() => undefined); }
      setStatus('live');
      const devices = await navigator.mediaDevices.enumerateDevices().catch(() => [] as MediaDeviceInfo[]);
      if (!cancelled) setCameras(devices.filter(device => device.kind === 'videoinput').length);
    }).catch(cause => { if (!cancelled) { setError(cameraError(cause)); setStatus('error'); } });
    return () => { cancelled = true; window.clearTimeout(start); streamRef.current?.getTracks().forEach(track => track.stop()); streamRef.current = null; };
  }, [facing, attempt]);
  useEffect(() => () => { if (still) URL.revokeObjectURL(still.url); }, [still]);

  function capture() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const side = Math.min(video.videoWidth, video.videoHeight), size = Math.min(side, 1024);
    const canvas = document.createElement('canvas'); canvas.width = size; canvas.height = size;
    const context = canvas.getContext('2d'); if (!context) return;
    // Recorte quadrado no centro; a câmera frontal é espelhada como na prévia.
    if (facing === 'user') { context.translate(size, 0); context.scale(-1, 1); }
    context.drawImage(video, (video.videoWidth - side) / 2, (video.videoHeight - side) / 2, side, side, 0, 0, size, size);
    canvas.toBlob(blob => { if (!blob) { setError('Não foi possível capturar a imagem. Tente de novo.'); return; } setStill({ url: URL.createObjectURL(blob), blob }); setStatus('captured'); }, 'image/jpeg', 0.92);
  }
  function close() { streamRef.current?.getTracks().forEach(track => track.stop()); dialogRef.current?.close(); onClose(); }
  function use() { if (!still) return; const file = new File([still.blob], 'foto-webcam.jpg', { type: 'image/jpeg' }); close(); onCapture(file); }

  return <dialog ref={dialogRef} className={styles.cameraDialog} aria-labelledby="camera-title" onCancel={event => { event.preventDefault(); close(); }}>
    <div className={styles.cameraHead}><h3 id="camera-title"><Camera size={18} aria-hidden="true" />Tirar foto com a câmera</h3><button type="button" className="p-icon-button" aria-label="Fechar câmera" onClick={close}><X size={18} /></button></div>
    <div className={styles.cameraStage}>
      <video ref={videoRef} playsInline muted className={facing === 'user' ? styles.mirrored : ''} hidden={status === 'captured' || status === 'error'} aria-label="Prévia da câmera" />
      {/* eslint-disable-next-line @next/next/no-img-element -- prévia local gerada no navegador */}
      {status === 'captured' && still && <img src={still.url} alt="Foto capturada" />}
      {status === 'starting' && <p className={styles.cameraStatus}><LoaderCircle className="p-spin" size={18} aria-hidden="true" />Abrindo a câmera… Se o navegador perguntar, clique em “Permitir”.</p>}
      {status === 'error' && <p className={styles.cameraStatus} role="alert">{error}</p>}
      {status === 'live' && <span className={styles.cameraFrame} aria-hidden="true" />}
    </div>
    <p className={styles.cameraHint}>A foto é recortada em formato quadrado e salva no seu perfil. Nada é gravado antes de você confirmar.</p>
    <div className={styles.cameraActions}>
      {status === 'captured' ? <>
        <button type="button" className="p-button p-button-subtle" onClick={() => { setStill(null); setStatus('live'); }}><RefreshCw size={16} aria-hidden="true" />Tirar outra</button>
        <button type="button" className="p-button p-button-primary" onClick={use}><Check size={16} aria-hidden="true" />Usar esta foto</button>
      </> : status === 'error' ? <>
        <button type="button" className="p-button p-button-subtle" onClick={() => setAttempt(value => value + 1)}>Tentar de novo</button>
        <button type="button" className="p-button p-button-primary" onClick={() => { close(); onFallback(); }}>Escolher arquivo</button>
      </> : <>
        {cameras > 1 && <button type="button" className="p-button p-button-subtle" onClick={() => setFacing(current => current === 'user' ? 'environment' : 'user')}><SwitchCamera size={16} aria-hidden="true" />Trocar câmera</button>}
        <button type="button" className="p-button p-button-primary" disabled={status !== 'live'} onClick={capture}><Camera size={16} aria-hidden="true" />Capturar</button>
      </>}
    </div>
  </dialog>;
}
