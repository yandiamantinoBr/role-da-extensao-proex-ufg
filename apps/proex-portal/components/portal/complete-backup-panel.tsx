'use client';
import { useEffect, useState } from 'react';
import { Download, ShieldCheck } from 'lucide-react';
type Capability = { supported: boolean; limits: { totalBytes: number } | null };
export default function CompleteBackupPanel() {
  const [capability, setCapability] = useState<Capability | null>(null), [password, setPassword] = useState(''), [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  async function load() {
    try { const response = await fetch('/api/backup', { cache: 'no-store' }); if (!response.ok) throw new Error('Não foi possível conferir a disponibilidade do backup completo.'); setCapability(await response.json()); setMessage(''); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Não foi possível carregar o backup.'); }
  }
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, []);
  async function download() {
    if (busy || [...password].length < 16 || password !== confirmation) return;
    let protection = password; setPassword(''); setConfirmation(''); setBusy(true); setMessage('Preparando e verificando banco e arquivos…');
    try {
      const response = await fetch('/api/backup', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Proex-Action': '1' }, body: JSON.stringify({ password: protection }), cache: 'no-store' });
      protection = '';
      if (!response.ok) { const error = await response.json() as { error?: unknown }; throw new Error(typeof error.error === 'string' ? error.error : 'O backup não foi concluído.'); }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob), anchor = document.createElement('a'); anchor.href = url; anchor.download = `proex-completo-${new Date().toISOString().slice(0, 10)}.proexbackup`; anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 5000);
      setMessage('Arquivo criptografado preparado para download. Valide a restauração isolada antes de considerar a recuperação comprovada.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Não foi possível gerar o backup completo.'); }
    finally { protection = ''; setBusy(false); }
  }
  return <div className="border-t border-border pt-4 space-y-3" aria-label="Backup completo criptografado">
    <h4 className="font-medium flex items-center gap-2"><ShieldCheck size={18}/>Backup completo criptografado</h4>
    <p className="text-sm text-muted-foreground">Inclui o banco SQLite inteiro e todos os objetos privados, com manifesto de versões e hashes. Contém contas, dados pessoais e anexos; mantenha o arquivo protegido. Configurações e chaves dos provedores não são incluídas.</p>
    {capability?.supported ? <>
      <p className="text-sm text-muted-foreground">Proteção AES-256-GCM com derivação scrypt. Guarde a frase fora do arquivo: sem ela, o backup não pode ser recuperado. Limite de banco comprimido e objetos: {Math.floor((capability.limits?.totalBytes ?? 0) / 1024 / 1024)} MiB; ao exceder, a operação é interrompida, sem truncar dados.</p>
      <div className="grid gap-3 sm:grid-cols-2"><label className="block min-w-0 text-sm">Frase de proteção<input type="password" autoComplete="off" maxLength={256} value={password} onChange={event => setPassword(event.target.value)} disabled={busy} className="mt-1 block min-h-11 w-full rounded-xl border border-border bg-background px-3 text-base" aria-describedby="backup-password-help"/></label><label className="block min-w-0 text-sm">Repita a frase<input type="password" autoComplete="off" maxLength={256} value={confirmation} onChange={event => setConfirmation(event.target.value)} disabled={busy} className="mt-1 block min-h-11 w-full rounded-xl border border-border bg-background px-3 text-base"/></label></div>
      <p id="backup-password-help" className="text-sm text-muted-foreground">Use 16 a 256 caracteres. A frase é usada nesta operação, sem ser salva no portal.</p>
      <button type="button" onClick={() => void download()} disabled={busy || [...password].length < 16 || password !== confirmation} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-border px-4 disabled:opacity-50"><Download size={16}/>{busy ? 'Preparando backup…' : 'Baixar backup completo protegido'}</button>
    </> : capability ? <p className="text-sm text-muted-foreground">Disponível na hospedagem Node com adaptador de snapshot. Nesta instalação, use o procedimento de backup próprio do provedor; a exportação portátil abaixo tem outro escopo.</p> : <button type="button" onClick={() => void load()} className="min-h-11 rounded-xl border border-border px-4">Conferir disponibilidade do backup</button>}
    <details className="text-sm"><summary className="cursor-pointer min-h-11 py-2 font-medium">Como verificar a recuperação</summary><p className="mt-2">Em um computador de confiança com Node.js 24.16 ou posterior e a revisão correspondente do repositório, execute <code className="break-all">node scripts/restore-backup.mjs --input arquivo.proexbackup --dry-run</code>. A frase é solicitada sem eco. Depois, execute sem <code>--dry-run</code> para restaurar somente em uma pasta temporária nova e isolada. A ferramenta confere integridade SQLite, vínculos e todos os hashes; não inicia servidor nem conecta produção.</p><p className="mt-2">Um download ou uma resposta de saúde não comprova restauração. A pasta restaurada contém dados descriptografados: mantenha-a privada e não a publique.</p></details>
    {message && <p role="status" className="rounded-xl bg-muted p-3 text-sm">{message}</p>}
  </div>;
}
