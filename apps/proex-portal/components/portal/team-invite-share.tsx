'use client';

import { useId, useRef, useState } from 'react';
import { Check, Copy, Download, QrCode, ShieldCheck } from 'lucide-react';
import styles from './team-invite-share.module.css';

const expiryFormat = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'America/Sao_Paulo',
  hourCycle: 'h23',
});

async function invitationQr(url: string): Promise<string> {
  const { default: encode } = await import('qrcode-generator');
  const qr = encode(0, 'M');
  qr.addData(url);
  qr.make();

  const pixelsPerModule = 8;
  const border = 4 * pixelsPerModule;
  const canvas = document.createElement('canvas');
  canvas.width = (qr.getModuleCount() + 8) * pixelsPerModule;
  canvas.height = canvas.width;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas indisponível.');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.translate(border, border);
  qr.renderTo2dContext(context, pixelsPerModule);
  return canvas.toDataURL('image/png');
}

export default function TeamInviteShare({ url, expiresAt }: { url: string; expiresAt: string }) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [copyState, setCopyState] = useState('');
  const [qrOpen, setQrOpen] = useState(false);
  const [qrData, setQrData] = useState('');
  const [qrFailed, setQrFailed] = useState(false);
  const expiry = Date.parse(expiresAt);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopyState('Link copiado.');
    } catch {
      input.current?.focus();
      input.current?.select();
      setCopyState('Link selecionado para copiar manualmente.');
    }
  }

  async function toggleQr() {
    setQrOpen(!qrOpen);
    if (qrOpen || qrData) return;
    setQrFailed(false);
    try {
      setQrData(await invitationQr(url));
    } catch {
      setQrFailed(true);
    }
  }

  return <section className={styles.result} aria-labelledby={`${id}-title`}>
    <div className={styles.heading} role="status">
      <ShieldCheck size={20} aria-hidden="true" />
      <strong id={`${id}-title`}>Convite criado para a equipe</strong>
    </div>
    {Number.isFinite(expiry) && <p>Válido até <time dateTime={expiresAt}>{expiryFormat.format(expiry)}</time>, no horário de Brasília.</p>}
    <p>Envie o link ou QR code diretamente à pessoa convidada.</p>
    <label className={styles.label} htmlFor={`${id}-link`}>Link do convite</label>
    <input id={`${id}-link`} ref={input} readOnly value={url} spellCheck={false} onFocus={event => event.target.select()} />
    <div className={styles.actions}>
      <button type="button" className="p-button p-button-primary" onClick={() => void copy()}>
        {copyState === 'Link copiado.' ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
        Copiar link
      </button>
      <button type="button" className="p-button p-button-subtle" aria-expanded={qrOpen} aria-controls={`${id}-qr`} onClick={() => void toggleQr()}>
        <QrCode size={16} aria-hidden="true" />{qrOpen ? 'Ocultar QR code' : 'Mostrar QR code'}
      </button>
    </div>
    {copyState && <p role="status">{copyState}</p>}
    <div id={`${id}-qr`} hidden={!qrOpen}>
      {qrOpen && (qrFailed
        ? <p role="alert">Não foi possível gerar o QR code. Você pode copiar o link do convite.</p>
        : qrData
          ? <div className={styles.qr}>
            {/* Printed from a browser-generated PNG. The copyable link is its text equivalent. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qrData} alt="QR code para abrir o link do convite" width={224} height={224} />
            <a href={qrData} download="convite-proex-qr.png" className="p-button p-button-subtle">
              <Download size={16} aria-hidden="true" />Baixar QR code
            </a>
          </div>
          : <p role="status">Gerando QR code…</p>)}
    </div>
  </section>;
}
